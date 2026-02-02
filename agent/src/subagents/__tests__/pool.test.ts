import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SubagentPool, type PoolConfig } from "../pool.js";
import type { InvestigationResult } from "../spawner.js";

type InvestigateFn = (id: string) => Promise<InvestigationResult>;

function makeResult(anomalyId: string, delay = 0): InvestigationResult {
  return {
    anomalyId,
    sessionId: `sub-${anomalyId}`,
    analysis: `Analysis of ${anomalyId}`,
    startedAt: Date.now(),
    completedAt: Date.now() + delay,
    tokensUsed: { input: 100, output: 50 },
  };
}

function createDelayedInvestigate(delayMs: number): InvestigateFn {
  return (id: string) =>
    new Promise((resolve) =>
      setTimeout(() => resolve(makeResult(id, delayMs)), delayMs)
    );
}

function createInstantInvestigate(): InvestigateFn {
  return (id: string) => Promise.resolve(makeResult(id));
}

function createFailingInvestigate(error: string): InvestigateFn {
  return (_id: string) => Promise.reject(new Error(error));
}

const defaultConfig: PoolConfig = {
  maxConcurrent: 2,
  timeoutMs: 5000,
};

describe("SubagentPool", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("executes a single task", async () => {
    const pool = new SubagentPool(defaultConfig);
    const investigate = createInstantInvestigate();

    const resultPromise = pool.submit("anomaly-1", investigate);
    const result = await resultPromise;

    expect(result.anomalyId).toBe("anomaly-1");
    expect(pool.activeCount).toBe(0);
  });

  it("respects maxConcurrent limit", async () => {
    const pool = new SubagentPool({ maxConcurrent: 2, timeoutMs: 5000 });
    const started: string[] = [];

    const slowInvestigate: InvestigateFn = (id: string) => {
      started.push(id);
      return new Promise((resolve) =>
        setTimeout(() => resolve(makeResult(id)), 100)
      );
    };

    // Submit 3 tasks; only 2 should start immediately
    const p1 = pool.submit("a1", slowInvestigate);
    const p2 = pool.submit("a2", slowInvestigate);
    const p3 = pool.submit("a3", slowInvestigate);

    // Let microtasks run
    await vi.advanceTimersByTimeAsync(0);

    expect(started).toEqual(["a1", "a2"]);
    expect(pool.activeCount).toBe(2);
    expect(pool.queuedCount).toBe(1);

    // Complete first batch
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(0);

    expect(started).toContain("a3");

    // Complete remaining
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([p1, p2, p3]);

    expect(pool.activeCount).toBe(0);
    expect(pool.queuedCount).toBe(0);
  });

  it("tracks completed count", async () => {
    const pool = new SubagentPool(defaultConfig);
    const investigate = createInstantInvestigate();

    expect(pool.completedCount).toBe(0);

    await pool.submit("a1", investigate);
    expect(pool.completedCount).toBe(1);

    await pool.submit("a2", investigate);
    expect(pool.completedCount).toBe(2);
  });

  it("handles task failures without blocking the pool", async () => {
    const pool = new SubagentPool(defaultConfig);
    const failInvestigate = createFailingInvestigate("investigation failed");
    const okInvestigate = createInstantInvestigate();

    const p1 = pool.submit("fail-1", failInvestigate);
    await expect(p1).rejects.toThrow("investigation failed");

    // Pool should still accept new work
    const result = await pool.submit("ok-1", okInvestigate);
    expect(result.anomalyId).toBe("ok-1");
    expect(pool.activeCount).toBe(0);
  });

  it("times out long-running tasks", async () => {
    vi.useRealTimers();
    const pool = new SubagentPool({ maxConcurrent: 2, timeoutMs: 50 });

    const neverResolve: InvestigateFn = (_id: string) =>
      new Promise(() => {
        // intentionally never resolves
      });

    const p = pool.submit("slow-1", neverResolve);

    await expect(p).rejects.toThrow("timed out");
    expect(pool.activeCount).toBe(0);
    vi.useFakeTimers();
  });

  it("processes queued items after active ones complete", async () => {
    const pool = new SubagentPool({ maxConcurrent: 1, timeoutMs: 5000 });
    const order: string[] = [];

    const trackingInvestigate: InvestigateFn = async (id: string) => {
      order.push(`start:${id}`);
      await new Promise((r) => setTimeout(r, 50));
      order.push(`end:${id}`);
      return makeResult(id);
    };

    const p1 = pool.submit("a1", trackingInvestigate);
    const p2 = pool.submit("a2", trackingInvestigate);

    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["start:a1"]);

    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(50);
    await Promise.all([p1, p2]);

    expect(order).toEqual(["start:a1", "end:a1", "start:a2", "end:a2"]);
  });

  it("reports correct counts at each stage", async () => {
    const pool = new SubagentPool({ maxConcurrent: 1, timeoutMs: 5000 });

    expect(pool.activeCount).toBe(0);
    expect(pool.queuedCount).toBe(0);
    expect(pool.completedCount).toBe(0);

    const investigate = createInstantInvestigate();
    await pool.submit("a1", investigate);

    expect(pool.activeCount).toBe(0);
    expect(pool.completedCount).toBe(1);
  });
});
