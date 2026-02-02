import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../tool-registry.js";

describe("ToolRegistry", () => {
  it("registers a tool and executes it with valid input", async () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "get_price",
      description: "Get current price for a symbol",
      inputSchema: z.object({
        symbol: z.string(),
      }),
      handler: async (args) => ({ price: 150.25, symbol: args.symbol }),
    });

    const result = await registry.execute("get_price", { symbol: "AAPL" });
    expect(result).toEqual({ price: 150.25, symbol: "AAPL" });
  });

  it("validates input against the Zod schema", async () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "get_price",
      description: "Get current price",
      inputSchema: z.object({
        symbol: z.string().min(1),
        exchange: z.enum(["NYSE", "NASDAQ"]),
      }),
      handler: async (args) => ({ ok: true, ...args }),
    });

    await expect(
      registry.execute("get_price", { symbol: "", exchange: "INVALID" })
    ).rejects.toThrow();
  });

  it("throws ToolNotFoundError for unregistered tool", async () => {
    const registry = new ToolRegistry();

    await expect(registry.execute("nonexistent", {})).rejects.toThrow(
      "Tool not found: nonexistent"
    );
  });

  it("throws ToolValidationError with details for bad input", async () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "analyze",
      description: "Analyze data",
      inputSchema: z.object({
        source: z.string(),
        depth: z.number().int().positive(),
      }),
      handler: async (args) => args,
    });

    try {
      await registry.execute("analyze", { source: 123, depth: -1 });
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      const message = (err as Error).message;
      expect(message).toContain("Validation failed");
    }
  });

  it("throws ToolExecutionError when handler throws", async () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "boom",
      description: "Always fails",
      inputSchema: z.object({}),
      handler: async () => {
        throw new Error("kaboom");
      },
    });

    try {
      await registry.execute("boom", {});
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain("kaboom");
    }
  });

  it("prevents duplicate tool registration", () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "tool_a",
      description: "A",
      inputSchema: z.object({}),
      handler: async () => ({}),
    });

    expect(() =>
      registry.register({
        name: "tool_a",
        description: "A duplicate",
        inputSchema: z.object({}),
        handler: async () => ({}),
      })
    ).toThrow("Tool already registered: tool_a");
  });

  it("lists all registered tool names", () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "tool_x",
      description: "X",
      inputSchema: z.object({}),
      handler: async () => ({}),
    });
    registry.register({
      name: "tool_y",
      description: "Y",
      inputSchema: z.object({}),
      handler: async () => ({}),
    });

    expect(registry.listTools()).toEqual(["tool_x", "tool_y"]);
  });

  it("returns tool definitions in LLM-compatible format", () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "search_web",
      description: "Search the internet",
      inputSchema: z.object({
        query: z.string().describe("Search query"),
        maxResults: z.number().int().optional().describe("Max results"),
      }),
      handler: async () => ({}),
    });

    const definitions = registry.getToolDefinitions();
    expect(definitions).toHaveLength(1);
    expect(definitions[0]!.name).toBe("search_web");
    expect(definitions[0]!.description).toBe("Search the internet");
    expect(definitions[0]!.inputSchema).toBeDefined();
    // The schema should be a JSON Schema object
    expect(definitions[0]!.inputSchema.type).toBe("object");
    expect(definitions[0]!.inputSchema.properties).toHaveProperty("query");
  });

  it("handles complex nested schemas", async () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "complex_tool",
      description: "Complex input",
      inputSchema: z.object({
        filters: z.object({
          severity: z.array(z.enum(["low", "medium", "high", "critical"])),
          since: z.number().optional(),
        }),
        limit: z.number().int().positive().default(10),
      }),
      handler: async (args) => ({ received: args }),
    });

    const result = await registry.execute("complex_tool", {
      filters: { severity: ["high", "critical"] },
    });

    expect(result).toEqual({
      received: {
        filters: { severity: ["high", "critical"] },
        limit: 10,
      },
    });
  });

  it("handler receives typed args after validation", async () => {
    const registry = new ToolRegistry();
    const handlerSpy = vi.fn().mockResolvedValue({ ok: true });

    registry.register({
      name: "typed_tool",
      description: "Typed handler",
      inputSchema: z.object({
        count: z.number(),
        label: z.string().default("default"),
      }),
      handler: handlerSpy,
    });

    await registry.execute("typed_tool", { count: 5 });

    expect(handlerSpy).toHaveBeenCalledWith({ count: 5, label: "default" });
  });

  it("unregisters a tool", async () => {
    const registry = new ToolRegistry();

    registry.register({
      name: "removable",
      description: "Removable",
      inputSchema: z.object({}),
      handler: async () => ({}),
    });

    expect(registry.listTools()).toContain("removable");
    registry.unregister("removable");
    expect(registry.listTools()).not.toContain("removable");

    await expect(registry.execute("removable", {})).rejects.toThrow(
      "Tool not found: removable"
    );
  });
});
