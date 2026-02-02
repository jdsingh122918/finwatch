// agent/src/__tests__/integration/v1-data-ingestion.test.ts
import { describe, it, expect, vi } from "vitest";
import type { DataTick, SourceConfig, SourceHealth } from "@finwatch/shared";
import { SourceRegistry } from "../../ingestion/source-registry.js";
import { DataBuffer } from "../../ingestion/data-buffer.js";
import { normalizeBatch } from "../../ingestion/normalizer.js";
import type { DataSource } from "../../ingestion/types.js";

function createMockSource(id: string, ticks: DataTick[]): DataSource {
  const config: SourceConfig = {
    id,
    name: id,
    type: "polling",
    plugin: "mock",
    config: {},
    enabled: true,
  };
  return {
    id,
    config,
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({
      sourceId: id,
      status: "healthy",
      lastSuccess: Date.now(),
      failCount: 0,
      latencyMs: 10,
    } satisfies SourceHealth),
    fetch: vi.fn().mockResolvedValue(ticks),
  };
}

describe("V1: Data Ingestion End-to-End", () => {
  it("configures a source, fetches ticks, normalizes, and buffers them", async () => {
    const registry = new SourceRegistry();
    const buffer = new DataBuffer({ flushIntervalMs: 100, urgentThreshold: 0.8 });

    const rawTicks: DataTick[] = Array.from({ length: 5 }, (_, i) => ({
      sourceId: "mock-yahoo",
      timestamp: Date.now() + i * 1000,
      metrics: { close: 150 + i, volume: 1000000 + i * 10000 },
      metadata: {},
    }));

    const source = createMockSource("mock-yahoo", rawTicks);
    registry.register(source);

    // Simulate 5 polling cycles
    for (let cycle = 0; cycle < 5; cycle++) {
      const fetched = await registry.fetch("mock-yahoo");
      const normalized = normalizeBatch(fetched);
      for (const tick of normalized) {
        buffer.push(tick);
      }
    }

    // Buffer should have accumulated 25 ticks (5 per cycle x 5 cycles)
    expect(buffer.size).toBe(25);

    // Start draining — nextBatch resolves after flushIntervalMs (100ms)
    const batchPromise = buffer.nextBatch();
    const batch = await batchPromise;

    expect(batch.length).toBe(25);
    expect(batch[0]!.sourceId).toBe("mock-yahoo");
    // Normalizer maps 'close' to 'close' (no alias), so it stays
    expect(batch[0]!.metrics.close).toBeDefined();

    buffer.destroy();
  });

  it("health check reports healthy after successful fetches", async () => {
    const registry = new SourceRegistry();
    const source = createMockSource("mock-yahoo", [
      {
        sourceId: "mock-yahoo",
        timestamp: Date.now(),
        metrics: { close: 150, volume: 1000000 },
        metadata: {},
      },
    ]);
    registry.register(source);

    await registry.fetch("mock-yahoo");
    const health = await registry.healthCheck();
    expect(
      health.some((h) => h.sourceId === "mock-yahoo" && h.status === "healthy"),
    ).toBe(true);
  });
});
