import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CreateMessageParams, StreamEvent } from "@finwatch/shared";

// Mock the entire @anthropic-ai/sdk module
vi.mock("@anthropic-ai/sdk", () => {
  const mockCreate = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: mockCreate,
      },
      models: {
        list: vi.fn().mockResolvedValue({
          data: [{ id: "claude-opus-4-5-20250929" }, { id: "claude-sonnet-4-5-20250929" }],
        }),
      },
    })),
    __mockCreate: mockCreate,
  };
});

import Anthropic from "@anthropic-ai/sdk";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { __mockCreate: mockCreate } = await import("@anthropic-ai/sdk") as any;
import { AnthropicProvider } from "../anthropic-provider.js";

describe("AnthropicProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct id and name", () => {
    const provider = new AnthropicProvider({ apiKey: "test-key" });
    expect(provider.id).toBe("anthropic");
    expect(provider.name).toBe("Anthropic");
  });

  it("accepts custom id and name", () => {
    const provider = new AnthropicProvider({
      apiKey: "test-key",
      id: "my-anthropic",
      name: "My Anthropic",
    });
    expect(provider.id).toBe("my-anthropic");
    expect(provider.name).toBe("My Anthropic");
  });

  it("streams text deltas from the API", async () => {
    // Simulate an async iterable stream from the SDK
    async function* fakeStream() {
      yield {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello" },
      };
      yield {
        type: "content_block_delta",
        delta: { type: "text_delta", text: " World" },
      };
      yield {
        type: "message_delta",
        usage: { output_tokens: 10 },
      };
      yield {
        type: "message_stop",
      };
    }

    mockCreate.mockReturnValue(
      Object.assign(fakeStream(), {
        [Symbol.asyncIterator]() { return fakeStream(); },
      })
    );

    const provider = new AnthropicProvider({ apiKey: "test-key" });
    const params: CreateMessageParams = {
      model: "claude-opus-4-5-20250929",
      messages: [{ role: "user", content: "Hi" }],
      maxTokens: 1024,
    };

    const events: StreamEvent[] = [];
    for await (const event of provider.createMessage(params)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", text: "Hello" },
      { type: "text_delta", text: " World" },
      { type: "usage", input: 0, output: 10 },
      { type: "stop", reason: "end_turn" },
    ]);
  });

  it("yields usage event with input token count from message_start", async () => {
    async function* fakeStream() {
      yield {
        type: "message_start",
        message: { usage: { input_tokens: 42 } },
      };
      yield {
        type: "message_delta",
        usage: { output_tokens: 15 },
      };
      yield {
        type: "message_stop",
      };
    }

    mockCreate.mockReturnValue(
      Object.assign(fakeStream(), {
        [Symbol.asyncIterator]() { return fakeStream(); },
      })
    );

    const provider = new AnthropicProvider({ apiKey: "test-key" });
    const params: CreateMessageParams = {
      model: "claude-opus-4-5-20250929",
      messages: [{ role: "user", content: "Hi" }],
      maxTokens: 1024,
    };

    const events: StreamEvent[] = [];
    for await (const event of provider.createMessage(params)) {
      events.push(event);
    }

    // Should have a usage event at the end (from message_stop gathering counts)
    const usageEvent = events.find((e) => e.type === "usage");
    expect(usageEvent).toBeDefined();
    expect(usageEvent).toEqual({ type: "usage", input: 42, output: 15 });
  });

  it("passes system, temperature, and tools to the SDK", async () => {
    async function* fakeStream() {
      yield { type: "message_stop" };
    }

    mockCreate.mockReturnValue(
      Object.assign(fakeStream(), {
        [Symbol.asyncIterator]() { return fakeStream(); },
      })
    );

    const provider = new AnthropicProvider({ apiKey: "test-key" });
    const params: CreateMessageParams = {
      model: "claude-sonnet-4-5-20250929",
      system: "You are helpful.",
      messages: [{ role: "user", content: "Hi" }],
      maxTokens: 2048,
      temperature: 0.5,
      tools: [
        {
          name: "get_weather",
          description: "Get current weather",
          inputSchema: { type: "object", properties: { city: { type: "string" } } },
        },
      ],
    };

    // Consume the iterable to trigger the call
    const events: StreamEvent[] = [];
    for await (const event of provider.createMessage(params)) {
      events.push(event);
    }

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-4-5-20250929",
        system: "You are helpful.",
        max_tokens: 2048,
        temperature: 0.5,
        stream: true,
        messages: [{ role: "user", content: "Hi" }],
        tools: [
          {
            name: "get_weather",
            description: "Get current weather",
            input_schema: { type: "object", properties: { city: { type: "string" } } },
          },
        ],
      })
    );
  });

  it("healthCheck returns healthy on successful API call", async () => {
    async function* fakeStream() {
      yield { type: "message_stop" };
    }
    mockCreate.mockReturnValue(
      Object.assign(fakeStream(), {
        [Symbol.asyncIterator]() { return fakeStream(); },
      })
    );

    const provider = new AnthropicProvider({ apiKey: "test-key" });
    const health = await provider.healthCheck();
    expect(health.providerId).toBe("anthropic");
    expect(health.status).toBe("healthy");
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("healthCheck returns offline on API failure", async () => {
    mockCreate.mockRejectedValue(new Error("network error"));

    const provider = new AnthropicProvider({ apiKey: "test-key" });
    const health = await provider.healthCheck();
    expect(health.providerId).toBe("anthropic");
    expect(health.status).toBe("offline");
    expect(health.lastError).toContain("network error");
  });

  it("listModels returns supported models", () => {
    const provider = new AnthropicProvider({ apiKey: "test-key" });
    const models = provider.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models).toContain("claude-opus-4-5-20250929");
    expect(models).toContain("claude-sonnet-4-5-20250929");
  });

  describe("tool use streaming", () => {
    it("yields tool_use event from content_block_start and input_json_delta", async () => {
      async function* fakeStream() {
        yield {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "tool_use",
            id: "toolu_123",
            name: "search_memory",
            input: {},
          },
        };
        yield {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '{"query":' },
        };
        yield {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '"anomalies"}' },
        };
        yield {
          type: "content_block_stop",
          index: 1,
        };
        yield {
          type: "message_delta",
          usage: { output_tokens: 30 },
        };
        yield { type: "message_stop" };
      }

      mockCreate.mockReturnValue(
        Object.assign(fakeStream(), {
          [Symbol.asyncIterator]() { return fakeStream(); },
        })
      );

      const provider = new AnthropicProvider({ apiKey: "test-key" });
      const params: CreateMessageParams = {
        model: "claude-sonnet-4-5-20250929",
        messages: [{ role: "user", content: "Analyze data" }],
        maxTokens: 1024,
        tools: [{
          name: "search_memory",
          description: "Search memory",
          inputSchema: { type: "object", properties: { query: { type: "string" } } },
        }],
      };

      const events: StreamEvent[] = [];
      for await (const event of provider.createMessage(params)) {
        events.push(event);
      }

      const toolEvent = events.find((e) => e.type === "tool_use");
      expect(toolEvent).toEqual({
        type: "tool_use",
        id: "toolu_123",
        name: "search_memory",
        input: { query: "anomalies" },
      });
    });

    it("handles text and tool_use in same response", async () => {
      async function* fakeStream() {
        yield {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Let me search." },
        };
        yield {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "tool_use",
            id: "toolu_456",
            name: "get_historical_data",
            input: {},
          },
        };
        yield {
          type: "content_block_delta",
          index: 1,
          delta: { type: "input_json_delta", partial_json: '{"symbol":"AAPL"}' },
        };
        yield { type: "content_block_stop", index: 1 };
        yield { type: "message_delta", usage: { output_tokens: 20 } };
        yield { type: "message_stop" };
      }

      mockCreate.mockReturnValue(
        Object.assign(fakeStream(), {
          [Symbol.asyncIterator]() { return fakeStream(); },
        })
      );

      const provider = new AnthropicProvider({ apiKey: "test-key" });
      const params: CreateMessageParams = {
        model: "claude-sonnet-4-5-20250929",
        messages: [{ role: "user", content: "Check AAPL" }],
        maxTokens: 1024,
      };

      const events: StreamEvent[] = [];
      for await (const event of provider.createMessage(params)) {
        events.push(event);
      }

      expect(events[0]).toEqual({ type: "text_delta", text: "Let me search." });
      const toolEvent = events.find((e) => e.type === "tool_use");
      expect(toolEvent).toEqual({
        type: "tool_use",
        id: "toolu_456",
        name: "get_historical_data",
        input: { symbol: "AAPL" },
      });
    });
  });

  describe("structured JSON output", () => {
    it("appends JSON instruction to string system prompt when responseFormat is json_object", async () => {
      async function* fakeStream() {
        yield { type: "message_stop" };
      }

      mockCreate.mockReturnValue(
        Object.assign(fakeStream(), {
          [Symbol.asyncIterator]() { return fakeStream(); },
        })
      );

      const provider = new AnthropicProvider({ apiKey: "test-key" });
      const params: CreateMessageParams = {
        model: "claude-sonnet-4-5-20250929",
        system: "You are an analyst.",
        messages: [{ role: "user", content: "Analyze" }],
        maxTokens: 1024,
        responseFormat: { type: "json_object" },
      };

      for await (const _event of provider.createMessage(params)) {
        // drain
      }

      const callArgs = mockCreate.mock.calls[0]![0];
      expect(callArgs.system).toContain("You are an analyst.");
      expect(callArgs.system).toContain("valid JSON");
    });

    it("creates system prompt with JSON instruction when no system provided but responseFormat set", async () => {
      async function* fakeStream() {
        yield { type: "message_stop" };
      }

      mockCreate.mockReturnValue(
        Object.assign(fakeStream(), {
          [Symbol.asyncIterator]() { return fakeStream(); },
        })
      );

      const provider = new AnthropicProvider({ apiKey: "test-key" });
      const params: CreateMessageParams = {
        model: "claude-sonnet-4-5-20250929",
        messages: [{ role: "user", content: "Analyze" }],
        maxTokens: 1024,
        responseFormat: { type: "json_object" },
      };

      for await (const _event of provider.createMessage(params)) {
        // drain
      }

      const callArgs = mockCreate.mock.calls[0]![0];
      expect(callArgs.system).toContain("valid JSON");
    });

    it("appends JSON instruction with schema to systemBlocks when responseFormat has schema", async () => {
      async function* fakeStream() {
        yield { type: "message_stop" };
      }

      mockCreate.mockReturnValue(
        Object.assign(fakeStream(), {
          [Symbol.asyncIterator]() { return fakeStream(); },
        })
      );

      const provider = new AnthropicProvider({ apiKey: "test-key" });
      const schema = { type: "array", items: { type: "object" } };
      const params: CreateMessageParams = {
        model: "claude-sonnet-4-5-20250929",
        systemBlocks: [
          { type: "text" as const, text: "You are an analyst." },
        ],
        messages: [{ role: "user", content: "Analyze" }],
        maxTokens: 1024,
        responseFormat: { type: "json_object", schema },
      };

      for await (const _event of provider.createMessage(params)) {
        // drain
      }

      const callArgs = mockCreate.mock.calls[0]![0];
      // systemBlocks mode: should be an array with original + JSON instruction block
      expect(Array.isArray(callArgs.system)).toBe(true);
      const texts = callArgs.system.map((b: { text: string }) => b.text);
      expect(texts.some((t: string) => t.includes("You are an analyst."))).toBe(true);
      expect(texts.some((t: string) => t.includes("valid JSON") && t.includes('"type":"array"'))).toBe(true);
    });
  });

  describe("prompt caching", () => {
    it("tracks cache_creation_input_tokens and cache_read_input_tokens from message_start", async () => {
      async function* fakeStream() {
        yield {
          type: "message_start",
          message: {
            usage: {
              input_tokens: 100,
              cache_creation_input_tokens: 50,
              cache_read_input_tokens: 30,
            },
          },
        };
        yield {
          type: "message_delta",
          usage: { output_tokens: 20 },
        };
        yield { type: "message_stop" };
      }

      mockCreate.mockReturnValue(
        Object.assign(fakeStream(), {
          [Symbol.asyncIterator]() { return fakeStream(); },
        })
      );

      const provider = new AnthropicProvider({ apiKey: "test-key" });
      const params: CreateMessageParams = {
        model: "claude-sonnet-4-5-20250929",
        messages: [{ role: "user", content: "Hi" }],
        maxTokens: 1024,
      };

      const events: StreamEvent[] = [];
      for await (const event of provider.createMessage(params)) {
        events.push(event);
      }

      const usageEvent = events.find((e) => e.type === "usage");
      expect(usageEvent).toEqual({
        type: "usage",
        input: 100,
        output: 20,
        cacheCreation: 50,
        cacheRead: 30,
      });
    });

    it("omits cache fields when no cache stats in message_start", async () => {
      async function* fakeStream() {
        yield {
          type: "message_start",
          message: { usage: { input_tokens: 80 } },
        };
        yield {
          type: "message_delta",
          usage: { output_tokens: 10 },
        };
        yield { type: "message_stop" };
      }

      mockCreate.mockReturnValue(
        Object.assign(fakeStream(), {
          [Symbol.asyncIterator]() { return fakeStream(); },
        })
      );

      const provider = new AnthropicProvider({ apiKey: "test-key" });
      const params: CreateMessageParams = {
        model: "claude-sonnet-4-5-20250929",
        messages: [{ role: "user", content: "Hi" }],
        maxTokens: 1024,
      };

      const events: StreamEvent[] = [];
      for await (const event of provider.createMessage(params)) {
        events.push(event);
      }

      const usageEvent = events.find((e) => e.type === "usage");
      expect(usageEvent).toEqual({
        type: "usage",
        input: 80,
        output: 10,
      });
      // Should not have cache fields at all
      expect(usageEvent).not.toHaveProperty("cacheCreation");
      expect(usageEvent).not.toHaveProperty("cacheRead");
    });

    it("passes array-format system prompt with cache_control directly to SDK", async () => {
      async function* fakeStream() {
        yield { type: "message_stop" };
      }

      mockCreate.mockReturnValue(
        Object.assign(fakeStream(), {
          [Symbol.asyncIterator]() { return fakeStream(); },
        })
      );

      const provider = new AnthropicProvider({ apiKey: "test-key" });
      const systemBlocks = [
        { type: "text" as const, text: "You are a financial analyst.", cache_control: { type: "ephemeral" as const } },
        { type: "text" as const, text: "Analyze the data carefully." },
      ];
      const params: CreateMessageParams = {
        model: "claude-sonnet-4-5-20250929",
        systemBlocks,
        messages: [{ role: "user", content: "Analyze" }],
        maxTokens: 1024,
      };

      for await (const _event of provider.createMessage(params)) {
        // drain
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: [
            { type: "text", text: "You are a financial analyst.", cache_control: { type: "ephemeral" } },
            { type: "text", text: "Analyze the data carefully." },
          ],
        })
      );
    });

    it("prefers systemBlocks over system string when both provided", async () => {
      async function* fakeStream() {
        yield { type: "message_stop" };
      }

      mockCreate.mockReturnValue(
        Object.assign(fakeStream(), {
          [Symbol.asyncIterator]() { return fakeStream(); },
        })
      );

      const provider = new AnthropicProvider({ apiKey: "test-key" });
      const params: CreateMessageParams = {
        model: "claude-sonnet-4-5-20250929",
        system: "This should be ignored.",
        systemBlocks: [
          { type: "text" as const, text: "Use this instead.", cache_control: { type: "ephemeral" as const } },
        ],
        messages: [{ role: "user", content: "Hi" }],
        maxTokens: 1024,
      };

      for await (const _event of provider.createMessage(params)) {
        // drain
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: [
            { type: "text", text: "Use this instead.", cache_control: { type: "ephemeral" } },
          ],
        })
      );
    });
  });
});
