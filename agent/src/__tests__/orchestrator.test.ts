import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator } from "../orchestrator.js";

function mockProvider() {
  return {
    id: "mock",
    name: "Mock",
    createMessage: vi.fn(async function* () {
      yield { type: "text" as const, text: "No anomalies found." };
      yield { type: "stop" as const, reason: "end_turn" };
    }),
    healthCheck: vi.fn(async () => ({
      providerId: "mock",
      status: "healthy" as const,
      latencyMs: 10,
    })),
    listModels: vi.fn(() => ["mock-model"]),
  };
}

describe("Orchestrator", () => {
  it("creates and starts with valid config", async () => {
    const orch = new Orchestrator({
      alpaca: { keyId: "TEST", secretKey: "SECRET", symbols: ["AAPL"], feed: "iex" },
      llm: { providers: [mockProvider()], model: "mock-model", maxTokens: 4096, temperature: 0.3 },
      buffer: { flushIntervalMs: 5000, urgentThreshold: 0.8 },
    });

    expect(orch.status.state).toBe("idle");
  });

  it("emits tick events when sources produce data", () => {
    const orch = new Orchestrator({
      alpaca: { keyId: "TEST", secretKey: "SECRET", symbols: ["AAPL"], feed: "iex" },
      llm: { providers: [mockProvider()], model: "mock-model", maxTokens: 4096, temperature: 0.3 },
      buffer: { flushIntervalMs: 5000, urgentThreshold: 0.8 },
    });

    const ticks: unknown[] = [];
    orch.on("tick", (t) => ticks.push(t));

    orch.injectTick({
      sourceId: "test",
      timestamp: Date.now(),
      metrics: { close: 150 },
      metadata: {},
    });

    expect(ticks).toHaveLength(1);
  });

  it("exposes sources registry for external registration", () => {
    const orch = new Orchestrator({
      alpaca: { keyId: "TEST", secretKey: "SECRET", symbols: ["AAPL"], feed: "iex" },
      llm: { providers: [mockProvider()], model: "mock-model", maxTokens: 4096, temperature: 0.3 },
      buffer: { flushIntervalMs: 5000, urgentThreshold: 0.8 },
    });

    expect(orch.sources).toBeDefined();
    expect(typeof orch.sources.register).toBe("function");
  });

  it("stops cleanly", async () => {
    const orch = new Orchestrator({
      alpaca: { keyId: "TEST", secretKey: "SECRET", symbols: ["AAPL"], feed: "iex" },
      llm: { providers: [mockProvider()], model: "mock-model", maxTokens: 4096, temperature: 0.3 },
      buffer: { flushIntervalMs: 5000, urgentThreshold: 0.8 },
    });

    await orch.stop();
    expect(orch.status.state).toBe("idle");
  });
});
