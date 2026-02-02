import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DataTick } from "@finwatch/shared";
import { DataBuffer } from "../data-buffer.js";

function makeTick(overrides: Partial<DataTick> = {}): DataTick {
  return {
    sourceId: "test",
    timestamp: Date.now(),
    metrics: { close: 100 },
    metadata: {},
    ...overrides,
  };
}

describe("DataBuffer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accumulates ticks via push()", () => {
    const buffer = new DataBuffer({ flushIntervalMs: 5000, urgentThreshold: 0.8 });
    buffer.push(makeTick());
    buffer.push(makeTick());
    expect(buffer.size).toBe(2);
  });

  it("nextBatch() resolves after flush interval with accumulated ticks", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 1000, urgentThreshold: 0.8 });
    buffer.push(makeTick({ metrics: { close: 100 } }));
    buffer.push(makeTick({ metrics: { close: 101 } }));

    const batchPromise = buffer.nextBatch();

    // Advance time past interval
    vi.advanceTimersByTime(1100);

    const batch = await batchPromise;
    expect(batch).toHaveLength(2);
    expect(batch[0]!.metrics.close).toBe(100);
    expect(batch[1]!.metrics.close).toBe(101);
  });

  it("buffer is empty after nextBatch() resolves", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 1000, urgentThreshold: 0.8 });
    buffer.push(makeTick());

    const batchPromise = buffer.nextBatch();
    vi.advanceTimersByTime(1100);
    await batchPromise;

    expect(buffer.size).toBe(0);
  });

  it("nextBatch() resolves immediately when urgent tick is pushed", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 60000, urgentThreshold: 0.6 });

    buffer.push(makeTick({ metrics: { close: 100 } }));
    const batchPromise = buffer.nextBatch();

    // Push an urgent tick (preScreenScore above threshold)
    buffer.pushUrgent(makeTick({ metrics: { close: 200 } }), 0.9);

    const batch = await batchPromise;
    expect(batch).toHaveLength(2);
  });

  it("urgent push below threshold does not trigger immediate flush", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 5000, urgentThreshold: 0.8 });

    buffer.push(makeTick());
    const batchPromise = buffer.nextBatch();

    // Push a tick with score below threshold
    buffer.pushUrgent(makeTick(), 0.5);

    // Should not resolve yet
    let resolved = false;
    batchPromise.then(() => {
      resolved = true;
    });

    // Give microtasks a chance to run
    await vi.advanceTimersByTimeAsync(100);
    expect(resolved).toBe(false);

    // Now advance past interval
    vi.advanceTimersByTime(5000);
    const batch = await batchPromise;
    expect(batch).toHaveLength(2);
  });

  it("emits 'flush' event when batch is flushed", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 1000, urgentThreshold: 0.8 });
    const flushHandler = vi.fn();
    buffer.on("flush", flushHandler);

    buffer.push(makeTick());
    const batchPromise = buffer.nextBatch();
    vi.advanceTimersByTime(1100);
    await batchPromise;

    expect(flushHandler).toHaveBeenCalledOnce();
    expect(flushHandler).toHaveBeenCalledWith(expect.any(Array));
  });

  it("emits 'urgent' event when urgent tick triggers flush", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 60000, urgentThreshold: 0.6 });
    const urgentHandler = vi.fn();
    buffer.on("urgent", urgentHandler);

    buffer.push(makeTick());
    const batchPromise = buffer.nextBatch();
    buffer.pushUrgent(makeTick(), 0.9);
    await batchPromise;

    expect(urgentHandler).toHaveBeenCalledOnce();
    expect(urgentHandler).toHaveBeenCalledWith(expect.objectContaining({
      score: 0.9,
    }));
  });

  it("multiple nextBatch() calls queue up and resolve in order", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 1000, urgentThreshold: 0.8 });

    buffer.push(makeTick({ metrics: { close: 100 } }));
    const batch1Promise = buffer.nextBatch();

    vi.advanceTimersByTime(1100);
    const batch1 = await batch1Promise;
    expect(batch1).toHaveLength(1);
    expect(batch1[0]!.metrics.close).toBe(100);

    buffer.push(makeTick({ metrics: { close: 200 } }));
    const batch2Promise = buffer.nextBatch();

    vi.advanceTimersByTime(1100);
    const batch2 = await batch2Promise;
    expect(batch2).toHaveLength(1);
    expect(batch2[0]!.metrics.close).toBe(200);
  });

  it("nextBatch() resolves with empty array if no ticks after interval", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 1000, urgentThreshold: 0.8 });

    const batchPromise = buffer.nextBatch();
    vi.advanceTimersByTime(1100);
    const batch = await batchPromise;

    expect(batch).toEqual([]);
  });

  it("destroy() cleans up timers and rejects pending nextBatch()", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 60000, urgentThreshold: 0.8 });
    buffer.push(makeTick());

    const batchPromise = buffer.nextBatch();
    buffer.destroy();

    await expect(batchPromise).rejects.toThrow("Buffer destroyed");
  });

  it("push after destroy throws", () => {
    const buffer = new DataBuffer({ flushIntervalMs: 1000, urgentThreshold: 0.8 });
    buffer.destroy();

    expect(() => buffer.push(makeTick())).toThrow("Buffer destroyed");
  });

  it("reports correct size as ticks accumulate and flush", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 1000, urgentThreshold: 0.8 });

    expect(buffer.size).toBe(0);
    buffer.push(makeTick());
    expect(buffer.size).toBe(1);
    buffer.push(makeTick());
    buffer.push(makeTick());
    expect(buffer.size).toBe(3);

    const batchPromise = buffer.nextBatch();
    vi.advanceTimersByTime(1100);
    await batchPromise;
    expect(buffer.size).toBe(0);
  });
});
