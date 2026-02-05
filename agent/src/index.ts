import "dotenv/config";
import type { LLMProvider, SourceConfig } from "@finwatch/shared";
import WebSocket from "ws";
import { JsonRpcServer } from "./ipc/json-rpc-server.js";
import { AlpacaStreamSource, type WsLike } from "./ingestion/alpaca-stream-source.js";
import { Orchestrator } from "./orchestrator.js";
import { AnthropicProvider } from "./providers/anthropic-provider.js";
import { OpenRouterProvider } from "./providers/openrouter-provider.js";

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

export function createAgentServer(): JsonRpcServer {
  const server = new JsonRpcServer();
  let orchestrator: Orchestrator | null = null;

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

    // Forward events as JSON-RPC notifications to stdout
    orchestrator.on("tick", (tick) => {
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
