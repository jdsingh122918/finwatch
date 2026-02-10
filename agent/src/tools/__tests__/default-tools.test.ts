import { describe, it, expect, vi } from "vitest";
import { registerDefaultTools, type ToolDataSources } from "../default-tools.js";
import { ToolRegistry } from "../tool-registry.js";

describe("registerDefaultTools", () => {
  it("registers search_memory and get_historical_data tools", () => {
    const registry = new ToolRegistry();
    registerDefaultTools(registry);

    const tools = registry.listTools();
    expect(tools).toContain("search_memory");
    expect(tools).toContain("get_historical_data");
  });

  it("search_memory returns results from provided memory store", async () => {
    const registry = new ToolRegistry();
    const memorySearch = vi.fn().mockResolvedValue([
      { text: "AAPL had a volume spike on 2026-01-15", score: 0.92 },
      { text: "Volume spikes often precede price movement", score: 0.85 },
    ]);
    registerDefaultTools(registry, { memorySearch });

    const result = (await registry.execute("search_memory", {
      query: "volume spikes",
      limit: 5,
    })) as { query: string; results: unknown[] };

    expect(memorySearch).toHaveBeenCalledWith("volume spikes", 5);
    expect(result.query).toBe("volume spikes");
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toEqual({ text: "AAPL had a volume spike on 2026-01-15", score: 0.92 });
  });

  it("search_memory returns empty results when no memory store provided", async () => {
    const registry = new ToolRegistry();
    registerDefaultTools(registry);

    const result = (await registry.execute("search_memory", {
      query: "volume anomaly",
    })) as { query: string; results: unknown[] };

    expect(result.query).toBe("volume anomaly");
    expect(result.results).toEqual([]);
  });

  it("search_memory uses default limit of 10 when not specified", async () => {
    const registry = new ToolRegistry();
    const memorySearch = vi.fn().mockResolvedValue([]);
    registerDefaultTools(registry, { memorySearch });

    await registry.execute("search_memory", { query: "test" });

    expect(memorySearch).toHaveBeenCalledWith("test", 10);
  });

  it("get_historical_data returns data from provided data source", async () => {
    const registry = new ToolRegistry();
    const historicalData = vi.fn().mockResolvedValue([
      { timestamp: 1706745600000, close: 184.4, volume: 49120300 },
      { timestamp: 1706832000000, close: 185.1, volume: 51230400 },
    ]);
    registerDefaultTools(registry, { historicalData });

    const result = (await registry.execute("get_historical_data", {
      symbol: "AAPL",
      days: 7,
    })) as { symbol: string; days: number; data: unknown[] };

    expect(historicalData).toHaveBeenCalledWith("AAPL", 7);
    expect(result.symbol).toBe("AAPL");
    expect(result.days).toBe(7);
    expect(result.data).toHaveLength(2);
  });

  it("get_historical_data returns empty data when no source provided", async () => {
    const registry = new ToolRegistry();
    registerDefaultTools(registry);

    const result = (await registry.execute("get_historical_data", {
      symbol: "AAPL",
      days: 30,
    })) as { symbol: string; days: number; data: unknown[] };

    expect(result.symbol).toBe("AAPL");
    expect(result.data).toEqual([]);
  });

  it("get_historical_data defaults to 30 days when not specified", async () => {
    const registry = new ToolRegistry();
    const historicalData = vi.fn().mockResolvedValue([]);
    registerDefaultTools(registry, { historicalData });

    await registry.execute("get_historical_data", { symbol: "GOOG" });

    expect(historicalData).toHaveBeenCalledWith("GOOG", 30);
  });

  it("returns tool definitions compatible with LLM providers", () => {
    const registry = new ToolRegistry();
    registerDefaultTools(registry);

    const definitions = registry.getToolDefinitions();
    expect(definitions).toHaveLength(2);

    const searchTool = definitions.find((d) => d.name === "search_memory");
    expect(searchTool).toBeDefined();
    expect(searchTool!.inputSchema.type).toBe("object");
    expect(searchTool!.inputSchema.properties).toHaveProperty("query");

    const dataTool = definitions.find((d) => d.name === "get_historical_data");
    expect(dataTool).toBeDefined();
    expect(dataTool!.inputSchema.type).toBe("object");
    expect(dataTool!.inputSchema.properties).toHaveProperty("symbol");
  });
});
