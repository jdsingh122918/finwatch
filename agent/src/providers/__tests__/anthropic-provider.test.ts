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
          data: [{ id: "claude-opus-4-5-20251101" }, { id: "claude-sonnet-4-5-20241022" }],
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
      model: "claude-opus-4-5-20251101",
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
      model: "claude-opus-4-5-20251101",
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
      model: "claude-sonnet-4-5-20241022",
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
        model: "claude-sonnet-4-5-20241022",
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
    expect(models).toContain("claude-opus-4-5-20251101");
    expect(models).toContain("claude-sonnet-4-5-20241022");
  });
});
