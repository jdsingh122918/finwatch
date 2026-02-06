import "dotenv/config";
import type { LLMProvider, SourceConfig, BacktestConfig } from "@finwatch/shared";
import WebSocket from "ws";
import { JsonRpcServer } from "./ipc/json-rpc-server.js";
import { AlpacaStreamSource, type WsLike } from "./ingestion/alpaca-stream-source.js";
import { AlpacaBackfill } from "./ingestion/alpaca-backfill.js";
import { BacktestEngine } from "./backtesting/backtest-engine.js";
import { CycleRunner } from "./analysis/cycle-runner.js";
import { withFallback } from "./providers/fallback.js";
import { Orchestrator } from "./orchestrator.js";
import { AnthropicProvider } from "./providers/anthropic-provider.js";
import { OpenRouterProvider } from "./providers/openrouter-provider.js";
import { createLogger } from "./utils/logger.js";

const log = createLogger("agent-main");

export { JsonRpcServer } from "./ipc/json-rpc-server.js";

type AgentStartParams = {
  alpaca: {
    keyId: string;
    secretKey: string;
    symbols: string[];
    feed: "iex" | "sip";
  };
  llm: {
    anthropicApiKey?: string;
    openrouterApiKey?: string;
    model: string;
    maxTokens: number;
    temperature: number;
  };
};

type BacktestRunParams = {
  config: BacktestConfig;
  alpaca: { keyId: string; secretKey: string };
  llm: {
    anthropicApiKey?: string;
    openrouterApiKey?: string;
    model: string;
    maxTokens: number;
    temperature: number;
  };
};

