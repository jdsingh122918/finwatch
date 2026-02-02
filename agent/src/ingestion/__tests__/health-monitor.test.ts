import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SourceHealth } from "@finwatch/shared";
import type { DataSource } from "../types.js";
import { SourceRegistry } from "../source-registry.js";
import { HealthMonitor } from "../health-monitor.js";

function createMockSource(
  id: string,
  healthResult: SourceHealth
): DataSource {
  return {
    id,
    config: {
      id,
      name: `Source ${id}`,
      type: "polling",
      plugin: "mock",
      config: {},
      enabled: true,
    },
    start: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    stop: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    healthCheck: vi.fn<[], Promise<SourceHealth>>().mockResolvedValue(healthResult),
    fetch: vi.fn().mockResolvedValue([]),
  };
}

function healthyResult(id: string): SourceHealth {
  return {
    sourceId: id,
    status: "healthy",
    lastSuccess: Date.now(),
    failCount: 0,
    latencyMs: 10,
  };
}

function degradedResult(id: string): SourceHealth {
  return {
    sourceId: id,
    status: "degraded",
    lastSuccess: Date.now() - 30000,
    failCount: 2,
    latencyMs: 500,
    message: "high latency",
  };
}

function offlineResult(id: string): SourceHealth {
  return {
    sourceId: id,
    status: "offline",
    lastSuccess: 0,
    failCount: 5,
    latencyMs: -1,
    message: "connection refused",
  };
}

