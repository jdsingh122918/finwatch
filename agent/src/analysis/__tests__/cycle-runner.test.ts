import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  DataTick,
  LLMProvider,
  StreamEvent,
  CreateMessageParams,
  ProviderHealth,
  Anomaly,
  CycleState,
} from "@finwatch/shared";
import { CycleRunner, type CycleRunnerDeps } from "../cycle-runner.js";
import type { PreScreenConfig } from "../pre-screener.js";

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
});