export function createAgentServer(): JsonRpcServer {
  const server = new JsonRpcServer();
  let orchestrator: Orchestrator | null = null;
  const runningBacktests = new Map<string, BacktestEngine>();

  server.register("ping", async () => ({
    status: "ok",
    timestamp: Date.now(),
  }));

  server.register("agent:start", async (params) => {
    const p = params as unknown as AgentStartParams;

    if (orchestrator) {
      await orchestrator.stop();
    }

    // Resolve API keys: params first, then env vars
    const anthropicKey = p.llm.anthropicApiKey || process.env.ANTHROPIC_API_KEY || "";
    const openrouterKey = p.llm.openrouterApiKey || process.env.OPENROUTER_API_KEY || "";

    const providers: LLMProvider[] = [];
    if (anthropicKey) {
      providers.push(new AnthropicProvider({ apiKey: anthropicKey }));
    }
    if (openrouterKey) {
      providers.push(new OpenRouterProvider({ apiKey: openrouterKey }));
    }
    if (providers.length === 0) {
      throw new Error("At least one LLM API key is required (params or ANTHROPIC_API_KEY/OPENROUTER_API_KEY env vars)");
    }

    orchestrator = new Orchestrator({
      alpaca: p.alpaca,
      llm: {
        providers,
        model: p.llm.model,
        maxTokens: p.llm.maxTokens,
        temperature: p.llm.temperature,
      },
      buffer: { flushIntervalMs: 5000, urgentThreshold: 0.8 },
    });

    // Register the Alpaca streaming data source
    const alpacaConfig: SourceConfig = {
      id: "alpaca-stream",
      name: "Alpaca Market Stream",
      type: "streaming",
      plugin: "alpaca",
      config: {
        feed: p.alpaca.feed,
        symbols: p.alpaca.symbols,
        channels: ["trades", "quotes", "bars"],
        keyId: p.alpaca.keyId,
        secretKey: p.alpaca.secretKey,
      },
      enabled: true,
    };
    const alpacaSource = new AlpacaStreamSource(
      alpacaConfig,
      (url: string) => new WebSocket(url) as unknown as WsLike,
    );
    orchestrator.sources.register(alpacaSource);
    log.info("Registered AlpacaStreamSource", { symbols: p.alpaca.symbols, feed: p.alpaca.feed });

    // Forward events as JSON-RPC notifications to stdout
    orchestrator.on("tick", (tick) => {
      log.debug("Tick event received, forwarding as notification", { sourceId: tick.sourceId, symbol: tick.symbol ?? "none" });
      writeNotification("data:tick", tick);
    });
    orchestrator.on("anomaly", (anomaly) => {
      writeNotification("anomaly:detected", anomaly);
    });
    orchestrator.on("activity", (activity) => {
      writeNotification("agent:activity", activity);
    });

    await orchestrator.start();
    return { status: "started" };
  });

  server.register("agent:stop", async () => {
    if (orchestrator) {
      await orchestrator.stop();
      orchestrator = null;
    }
    return { status: "stopped" };
  });

  server.register("agent:status", async () => {
    if (!orchestrator) {
      return { state: "idle", totalCycles: 0, totalAnomalies: 0, uptime: 0 };
    }
    return orchestrator.status;
  });

  server.register("backtest:run", async (params) => {
    const p = params as unknown as BacktestRunParams;
    const backtestId = p.config.id;

    // Resolve LLM providers (same pattern as agent:start)
    const anthropicKey = p.llm.anthropicApiKey || process.env.ANTHROPIC_API_KEY || "";
    const openrouterKey = p.llm.openrouterApiKey || process.env.OPENROUTER_API_KEY || "";

    const providers: LLMProvider[] = [];
    if (anthropicKey) {
      providers.push(new AnthropicProvider({ apiKey: anthropicKey }));
    }
    if (openrouterKey) {
      providers.push(new OpenRouterProvider({ apiKey: openrouterKey }));
    }
    if (providers.length === 0) {
      throw new Error("At least one LLM API key is required for backtest analysis");
    }

    const provider = withFallback(providers);

    // Create fetchData dependency via AlpacaBackfill
    const backfill = new AlpacaBackfill({
      sourceId: `backtest-${backtestId}`,
      keyId: p.alpaca.keyId,
      secretKey: p.alpaca.secretKey,
      baseUrl: "https://data.alpaca.markets",
    });

    const fetchData = (symbols: string[], startDate: string, endDate: string, timeframe: string) =>
      backfill.fetchAllDateRange(symbols, startDate, endDate, timeframe);

    // Create runAnalysis dependency via CycleRunner
    const cycleRunner = new CycleRunner({
      provider,
      model: p.llm.model,
      maxTokens: p.llm.maxTokens,
      temperature: p.llm.temperature,
      preScreenConfig: {
        zScoreThreshold: 2.0,
        urgentThreshold: p.config.preScreenerSensitivity,
        skipThreshold: 0.2,
      },
      sessionId: backtestId,
      patterns: [],
      thresholds: [],
    });

    const runAnalysis = async (ticks: import("@finwatch/shared").DataTick[]) => {
      const result = await cycleRunner.run(ticks);
      return result.anomalies;
    };

    // Create and run engine
    const engine = new BacktestEngine(p.config, { fetchData, runAnalysis });
    runningBacktests.set(backtestId, engine);

    engine.onProgress = (progress) => {
      writeNotification("backtest:progress", progress);
    };

    // Run in background — return immediately
    engine.run().then((result) => {
      runningBacktests.delete(backtestId);
      writeNotification("backtest:complete", {
        backtestId,
        status: result.status,
        metrics: result.metrics,
        trades: result.trades,
        equityCurve: result.equityCurve,
        error: result.error,
      });
    }).catch((err) => {
      runningBacktests.delete(backtestId);
      const message = err instanceof Error ? err.message : String(err);
      writeNotification("backtest:complete", {
        backtestId,
        status: "failed",
        metrics: null,
        trades: [],
        equityCurve: [],
        error: message,
      });
    });

    return { backtestId, status: "started" };
  });

  server.register("backtest:cancel", async (params) => {
    const p = params as unknown as { backtestId: string };
    const engine = runningBacktests.get(p.backtestId);

    if (!engine) {
      return { backtestId: p.backtestId, status: "not_found" };
    }

    engine.cancel();
    return { backtestId: p.backtestId, status: "cancelled" };
  });

  return server;
}

/** Write a JSON-RPC notification (no id) to stdout. */
function writeNotification(method: string, params: unknown): void {
  const notification = JSON.stringify({ jsonrpc: "2.0", method, params });
  process.stdout.write(notification + "\n");
}

export function start(): void {
  const server = createAgentServer();

  process.stdin.setEncoding("utf-8");
  let buffer = "";

  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim()) {
        server.handleRequest(line.trim()).then((response) => {
          process.stdout.write(response + "\n");
        });
      }
    }
  });
}

// Start when run directly
const isMain =
  process.argv[1]?.endsWith("index.ts") ||
  process.argv[1]?.endsWith("index.js");
if (isMain) {
  start();
}
