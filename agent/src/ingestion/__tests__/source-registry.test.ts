import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DataTick, SourceHealth, SourceConfig } from "@finwatch/shared";
import { SourceRegistry } from "../source-registry.js";
import type { DataSource } from "../types.js";

function createMockSource(overrides: Partial<DataSource> = {}): DataSource {
  return {
    id: "mock-source",
    config: {
      id: "mock-source",
      name: "Mock Source",
      type: "polling",
      plugin: "mock",
      config: {},
      enabled: true,
    },
    start: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    stop: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    healthCheck: vi.fn<[], Promise<SourceHealth>>().mockResolvedValue({
      sourceId: "mock-source",
      status: "healthy",
      lastSuccess: Date.now(),
      failCount: 0,
      latencyMs: 10,
    }),
    fetch: vi.fn<[], Promise<DataTick[]>>().mockResolvedValue([]),
    ...overrides,
  };
}

describe("SourceRegistry", () => {
  let registry: SourceRegistry;

  beforeEach(() => {
    registry = new SourceRegistry();
  });

  it("registers a source and retrieves it by id", () => {
    const source = createMockSource({ id: "src-1" });
    registry.register(source);
    expect(registry.get("src-1")).toBe(source);
  });

  it("returns undefined for unregistered source", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("lists all registered sources", () => {
    registry.register(createMockSource({ id: "a" }));
    registry.register(createMockSource({ id: "b" }));
    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("prevents duplicate source registration", () => {
    registry.register(createMockSource({ id: "dup" }));
    expect(() => registry.register(createMockSource({ id: "dup" }))).toThrow(
      "Source already registered: dup"
    );
  });

  it("unregisters a source by id", () => {
    registry.register(createMockSource({ id: "removable" }));
    expect(registry.get("removable")).toBeDefined();
    registry.unregister("removable");
    expect(registry.get("removable")).toBeUndefined();
  });

  it("starts a specific source", async () => {
    const source = createMockSource({ id: "s1" });
    registry.register(source);
    await registry.start("s1");
    expect(source.start).toHaveBeenCalledOnce();
  });

  it("stops a specific source", async () => {
    const source = createMockSource({ id: "s1" });
    registry.register(source);
    await registry.start("s1");
    await registry.stop("s1");
    expect(source.stop).toHaveBeenCalledOnce();
  });

  it("starts all registered sources", async () => {
    const s1 = createMockSource({ id: "s1" });
    const s2 = createMockSource({ id: "s2" });
    registry.register(s1);
    registry.register(s2);
    await registry.startAll();
    expect(s1.start).toHaveBeenCalledOnce();
    expect(s2.start).toHaveBeenCalledOnce();
  });

  it("stops all registered sources", async () => {
    const s1 = createMockSource({ id: "s1" });
    const s2 = createMockSource({ id: "s2" });
    registry.register(s1);
    registry.register(s2);
    await registry.startAll();
    await registry.stopAll();
    expect(s1.stop).toHaveBeenCalledOnce();
    expect(s2.stop).toHaveBeenCalledOnce();
  });

  it("returns health for all sources", async () => {
    const s1 = createMockSource({
      id: "healthy-one",
      healthCheck: vi.fn<[], Promise<SourceHealth>>().mockResolvedValue({
        sourceId: "healthy-one",
        status: "healthy",
        lastSuccess: Date.now(),
        failCount: 0,
        latencyMs: 15,
      }),
    });
    const s2 = createMockSource({
      id: "degraded-one",
      healthCheck: vi.fn<[], Promise<SourceHealth>>().mockResolvedValue({
        sourceId: "degraded-one",
        status: "degraded",
        lastSuccess: Date.now() - 60000,
        failCount: 2,
        latencyMs: 800,
        message: "slow responses",
      }),
    });
    registry.register(s1);
    registry.register(s2);

    const health = await registry.healthCheck();
    expect(health).toHaveLength(2);
    expect(health[0]!.sourceId).toBe("healthy-one");
    expect(health[0]!.status).toBe("healthy");
    expect(health[1]!.sourceId).toBe("degraded-one");
    expect(health[1]!.status).toBe("degraded");
  });

  it("handles health check failures gracefully", async () => {
    const source = createMockSource({
      id: "broken",
      healthCheck: vi
        .fn<[], Promise<SourceHealth>>()
        .mockRejectedValue(new Error("connection refused")),
    });
    registry.register(source);

    const health = await registry.healthCheck();
    expect(health).toHaveLength(1);
    expect(health[0]!.sourceId).toBe("broken");
    expect(health[0]!.status).toBe("offline");
    expect(health[0]!.message).toContain("connection refused");
  });

  it("throws when starting an unregistered source", async () => {
    await expect(registry.start("nonexistent")).rejects.toThrow(
      "Source not found: nonexistent"
    );
  });

  it("throws when stopping an unregistered source", async () => {
    await expect(registry.stop("nonexistent")).rejects.toThrow(
      "Source not found: nonexistent"
    );
  });

  it("does not start a disabled source via startAll", async () => {
    const disabledSource = createMockSource({
      id: "disabled-src",
      config: {
        id: "disabled-src",
        name: "Disabled",
        type: "polling",
        plugin: "mock",
        config: {},
        enabled: false,
      },
    });
    registry.register(disabledSource);
    await registry.startAll();
    expect(disabledSource.start).not.toHaveBeenCalled();
  });

  it("fetches ticks from a specific source", async () => {
    const ticks: DataTick[] = [
      {
        sourceId: "fetcher",
        timestamp: Date.now(),
        symbol: "AAPL",
        metrics: { close: 150.0 },
        metadata: {},
      },
    ];
    const source = createMockSource({
      id: "fetcher",
      fetch: vi.fn<[], Promise<DataTick[]>>().mockResolvedValue(ticks),
    });
    registry.register(source);

    const result = await registry.fetch("fetcher");
    expect(result).toEqual(ticks);
  });
});
