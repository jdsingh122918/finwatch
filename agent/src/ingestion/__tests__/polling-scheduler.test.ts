import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DataTick, SourceHealth, SourceConfig } from "@finwatch/shared";
import type { DataSource } from "../types.js";
import { PollingScheduler } from "../polling-scheduler.js";

function createMockSource(
  id: string,
  pollIntervalMs: number,
  ticks: DataTick[] = []
): DataSource {
  return {
    id,
    config: {
      id,
      name: `Source ${id}`,
      type: "polling",
      plugin: "mock",
      config: {},
      pollIntervalMs,
      enabled: true,
    },
    start: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    stop: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    healthCheck: vi.fn<[], Promise<SourceHealth>>().mockResolvedValue({
      sourceId: id,
      status: "healthy",
      lastSuccess: Date.now(),
      failCount: 0,
      latencyMs: 10,
    }),
    fetch: vi.fn<[], Promise<DataTick[]>>().mockResolvedValue(ticks),
  };
}

function makeTick(sourceId: string): DataTick {
  return {
    sourceId,
    timestamp: Date.now(),
    metrics: { close: 100 },
    metadata: {},
  };
}

describe("PollingScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("constructs with default options", () => {
    const scheduler = new PollingScheduler();
    expect(scheduler).toBeDefined();
    scheduler.stopAll();
  });

  it("schedules a source and calls fetch at its pollIntervalMs", async () => {
    const source = createMockSource("s1", 2000, [makeTick("s1")]);

    const scheduler = new PollingScheduler();
    const onTicks = vi.fn();
    scheduler.on("ticks", onTicks);

    scheduler.schedule(source);

    // Advance past first interval
    await vi.advanceTimersByTimeAsync(2100);

    expect(source.fetch).toHaveBeenCalledOnce();
    expect(onTicks).toHaveBeenCalledOnce();
    expect(onTicks.mock.calls[0]![0]).toHaveLength(1);

    scheduler.stopAll();
  });

  it("polls repeatedly at the configured interval", async () => {
    const source = createMockSource("s1", 1000, [makeTick("s1")]);

    const scheduler = new PollingScheduler();
    scheduler.schedule(source);

    await vi.advanceTimersByTimeAsync(3100);

    expect(source.fetch).toHaveBeenCalledTimes(3);

    scheduler.stopAll();
  });

  it("uses default interval when source has no pollIntervalMs", async () => {
    const source = createMockSource("s1", 0, [makeTick("s1")]);
    // Remove pollIntervalMs
    (source.config as { pollIntervalMs?: number }).pollIntervalMs = undefined;

    const scheduler = new PollingScheduler({ defaultIntervalMs: 5000 });
    scheduler.schedule(source);

    await vi.advanceTimersByTimeAsync(5100);
    expect(source.fetch).toHaveBeenCalledOnce();

    scheduler.stopAll();
  });

  it("applies exponential backoff on fetch error", async () => {
    const source = createMockSource("s1", 1000);
    (source.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network error")
    );

    const scheduler = new PollingScheduler({
      maxBackoffMs: 16000,
      backoffMultiplier: 2,
    });
    const errorHandler = vi.fn();
    scheduler.on("error", errorHandler);
    scheduler.schedule(source);

    // First attempt at 1000ms (base interval)
    await vi.advanceTimersByTimeAsync(1100);
    expect(source.fetch).toHaveBeenCalledTimes(1);
    expect(errorHandler).toHaveBeenCalledTimes(1);

    // Second attempt at 2000ms (1000 * 2^1 backoff)
    await vi.advanceTimersByTimeAsync(2100);
    expect(source.fetch).toHaveBeenCalledTimes(2);

    // Third attempt at 4000ms (1000 * 2^2 backoff)
    await vi.advanceTimersByTimeAsync(4100);
    expect(source.fetch).toHaveBeenCalledTimes(3);

    scheduler.stopAll();
  });

  it("resets backoff after a successful fetch", async () => {
    const source = createMockSource("s1", 1000, [makeTick("s1")]);
    const fetchMock = source.fetch as ReturnType<typeof vi.fn>;

    // Fail first, succeed second
    fetchMock
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce([makeTick("s1")])
      .mockResolvedValue([makeTick("s1")]);

    const scheduler = new PollingScheduler({ backoffMultiplier: 2 });
    scheduler.schedule(source);

    // First attempt at 1000ms - fails
    await vi.advanceTimersByTimeAsync(1100);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second attempt at 2000ms (backed off) - succeeds
    await vi.advanceTimersByTimeAsync(2100);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Third attempt should be back to 1000ms (reset)
    await vi.advanceTimersByTimeAsync(1100);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    scheduler.stopAll();
  });

  it("caps backoff at maxBackoffMs", async () => {
    const source = createMockSource("s1", 1000);
    (source.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("fail")
    );

    const scheduler = new PollingScheduler({
      maxBackoffMs: 4000,
      backoffMultiplier: 2,
    });
    scheduler.schedule(source);

    // 1st: 1000ms
    await vi.advanceTimersByTimeAsync(1100);
    expect(source.fetch).toHaveBeenCalledTimes(1);

    // 2nd: 2000ms
    await vi.advanceTimersByTimeAsync(2100);
    expect(source.fetch).toHaveBeenCalledTimes(2);

    // 3rd: 4000ms (capped)
    await vi.advanceTimersByTimeAsync(4100);
    expect(source.fetch).toHaveBeenCalledTimes(3);

    // 4th: still 4000ms (capped, not 8000)
    await vi.advanceTimersByTimeAsync(4100);
    expect(source.fetch).toHaveBeenCalledTimes(4);

    scheduler.stopAll();
  });

  it("unschedules a specific source", async () => {
    const source = createMockSource("s1", 1000, [makeTick("s1")]);
    const scheduler = new PollingScheduler();
    scheduler.schedule(source);

    await vi.advanceTimersByTimeAsync(1100);
    expect(source.fetch).toHaveBeenCalledTimes(1);

    scheduler.unschedule("s1");

    await vi.advanceTimersByTimeAsync(3000);
    expect(source.fetch).toHaveBeenCalledTimes(1); // no more calls
  });

  it("stopAll cancels all scheduled sources", async () => {
    const s1 = createMockSource("s1", 1000, [makeTick("s1")]);
    const s2 = createMockSource("s2", 2000, [makeTick("s2")]);

    const scheduler = new PollingScheduler();
    scheduler.schedule(s1);
    scheduler.schedule(s2);

    scheduler.stopAll();

    await vi.advanceTimersByTimeAsync(5000);
    expect(s1.fetch).not.toHaveBeenCalled();
    expect(s2.fetch).not.toHaveBeenCalled();
  });

  it("emits 'ticks' event with fetched data", async () => {
    const ticks = [makeTick("s1"), makeTick("s1")];
    const source = createMockSource("s1", 1000, ticks);

    const scheduler = new PollingScheduler();
    const tickHandler = vi.fn();
    scheduler.on("ticks", tickHandler);
    scheduler.schedule(source);

    await vi.advanceTimersByTimeAsync(1100);

    expect(tickHandler).toHaveBeenCalledOnce();
    expect(tickHandler.mock.calls[0]![0]).toEqual(ticks);
    expect(tickHandler.mock.calls[0]![1]).toBe("s1");

    scheduler.stopAll();
  });

  it("does not emit ticks when fetch returns empty array", async () => {
    const source = createMockSource("s1", 1000, []);

    const scheduler = new PollingScheduler();
    const tickHandler = vi.fn();
    scheduler.on("ticks", tickHandler);
    scheduler.schedule(source);

    await vi.advanceTimersByTimeAsync(1100);

    expect(tickHandler).not.toHaveBeenCalled();

    scheduler.stopAll();
  });

  it("schedules multiple sources independently", async () => {
    const s1 = createMockSource("s1", 1000, [makeTick("s1")]);
    const s2 = createMockSource("s2", 3000, [makeTick("s2")]);

    const scheduler = new PollingScheduler();
    scheduler.schedule(s1);
    scheduler.schedule(s2);

    await vi.advanceTimersByTimeAsync(3100);

    expect(s1.fetch).toHaveBeenCalledTimes(3);
    expect(s2.fetch).toHaveBeenCalledTimes(1);

    scheduler.stopAll();
  });
});