describe("HealthMonitor", () => {
  let registry: SourceRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new SourceRegistry();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("constructs with registry and check interval", () => {
    const monitor = new HealthMonitor(registry, { checkIntervalMs: 5000 });
    expect(monitor).toBeDefined();
    monitor.stop();
  });

  it("runs health check on all sources at the configured interval", async () => {
    const source = createMockSource("s1", healthyResult("s1"));
    registry.register(source);

    const monitor = new HealthMonitor(registry, { checkIntervalMs: 1000 });
    monitor.start();

    // Advance past first interval
    await vi.advanceTimersByTimeAsync(1100);

    expect(source.healthCheck).toHaveBeenCalledOnce();

    // Advance past second interval
    await vi.advanceTimersByTimeAsync(1000);
    expect(source.healthCheck).toHaveBeenCalledTimes(2);

    monitor.stop();
  });

  it("emits 'health-change' when source status transitions", async () => {
    const source = createMockSource("s1", healthyResult("s1"));
    registry.register(source);

    const monitor = new HealthMonitor(registry, { checkIntervalMs: 1000 });
    const changeHandler = vi.fn();
    monitor.on("health-change", changeHandler);
    monitor.start();

    // First check: healthy (initial)
    await vi.advanceTimersByTimeAsync(1100);
    // First report always emits since status is new
    expect(changeHandler).toHaveBeenCalledTimes(1);

    // Change to degraded
    (source.healthCheck as ReturnType<typeof vi.fn>).mockResolvedValue(
      degradedResult("s1")
    );
    await vi.advanceTimersByTimeAsync(1000);

    expect(changeHandler).toHaveBeenCalledTimes(2);
    const lastCall = changeHandler.mock.calls[1]![0] as SourceHealth;
    expect(lastCall.status).toBe("degraded");

    monitor.stop();
  });

  it("does not emit when status stays the same", async () => {
    const source = createMockSource("s1", healthyResult("s1"));
    registry.register(source);

    const monitor = new HealthMonitor(registry, { checkIntervalMs: 1000 });
    const changeHandler = vi.fn();
    monitor.on("health-change", changeHandler);
    monitor.start();

    // First check
    await vi.advanceTimersByTimeAsync(1100);
    expect(changeHandler).toHaveBeenCalledTimes(1);

    // Second check with same status
    await vi.advanceTimersByTimeAsync(1000);
    expect(changeHandler).toHaveBeenCalledTimes(1); // no new emission

    monitor.stop();
  });

  it("emits 'offline' event when source goes offline", async () => {
    const source = createMockSource("s1", healthyResult("s1"));
    registry.register(source);

    const monitor = new HealthMonitor(registry, { checkIntervalMs: 1000 });
    const offlineHandler = vi.fn();
    monitor.on("offline", offlineHandler);
    monitor.start();

    // First check: healthy
    await vi.advanceTimersByTimeAsync(1100);

    // Go offline
    (source.healthCheck as ReturnType<typeof vi.fn>).mockResolvedValue(
      offlineResult("s1")
    );
    await vi.advanceTimersByTimeAsync(1000);

    expect(offlineHandler).toHaveBeenCalledOnce();
    expect(offlineHandler.mock.calls[0]![0]).toBe("s1");

    monitor.stop();
  });

  it("emits 'degraded' event when source degrades", async () => {
    const source = createMockSource("s1", healthyResult("s1"));
    registry.register(source);

    const monitor = new HealthMonitor(registry, { checkIntervalMs: 1000 });
    const degradedHandler = vi.fn();
    monitor.on("degraded", degradedHandler);
    monitor.start();

    await vi.advanceTimersByTimeAsync(1100);

    (source.healthCheck as ReturnType<typeof vi.fn>).mockResolvedValue(
      degradedResult("s1")
    );
    await vi.advanceTimersByTimeAsync(1000);

    expect(degradedHandler).toHaveBeenCalledOnce();
    expect(degradedHandler.mock.calls[0]![0]).toBe("s1");

    monitor.stop();
  });

  it("emits 'recovered' when source returns to healthy", async () => {
    const source = createMockSource("s1", degradedResult("s1"));
    registry.register(source);

    const monitor = new HealthMonitor(registry, { checkIntervalMs: 1000 });
    const recoveredHandler = vi.fn();
    monitor.on("recovered", recoveredHandler);
    monitor.start();

    // First check: degraded
    await vi.advanceTimersByTimeAsync(1100);

    // Recover
    (source.healthCheck as ReturnType<typeof vi.fn>).mockResolvedValue(
      healthyResult("s1")
    );
    await vi.advanceTimersByTimeAsync(1000);

    expect(recoveredHandler).toHaveBeenCalledOnce();
    expect(recoveredHandler.mock.calls[0]![0]).toBe("s1");

    monitor.stop();
  });

  it("getHealth() returns latest health map for all sources", async () => {
    registry.register(createMockSource("s1", healthyResult("s1")));
    registry.register(createMockSource("s2", degradedResult("s2")));

    const monitor = new HealthMonitor(registry, { checkIntervalMs: 1000 });
    monitor.start();

    await vi.advanceTimersByTimeAsync(1100);

    const healthMap = monitor.getHealth();
    expect(healthMap.get("s1")?.status).toBe("healthy");
    expect(healthMap.get("s2")?.status).toBe("degraded");

    monitor.stop();
  });

  it("handles healthCheck() that throws an error", async () => {
    const source = createMockSource("s1", healthyResult("s1"));
    (source.healthCheck as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network error")
    );
    registry.register(source);

    const monitor = new HealthMonitor(registry, { checkIntervalMs: 1000 });
    const changeHandler = vi.fn();
    monitor.on("health-change", changeHandler);
    monitor.start();

    await vi.advanceTimersByTimeAsync(1100);

    expect(changeHandler).toHaveBeenCalledOnce();
    const health = changeHandler.mock.calls[0]![0] as SourceHealth;
    expect(health.status).toBe("offline");
    expect(health.message).toContain("network error");

    monitor.stop();
  });

  it("stop() clears the interval and prevents further checks", async () => {
    const source = createMockSource("s1", healthyResult("s1"));
    registry.register(source);

    const monitor = new HealthMonitor(registry, { checkIntervalMs: 1000 });
    monitor.start();

    await vi.advanceTimersByTimeAsync(1100);
    expect(source.healthCheck).toHaveBeenCalledTimes(1);

    monitor.stop();

    await vi.advanceTimersByTimeAsync(5000);
    expect(source.healthCheck).toHaveBeenCalledTimes(1); // no more calls
  });

  it("start() is idempotent", async () => {
    const source = createMockSource("s1", healthyResult("s1"));
    registry.register(source);

    const monitor = new HealthMonitor(registry, { checkIntervalMs: 1000 });
    monitor.start();
    monitor.start(); // no-op

    await vi.advanceTimersByTimeAsync(1100);
    expect(source.healthCheck).toHaveBeenCalledTimes(1);

    monitor.stop();
  });
});
