// agent/src/__tests__/integration/v8-subagents.test.ts
import { describe, it, expect, vi } from "vitest";
import type { LLMProvider, StreamEvent, Anomaly } from "@finwatch/shared";
import { SubagentSpawner } from "../../subagents/spawner.js";
import { SubagentPool } from "../../subagents/pool.js";
import type { InvestigationResult } from "../../subagents/spawner.js";

function mockSubagentProvider(
  response: string,
  delayMs = 0,
): LLMProvider {
  return {
    id: "mock-sub",
    name: "Mock Subagent",
    async *createMessage(): AsyncIterable<StreamEvent> {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      yield { type: "text_delta", text: response };
      yield { type: "usage", input: 50, output: 25 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi
      .fn()
      .mockResolvedValue({
        providerId: "mock-sub",
        status: "healthy",
        latencyMs: 10,
      }),
    listModels: vi.fn().mockReturnValue(["mock-model"]),
  };
}

function makeAnomaly(id: string): Anomaly {
  return {
    id,
    severity: "high",
    source: "yahoo",
    symbol: "AAPL",
    timestamp: Date.now(),
    description: "Volume is 3x the 20-day average",
    metrics: { volume: 15000000 },
    preScreenScore: 0.85,
    sessionId: "session-1",
  };
}

describe("V8: Subagent Integration", () => {
  it("spawns a subagent to investigate an anomaly and gets result", async () => {
    const spawner = new SubagentSpawner({
      provider: mockSubagentProvider(
        "Volume analysis for AAPL: Volume is 3x the 20-day average. This indicates unusual institutional activity.",
      ),
      model: "mock-model",
      maxTokens: 1024,
      temperature: 0,
    });

    const anomaly = makeAnomaly("anomaly-1");
    const result = await spawner.investigate(anomaly);

    expect(result.analysis).toContain("Volume analysis");
    expect(result.analysis).toContain("AAPL");
    expect(result.anomalyId).toBe("anomaly-1");
    expect(result.sessionId).toBeDefined();
    expect(result.tokensUsed.input).toBeGreaterThan(0);
  });

  it("pool enforces concurrency and queues excess tasks", async () => {
    let peakActive = 0;
    let currentActive = 0;

    const provider: LLMProvider = {
      id: "tracking",
      name: "Tracking",
      async *createMessage(): AsyncIterable<StreamEvent> {
        currentActive++;
        peakActive = Math.max(peakActive, currentActive);
        await new Promise((r) => setTimeout(r, 50));
        yield { type: "text_delta", text: "investigation complete" };
        yield { type: "usage", input: 10, output: 5 };
        yield { type: "stop", reason: "end_turn" };
        currentActive--;
      },
      healthCheck: vi
        .fn()
        .mockResolvedValue({
          providerId: "tracking",
          status: "healthy",
          latencyMs: 10,
        }),
      listModels: vi.fn().mockReturnValue(["mock-model"]),
    };

    const spawner = new SubagentSpawner({
      provider,
      model: "mock-model",
      maxTokens: 1024,
      temperature: 0,
    });

    const pool = new SubagentPool({
      maxConcurrent: 2,
      timeoutMs: 10000,
    });

    // Submit 5 tasks, only 2 should run at a time
    const promises = Array.from({ length: 5 }, (_, i) => {
      const anomaly = makeAnomaly(`anomaly-${i}`);
      return pool.submit(anomaly.id, () => spawner.investigate(anomaly));
    });

    const results = await Promise.all(promises);
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.analysis === "investigation complete")).toBe(
      true,
    );
    expect(peakActive).toBeLessThanOrEqual(2);
    expect(pool.completedCount).toBe(5);
  });
});
