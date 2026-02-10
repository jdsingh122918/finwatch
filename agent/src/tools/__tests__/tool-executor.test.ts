import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import type { StreamEvent } from "@finwatch/shared";
import { ToolExecutor } from "../tool-executor.js";
import { ToolRegistry } from "../tool-registry.js";

function makeRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register({
    name: "search_memory",
    description: "Search memory for patterns",
    inputSchema: z.object({
      query: z.string(),
    }),
    handler: async (args) => ({ results: [`match for: ${args.query}`] }),
  });

  registry.register({
    name: "get_historical_data",
    description: "Get historical data",
    inputSchema: z.object({
      symbol: z.string(),
    }),
    handler: async (args) => ({ prices: [100, 101, 102], symbol: args.symbol }),
  });

  return registry;
}

describe("ToolExecutor", () => {
  it("collects tool_use events from stream and executes them", async () => {
    const registry = makeRegistry();
    const executor = new ToolExecutor(registry);

    const events: StreamEvent[] = [
      { type: "text_delta", text: "Analyzing..." },
      { type: "tool_use", id: "t1", name: "search_memory", input: { query: "volume spikes" } },
      { type: "usage", input: 100, output: 50 },
      { type: "stop", reason: "end_turn" },
    ];

    const results = await executor.processEvents(events);

    expect(results).toHaveLength(1);
    expect(results[0]!.toolUseId).toBe("t1");
    expect(results[0]!.toolName).toBe("search_memory");
    expect(results[0]!.output).toEqual({ results: ["match for: volume spikes"] });
    expect(results[0]!.error).toBeUndefined();
  });

  it("executes multiple tool calls", async () => {
    const registry = makeRegistry();
    const executor = new ToolExecutor(registry);

    const events: StreamEvent[] = [
      { type: "tool_use", id: "t1", name: "search_memory", input: { query: "patterns" } },
      { type: "tool_use", id: "t2", name: "get_historical_data", input: { symbol: "AAPL" } },
      { type: "stop", reason: "end_turn" },
    ];

    const results = await executor.processEvents(events);

    expect(results).toHaveLength(2);
    expect(results[0]!.toolName).toBe("search_memory");
    expect(results[1]!.toolName).toBe("get_historical_data");
    expect(results[1]!.output).toEqual({ prices: [100, 101, 102], symbol: "AAPL" });
  });

  it("captures error when tool execution fails", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "failing_tool",
      description: "Always fails",
      inputSchema: z.object({}),
      handler: async () => { throw new Error("tool broke"); },
    });

    const executor = new ToolExecutor(registry);

    const events: StreamEvent[] = [
      { type: "tool_use", id: "t1", name: "failing_tool", input: {} },
      { type: "stop", reason: "end_turn" },
    ];

    const results = await executor.processEvents(events);

    expect(results).toHaveLength(1);
    expect(results[0]!.error).toContain("tool broke");
    expect(results[0]!.output).toBeUndefined();
  });

  it("captures error when tool is not found", async () => {
    const registry = new ToolRegistry();
    const executor = new ToolExecutor(registry);

    const events: StreamEvent[] = [
      { type: "tool_use", id: "t1", name: "nonexistent", input: {} },
      { type: "stop", reason: "end_turn" },
    ];

    const results = await executor.processEvents(events);

    expect(results).toHaveLength(1);
    expect(results[0]!.error).toContain("not found");
  });

  it("returns empty array when no tool_use events", async () => {
    const registry = makeRegistry();
    const executor = new ToolExecutor(registry);

    const events: StreamEvent[] = [
      { type: "text_delta", text: "Just text" },
      { type: "stop", reason: "end_turn" },
    ];

    const results = await executor.processEvents(events);
    expect(results).toEqual([]);
  });
});
