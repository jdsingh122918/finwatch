import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Controllable promise for BacktestEngine.run()
let resolveEngineRun: ((value: unknown) => void) | null = null;
let engineRunResult = {
  id: "bt-123",
  status: "completed",
  metrics: { totalReturn: 100 },
  trades: [],
  equityCurve: [],
  error: null,
};
const mockCancel = vi.fn();

vi.mock("../ingestion/alpaca-backfill.js", () => ({
  AlpacaBackfill: vi.fn().mockImplementation(() => ({
    fetchAllDateRange: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock("../backtesting/backtest-engine.js", () => ({
  BacktestEngine: vi.fn().mockImplementation(() => ({
    run: vi.fn(() => new Promise((resolve) => {
      resolveEngineRun = resolve;
    })),
    cancel: mockCancel,
    onProgress: undefined,
  })),
}));

vi.mock("../analysis/cycle-runner.js", () => ({
  CycleRunner: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({ anomalies: [], tickCount: 0, state: {} }),
  })),
}));

vi.mock("../providers/anthropic-provider.js", () => ({
  AnthropicProvider: vi.fn().mockImplementation(() => ({
    id: "anthropic",
    name: "Anthropic",
    createMessage: vi.fn(),
    healthCheck: vi.fn(),
    listModels: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock("../providers/openrouter-provider.js", () => ({
  OpenRouterProvider: vi.fn().mockImplementation(() => ({
    id: "openrouter",
    name: "OpenRouter",
    createMessage: vi.fn(),
    healthCheck: vi.fn(),
    listModels: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock("../providers/fallback.js", () => ({
  withFallback: vi.fn().mockImplementation((providers: unknown[]) => providers[0]),
}));

const VALID_BACKTEST_CONFIG = {
  id: "bt-123",
  symbols: ["AAPL"],
  startDate: "2024-01-01",
  endDate: "2024-06-30",
  timeframe: "1Day" as const,
  initialCapital: 100000,
  riskLimits: {
    maxPositionSizePct: 10,
    maxPortfolioExposurePct: 80,
    maxDailyTrades: 5,
    minTimeBetweenTradesSec: 60,
    maxConcentrationPct: 25,
  },
  severityThreshold: "medium" as const,
  confidenceThreshold: 0.5,
  preScreenerSensitivity: 0.3,
  tradeSizingStrategy: "fixed_qty" as const,
  modelId: "claude-haiku-4-5-20251001",
};

const BACKTEST_PARAMS = {
  config: VALID_BACKTEST_CONFIG,
  alpaca: { keyId: "PKTEST", secretKey: "SECRET" },
  llm: {
    anthropicApiKey: "sk-ant-test",
    model: "claude-haiku-4-5-20251001",
    maxTokens: 4096,
    temperature: 0.3,
  },
};

const originalStdoutWrite = process.stdout.write;

describe("backtest JSON-RPC commands", () => {
  let stdoutWrites: string[];

  beforeEach(() => {
    resolveEngineRun = null;
    mockCancel.mockClear();
    stdoutWrites = [];
    process.stdout.write = vi.fn((chunk: string | Uint8Array) => {
      stdoutWrites.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    }) as typeof process.stdout.write;
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
  });

  it("backtest:run returns started status immediately", async () => {
    const { createAgentServer } = await import("../index.js");
    const server = createAgentServer();

    const response = await server.handleRequest(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "backtest:run",
      params: BACKTEST_PARAMS,
    }));

    const parsed = JSON.parse(response);
    expect(parsed.result).toEqual({
      backtestId: "bt-123",
      status: "started",
    });
  });

  it("backtest:run requires at least one LLM key", async () => {
    // Temporarily clear env vars so fallback keys don't kick in
    const savedAnthropic = process.env.ANTHROPIC_API_KEY;
    const savedOpenRouter = process.env.OPENROUTER_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    try {
      const { createAgentServer } = await import("../index.js");
      const server = createAgentServer();

      const response = await server.handleRequest(JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "backtest:run",
        params: {
          config: VALID_BACKTEST_CONFIG,
          alpaca: { keyId: "PKTEST", secretKey: "SECRET" },
          llm: {
            model: "claude-haiku-4-5-20251001",
            maxTokens: 4096,
            temperature: 0.3,
          },
        },
      }));

      const parsed = JSON.parse(response);
      expect(parsed.error).toBeDefined();
      expect(parsed.error.message).toContain("LLM API key");
    } finally {
      if (savedAnthropic) process.env.ANTHROPIC_API_KEY = savedAnthropic;
      if (savedOpenRouter) process.env.OPENROUTER_API_KEY = savedOpenRouter;
    }
  });

  it("backtest:cancel returns cancelled status for running backtest", async () => {
    const { createAgentServer } = await import("../index.js");
    const server = createAgentServer();

    // Start a backtest — engine.run() will not resolve until we say so
    await server.handleRequest(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "backtest:run",
      params: BACKTEST_PARAMS,
    }));

    // Engine is still "running" (promise not resolved), so cancel should find it
    const response = await server.handleRequest(JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "backtest:cancel",
      params: { backtestId: "bt-123" },
    }));

    const parsed = JSON.parse(response);
    expect(parsed.result).toEqual({
      backtestId: "bt-123",
      status: "cancelled",
    });
    expect(mockCancel).toHaveBeenCalled();
  });

  it("backtest:cancel returns not_found for unknown backtest", async () => {
    const { createAgentServer } = await import("../index.js");
    const server = createAgentServer();

    const response = await server.handleRequest(JSON.stringify({
      jsonrpc: "2.0",
      id: 4,
      method: "backtest:cancel",
      params: { backtestId: "nonexistent" },
    }));

    const parsed = JSON.parse(response);
    expect(parsed.result).toEqual({
      backtestId: "nonexistent",
      status: "not_found",
    });
  });

  it("backtest:run emits backtest:complete notification after engine finishes", async () => {
    const { createAgentServer } = await import("../index.js");
    const server = createAgentServer();

    await server.handleRequest(JSON.stringify({
      jsonrpc: "2.0",
      id: 5,
      method: "backtest:run",
      params: BACKTEST_PARAMS,
    }));

    // Now resolve the engine run
    expect(resolveEngineRun).not.toBeNull();
    resolveEngineRun!(engineRunResult);

    // Allow microtasks to flush (.then() callback)
    await new Promise((resolve) => setTimeout(resolve, 50));

    const notifications = stdoutWrites
      .map((w) => w.trim())
      .filter((w) => w.length > 0)
      .map((w) => {
        try { return JSON.parse(w); } catch { return null; }
      })
      .filter((n) => n && n.method === "backtest:complete");

    expect(notifications.length).toBeGreaterThanOrEqual(1);
    expect(notifications[0].params).toEqual(
      expect.objectContaining({
        backtestId: "bt-123",
        status: "completed",
      }),
    );
  });
});
