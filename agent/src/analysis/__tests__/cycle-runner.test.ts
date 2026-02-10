import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import type {
  DataTick,
  LLMProvider,
  StreamEvent,
  CreateMessageParams,
  ProviderHealth,
  Anomaly,
} from "@finwatch/shared";
import { CycleRunner, type CycleRunnerDeps } from "../cycle-runner.js";
import type { PreScreenConfig } from "../pre-screener.js";
import { ToolRegistry } from "../../tools/tool-registry.js";

function makeTick(overrides: Partial<DataTick> = {}): DataTick {
  return {
    sourceId: "yahoo",
    timestamp: Date.now(),
    symbol: "AAPL",
    metrics: { close: 184.4, volume: 49120300 },
    metadata: {},
    ...overrides,
  };
}

function createMockProvider(response: string): LLMProvider {
  return {
    id: "mock",
    name: "Mock Provider",
    async *createMessage(_params: CreateMessageParams): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", text: response };
      yield { type: "usage", input: 100, output: 50 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi.fn<[], Promise<ProviderHealth>>().mockResolvedValue({
      providerId: "mock",
      status: "healthy",
      latencyMs: 50,
    }),
    listModels: () => ["mock-model"],
  };
}

function createToolUseProvider(toolCalls: StreamEvent[]): LLMProvider {
  return {
    id: "mock-tool",
    name: "Mock Tool Provider",
    async *createMessage(_params: CreateMessageParams): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", text: "```json\n[]\n```" };
      for (const tc of toolCalls) {
        yield tc;
      }
      yield { type: "usage", input: 100, output: 50 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi.fn<[], Promise<ProviderHealth>>().mockResolvedValue({
      providerId: "mock-tool",
      status: "healthy",
      latencyMs: 50,
    }),
    listModels: () => ["mock-model"],
  };
}

function createFailingProvider(): LLMProvider {
  return {
    id: "failing",
    name: "Failing Provider",
    async *createMessage(_params: CreateMessageParams): AsyncIterable<StreamEvent> {
      throw new Error("Provider failure");
    },
    healthCheck: vi.fn<[], Promise<ProviderHealth>>().mockResolvedValue({
      providerId: "failing",
      status: "offline",
      latencyMs: -1,
    }),
    listModels: () => [],
  };
}

const defaultPreScreenConfig: PreScreenConfig = {
  zScoreThreshold: 3.0,
  urgentThreshold: 0.6,
  skipThreshold: 0.2,
};

function makeDeps(overrides: Partial<CycleRunnerDeps> = {}): CycleRunnerDeps {
  return {
    provider: createMockProvider(`\`\`\`json
[]
\`\`\``),
    model: "mock-model",
    maxTokens: 4096,
    temperature: 0.3,
    preScreenConfig: defaultPreScreenConfig,
    sessionId: "session-123",
    patterns: [],
    thresholds: [],
    ...overrides,
  };
}

describe("CycleRunner", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a cycle with unique ID", () => {
    const runner = new CycleRunner(makeDeps());
    const state = runner.state;
    expect(state.cycleId).toBeDefined();
    expect(state.cycleId.length).toBeGreaterThan(0);
    expect(state.sessionId).toBe("session-123");
  });

  it("runs a cycle with no anomalies detected", async () => {
    const runner = new CycleRunner(makeDeps());
    const ticks = [makeTick(), makeTick()];

    const result = await runner.run(ticks);

    expect(result.anomalies).toEqual([]);
    expect(result.tickCount).toBe(2);
    expect(result.state.batchNumber).toBe(1);
    expect(result.state.anomaliesDetected).toBe(0);
  });

  it("runs a cycle and detects anomalies from LLM response", async () => {
    const response = `\`\`\`json
[
  {
    "severity": "high",
    "source": "yahoo",
    "symbol": "AAPL",
    "description": "Unusual volume spike detected",
    "metrics": { "volume": 150000000 }
  }
]
\`\`\``;
    const runner = new CycleRunner(
      makeDeps({ provider: createMockProvider(response) })
    );
    const ticks = [makeTick({ metrics: { close: 184.4, volume: 150000000 } })];

    const result = await runner.run(ticks);

    expect(result.anomalies).toHaveLength(1);
    expect(result.anomalies[0]!.severity).toBe("high");
    expect(result.anomalies[0]!.sessionId).toBe("session-123");
    expect(result.state.anomaliesDetected).toBe(1);
  });

  it("increments batch number on successive runs", async () => {
    const runner = new CycleRunner(makeDeps());
    const ticks = [makeTick()];

    await runner.run(ticks);
    expect(runner.state.batchNumber).toBe(1);

    await runner.run(ticks);
    expect(runner.state.batchNumber).toBe(2);
  });

  it("accumulates anomaly count across runs", async () => {
    const response = `\`\`\`json
[{ "severity": "low", "source": "yahoo", "description": "Test", "metrics": {} }]
\`\`\``;
    const runner = new CycleRunner(
      makeDeps({ provider: createMockProvider(response) })
    );
    const ticks = [makeTick()];

    await runner.run(ticks);
    expect(runner.state.anomaliesDetected).toBe(1);

    await runner.run(ticks);
    expect(runner.state.anomaliesDetected).toBe(2);
  });

  it("returns empty result for empty tick batch", async () => {
    const runner = new CycleRunner(makeDeps());
    const result = await runner.run([]);

    expect(result.anomalies).toEqual([]);
    expect(result.tickCount).toBe(0);
  });

  it("emits onAnomaly callback for each detected anomaly", async () => {
    const response = `\`\`\`json
[
  { "severity": "high", "source": "yahoo", "symbol": "AAPL", "description": "Spike", "metrics": {} },
  { "severity": "low", "source": "csv", "description": "Drift", "metrics": {} }
]
\`\`\``;
    const onAnomaly = vi.fn<[Anomaly], void>();
    const runner = new CycleRunner(
      makeDeps({ provider: createMockProvider(response) })
    );
    runner.onAnomaly = onAnomaly;

    await runner.run([makeTick()]);

    expect(onAnomaly).toHaveBeenCalledTimes(2);
    expect(onAnomaly.mock.calls[0]![0]!.severity).toBe("high");
    expect(onAnomaly.mock.calls[1]![0]!.severity).toBe("low");
  });

  it("throws when LLM provider fails", async () => {
    const runner = new CycleRunner(
      makeDeps({ provider: createFailingProvider() })
    );

    await expect(runner.run([makeTick()])).rejects.toThrow("Provider failure");
  });

  it("passes correct model and temperature to provider", async () => {
    const createMessage = vi.fn<[CreateMessageParams], AsyncIterable<StreamEvent>>();
    createMessage.mockImplementation(async function* () {
      yield { type: "text_delta" as const, text: "```json\n[]\n```" };
      yield { type: "usage" as const, input: 10, output: 5 };
      yield { type: "stop" as const, reason: "end_turn" };
    });

    const provider: LLMProvider = {
      id: "spy",
      name: "Spy",
      createMessage,
      healthCheck: vi.fn<[], Promise<ProviderHealth>>().mockResolvedValue({
        providerId: "spy",
        status: "healthy",
        latencyMs: 50,
      }),
      listModels: () => ["test-model"],
    };

    const runner = new CycleRunner(
      makeDeps({ provider, model: "test-model", temperature: 0.7, maxTokens: 2048 })
    );
    await runner.run([makeTick()]);

    expect(createMessage).toHaveBeenCalledTimes(1);
    const params = createMessage.mock.calls[0]![0]!;
    expect(params.model).toBe("test-model");
    expect(params.temperature).toBe(0.7);
    expect(params.maxTokens).toBe(2048);
  });

  it("passes tool definitions to provider when toolRegistry is provided", async () => {
    const createMessage = vi.fn<[CreateMessageParams], AsyncIterable<StreamEvent>>();
    createMessage.mockImplementation(async function* () {
      yield { type: "text_delta" as const, text: "```json\n[]\n```" };
      yield { type: "usage" as const, input: 10, output: 5 };
      yield { type: "stop" as const, reason: "end_turn" };
    });

    const provider: LLMProvider = {
      id: "spy",
      name: "Spy",
      createMessage,
      healthCheck: vi.fn<[], Promise<ProviderHealth>>().mockResolvedValue({
        providerId: "spy",
        status: "healthy",
        latencyMs: 50,
      }),
      listModels: () => ["test-model"],
    };

    const toolRegistry = new ToolRegistry();
    toolRegistry.register({
      name: "search_memory",
      description: "Search memory",
      inputSchema: z.object({ query: z.string() }),
      handler: async () => ({ results: [] }),
    });

    const runner = new CycleRunner(
      makeDeps({ provider, toolRegistry })
    );
    await runner.run([makeTick()]);

    expect(createMessage).toHaveBeenCalledTimes(1);
    const params = createMessage.mock.calls[0]![0]!;
    expect(params.tools).toBeDefined();
    expect(params.tools).toHaveLength(1);
    expect(params.tools![0]!.name).toBe("search_memory");
  });

  it("does not pass tools when no toolRegistry provided", async () => {
    const createMessage = vi.fn<[CreateMessageParams], AsyncIterable<StreamEvent>>();
    createMessage.mockImplementation(async function* () {
      yield { type: "text_delta" as const, text: "```json\n[]\n```" };
      yield { type: "usage" as const, input: 10, output: 5 };
      yield { type: "stop" as const, reason: "end_turn" };
    });

    const provider: LLMProvider = {
      id: "spy",
      name: "Spy",
      createMessage,
      healthCheck: vi.fn<[], Promise<ProviderHealth>>().mockResolvedValue({
        providerId: "spy",
        status: "healthy",
        latencyMs: 50,
      }),
      listModels: () => ["test-model"],
    };

    const runner = new CycleRunner(makeDeps({ provider }));
    await runner.run([makeTick()]);

    const params = createMessage.mock.calls[0]![0]!;
    expect(params.tools).toBeUndefined();
  });

  it("injects memory context into system prompt when memoryContext provided", async () => {
    const createMessage = vi.fn<[CreateMessageParams], AsyncIterable<StreamEvent>>();
    createMessage.mockImplementation(async function* () {
      yield { type: "text_delta" as const, text: "```json\n[]\n```" };
      yield { type: "usage" as const, input: 10, output: 5 };
      yield { type: "stop" as const, reason: "end_turn" };
    });

    const provider: LLMProvider = {
      id: "spy",
      name: "Spy",
      createMessage,
      healthCheck: vi.fn<[], Promise<ProviderHealth>>().mockResolvedValue({
        providerId: "spy",
        status: "healthy",
        latencyMs: 50,
      }),
      listModels: () => ["test-model"],
    };

    const memoryContext = vi.fn().mockReturnValue("<relevant-context>\n## Relevant Memories\n- AAPL had a volume spike yesterday\n</relevant-context>");

    const runner = new CycleRunner(
      makeDeps({ provider, memoryContext })
    );
    await runner.run([makeTick()]);

    expect(memoryContext).toHaveBeenCalled();
    const params = createMessage.mock.calls[0]![0]!;
    expect(params.system).toContain("relevant-context");
    expect(params.system).toContain("AAPL had a volume spike yesterday");
  });

  it("does not inject memory context when memoryContext is not provided", async () => {
    const createMessage = vi.fn<[CreateMessageParams], AsyncIterable<StreamEvent>>();
    createMessage.mockImplementation(async function* () {
      yield { type: "text_delta" as const, text: "```json\n[]\n```" };
      yield { type: "usage" as const, input: 10, output: 5 };
      yield { type: "stop" as const, reason: "end_turn" };
    });

    const provider: LLMProvider = {
      id: "spy",
      name: "Spy",
      createMessage,
      healthCheck: vi.fn<[], Promise<ProviderHealth>>().mockResolvedValue({
        providerId: "spy",
        status: "healthy",
        latencyMs: 50,
      }),
      listModels: () => ["test-model"],
    };

    const runner = new CycleRunner(makeDeps({ provider }));
    await runner.run([makeTick()]);

    const params = createMessage.mock.calls[0]![0]!;
    expect(params.system).not.toContain("relevant-context");
  });

  describe("tool execution feedback loop", () => {
    it("executes tool_use events via ToolExecutor and includes results in CycleResult", async () => {
      const toolRegistry = new ToolRegistry();
      toolRegistry.register({
        name: "search_memory",
        description: "Search memory",
        inputSchema: z.object({ query: z.string() }),
        handler: async (args) => ({ results: [`found: ${args.query}`] }),
      });

      const provider = createToolUseProvider([
        { type: "tool_use", id: "t1", name: "search_memory", input: { query: "volume spikes" } },
      ]);

      const runner = new CycleRunner(makeDeps({ provider, toolRegistry }));
      const result = await runner.run([makeTick()]);

      expect(result.toolResults).toBeDefined();
      expect(result.toolResults).toHaveLength(1);
      expect(result.toolResults![0]!.toolUseId).toBe("t1");
      expect(result.toolResults![0]!.toolName).toBe("search_memory");
      expect(result.toolResults![0]!.output).toEqual({ results: ["found: volume spikes"] });
      expect(result.toolResults![0]!.error).toBeUndefined();
    });

    it("executes multiple tool calls and returns all results", async () => {
      const toolRegistry = new ToolRegistry();
      toolRegistry.register({
        name: "search_memory",
        description: "Search memory",
        inputSchema: z.object({ query: z.string() }),
        handler: async (args) => ({ results: [`found: ${args.query}`] }),
      });
      toolRegistry.register({
        name: "get_historical_data",
        description: "Get data",
        inputSchema: z.object({ symbol: z.string() }),
        handler: async (args) => ({ symbol: args.symbol, prices: [100, 101] }),
      });

      const provider = createToolUseProvider([
        { type: "tool_use", id: "t1", name: "search_memory", input: { query: "patterns" } },
        { type: "tool_use", id: "t2", name: "get_historical_data", input: { symbol: "AAPL" } },
      ]);

      const runner = new CycleRunner(makeDeps({ provider, toolRegistry }));
      const result = await runner.run([makeTick()]);

      expect(result.toolResults).toHaveLength(2);
      expect(result.toolResults![0]!.toolName).toBe("search_memory");
      expect(result.toolResults![1]!.toolName).toBe("get_historical_data");
      expect(result.toolResults![1]!.output).toEqual({ symbol: "AAPL", prices: [100, 101] });
    });

    it("captures tool errors in results without crashing the cycle", async () => {
      const toolRegistry = new ToolRegistry();
      toolRegistry.register({
        name: "search_memory",
        description: "Search memory",
        inputSchema: z.object({ query: z.string() }),
        handler: async () => { throw new Error("memory unavailable"); },
      });

      const provider = createToolUseProvider([
        { type: "tool_use", id: "t1", name: "search_memory", input: { query: "test" } },
      ]);

      const runner = new CycleRunner(makeDeps({ provider, toolRegistry }));
      const result = await runner.run([makeTick()]);

      expect(result.toolResults).toHaveLength(1);
      expect(result.toolResults![0]!.error).toContain("memory unavailable");
      expect(result.toolResults![0]!.output).toBeUndefined();
    });

    it("returns empty toolResults when no tool_use events in stream", async () => {
      const toolRegistry = new ToolRegistry();
      toolRegistry.register({
        name: "search_memory",
        description: "Search memory",
        inputSchema: z.object({ query: z.string() }),
        handler: async () => ({ results: [] }),
      });

      const runner = new CycleRunner(
        makeDeps({ provider: createMockProvider("```json\n[]\n```"), toolRegistry })
      );
      const result = await runner.run([makeTick()]);

      expect(result.toolResults).toEqual([]);
    });

    it("returns no toolResults field when no toolRegistry is provided", async () => {
      const runner = new CycleRunner(makeDeps());
      const result = await runner.run([makeTick()]);

      expect(result.toolResults).toBeUndefined();
    });
  });
});
