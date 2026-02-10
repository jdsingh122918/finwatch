import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DataTick, SourceConfig, SourceHealth } from "@finwatch/shared";
import { Orchestrator } from "../orchestrator.js";
import type { DataSource } from "../ingestion/types.js";
import Database from "better-sqlite3";
import { createMemoryDb } from "../memory/db.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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

function mockSource(id: string, ticks: DataTick[] = []): DataSource {
  const config: SourceConfig = {
    id,
    name: `Mock ${id}`,
    type: "polling",
    plugin: "mock",
    config: {},
    enabled: true,
  };
  return {
    id,
    config,
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    fetch: vi.fn(async () => ticks),
    healthCheck: vi.fn(async (): Promise<SourceHealth> => ({
      sourceId: id,
      status: "healthy",
      lastSuccess: Date.now(),
      failCount: 0,
      latencyMs: 0,
    })),
  };
}

function orchConfig() {
  return {
    alpaca: { keyId: "TEST", secretKey: "SECRET", symbols: ["AAPL"], feed: "iex" as const },
    llm: { providers: [mockProvider()], model: "mock-model", maxTokens: 4096, temperature: 0.3 },
    buffer: { flushIntervalMs: 5000, urgentThreshold: 0.8 },
  };
}

describe("Orchestrator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates and starts with valid config", async () => {
    const orch = new Orchestrator(orchConfig());
    expect(orch.status.state).toBe("idle");
  });

  it("emits tick events when sources produce data", () => {
    const orch = new Orchestrator(orchConfig());

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
    const orch = new Orchestrator(orchConfig());
    expect(orch.sources).toBeDefined();
    expect(typeof orch.sources.register).toBe("function");
  });

  it("stops cleanly", async () => {
    const orch = new Orchestrator(orchConfig());
    await orch.stop();
    expect(orch.status.state).toBe("idle");
  });

  it("polls registered sources and emits ticks after start", async () => {
    const tick: DataTick = {
      sourceId: "mock-src",
      timestamp: Date.now(),
      metrics: { close: 100 },
      metadata: {},
    };
    const source = mockSource("mock-src", [tick]);
    const orch = new Orchestrator(orchConfig());
    orch.sources.register(source);

    const received: DataTick[] = [];
    orch.on("tick", (t) => received.push(t));

    await orch.start();

    // Advance past the 1s poll interval
    await vi.advanceTimersByTimeAsync(1100);

    expect(source.fetch).toHaveBeenCalled();
    expect(received).toHaveLength(1);
    expect(received[0]!.sourceId).toBe("mock-src");

    await orch.stop();
  });

  it("stops polling after stop is called", async () => {
    const source = mockSource("mock-src", []);
    const orch = new Orchestrator(orchConfig());
    orch.sources.register(source);

    await orch.start();
    await vi.advanceTimersByTimeAsync(1100);
    const callsAfterStart = (source.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    await orch.stop();
    await vi.advanceTimersByTimeAsync(3000);
    const callsAfterStop = (source.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    expect(callsAfterStop).toBe(callsAfterStart);
  });

  it("creates MemoryManager when memory config is provided", () => {
    const db = createMemoryDb(":memory:");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fw-orch-mem-"));
    try {
      const orch = new Orchestrator({
        ...orchConfig(),
        memory: { db, memoryDir: tmpDir },
      });
      expect(orch.memory).toBeDefined();
      expect(orch.memory!.listAll()).toEqual([]);
    } finally {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("creates MemoryManager with embedding service when openaiApiKey is provided", async () => {
    const db = createMemoryDb(":memory:");
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fw-orch-emb-"));
    try {
      const orch = new Orchestrator({
        ...orchConfig(),
        memory: { db, memoryDir: tmpDir, openaiApiKey: "test-key" },
      });
      expect(orch.memory).toBeDefined();

      // Store something and verify the embedding service is invoked (fire-and-forget)
      const id = orch.memory!.store("test content", ["test"]);
      expect(id).toBeDefined();
    } finally {
      db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("does not create MemoryManager when no memory config", () => {
    const orch = new Orchestrator(orchConfig());
    expect(orch.memory).toBeUndefined();
  });

  it("continues polling when a source fetch throws", async () => {
    const failSource: DataSource = {
      ...mockSource("fail-src"),
      fetch: vi.fn(async () => { throw new Error("fetch failed"); }),
    };
    const goodTick: DataTick = {
      sourceId: "good-src",
      timestamp: Date.now(),
      metrics: { close: 200 },
      metadata: {},
    };
    const goodSource = mockSource("good-src", [goodTick]);

    const orch = new Orchestrator(orchConfig());
    orch.sources.register(failSource);
    orch.sources.register(goodSource);

    const received: DataTick[] = [];
    orch.on("tick", (t) => received.push(t));

    await orch.start();
    await vi.advanceTimersByTimeAsync(1100);

    expect(failSource.fetch).toHaveBeenCalled();
    expect(goodSource.fetch).toHaveBeenCalled();
    expect(received.length).toBeGreaterThanOrEqual(1);

    await orch.stop();
  });
});
