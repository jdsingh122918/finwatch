import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  Anomaly,
  LLMProvider,
  StreamEvent,
  CreateMessageParams,
  ProviderHealth,
} from "@finwatch/shared";
import { SubagentSpawner, type SpawnerDeps, type InvestigationResult } from "../spawner.js";

function makeAnomaly(overrides: Partial<Anomaly> = {}): Anomaly {
  return {
    id: "anomaly-1",
    severity: "high",
    source: "yahoo",
    symbol: "AAPL",
    timestamp: Date.now(),
    description: "Unusual volume spike",
    metrics: { volume: 150000000 },
    preScreenScore: 0.85,
    sessionId: "session-parent",
    ...overrides,
  };
}

function createMockProvider(response: string): LLMProvider {
  return {
    id: "mock",
    name: "Mock Provider",
    async *createMessage(_params: CreateMessageParams): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", text: response };
      yield { type: "usage", input: 200, output: 100 };
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

function makeDeps(overrides: Partial<SpawnerDeps> = {}): SpawnerDeps {
  return {
    provider: createMockProvider("## Investigation\n\nThe volume spike appears to be caused by earnings announcement. Confidence: high. Recommendation: monitor for follow-up."),
    model: "mock-model",
    maxTokens: 4096,
    temperature: 0.3,
    ...overrides,
  };
}

describe("SubagentSpawner", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("investigates an anomaly and returns a result", async () => {
    const spawner = new SubagentSpawner(makeDeps());
    const anomaly = makeAnomaly();

    const result = await spawner.investigate(anomaly);

    expect(result.anomalyId).toBe("anomaly-1");
    expect(result.analysis).toContain("volume spike");
    expect(result.sessionId).toBeDefined();
    expect(result.startedAt).toBeGreaterThan(0);
    expect(result.completedAt).toBeGreaterThanOrEqual(result.startedAt);
  });

  it("includes the anomaly details in the LLM prompt", async () => {
    const createMessage = vi.fn<[CreateMessageParams], AsyncIterable<StreamEvent>>();
    createMessage.mockImplementation(async function* () {
      yield { type: "text_delta" as const, text: "Analysis complete." };
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
      listModels: () => ["mock-model"],
    };

    const spawner = new SubagentSpawner(makeDeps({ provider }));
    await spawner.investigate(makeAnomaly({ symbol: "TSLA", description: "Price crash" }));

    expect(createMessage).toHaveBeenCalledTimes(1);
    const params = createMessage.mock.calls[0]![0]!;
    expect(params.messages[0]!.content).toContain("TSLA");
    expect(params.messages[0]!.content).toContain("Price crash");
  });

  it("generates unique session IDs for each investigation", async () => {
    const spawner = new SubagentSpawner(makeDeps());
    const r1 = await spawner.investigate(makeAnomaly({ id: "a1" }));
    const r2 = await spawner.investigate(makeAnomaly({ id: "a2" }));

    expect(r1.sessionId).not.toBe(r2.sessionId);
  });

  it("propagates provider errors", async () => {
    const provider: LLMProvider = {
      id: "failing",
      name: "Failing",
      async *createMessage(): AsyncIterable<StreamEvent> {
        throw new Error("Subagent provider failed");
      },
      healthCheck: vi.fn<[], Promise<ProviderHealth>>().mockResolvedValue({
        providerId: "failing",
        status: "offline",
        latencyMs: -1,
      }),
      listModels: () => [],
    };

    const spawner = new SubagentSpawner(makeDeps({ provider }));
    await expect(spawner.investigate(makeAnomaly())).rejects.toThrow(
      "Subagent provider failed"
    );
  });

  it("uses subagent model and temperature settings", async () => {
    const createMessage = vi.fn<[CreateMessageParams], AsyncIterable<StreamEvent>>();
    createMessage.mockImplementation(async function* () {
      yield { type: "text_delta" as const, text: "Done." };
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
      listModels: () => ["subagent-model"],
    };

    const spawner = new SubagentSpawner(
      makeDeps({ provider, model: "subagent-model", temperature: 0.5, maxTokens: 2048 })
    );
    await spawner.investigate(makeAnomaly());

    const params = createMessage.mock.calls[0]![0]!;
    expect(params.model).toBe("subagent-model");
    expect(params.temperature).toBe(0.5);
    expect(params.maxTokens).toBe(2048);
  });

  it("tracks token usage in the result", async () => {
    const spawner = new SubagentSpawner(makeDeps());
    const result = await spawner.investigate(makeAnomaly());

    expect(result.tokensUsed).toEqual({ input: 200, output: 100 });
  });
});
