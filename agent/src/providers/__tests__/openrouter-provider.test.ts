import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CreateMessageParams, StreamEvent } from "@finwatch/shared";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { OpenRouterProvider } from "../openrouter-provider.js";

function createSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

describe("OpenRouterProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has correct id and name", () => {
    const provider = new OpenRouterProvider({ apiKey: "test-key" });
    expect(provider.id).toBe("openrouter");
    expect(provider.name).toBe("OpenRouter");
  });

  it("accepts custom id and name", () => {
    const provider = new OpenRouterProvider({
      apiKey: "test-key",
      id: "or-custom",
      name: "Custom OR",
    });
    expect(provider.id).toBe("or-custom");
    expect(provider.name).toBe("Custom OR");
  });

  it("streams text deltas from SSE response", async () => {
    const sseBody = createSSEStream([
      sseEvent({
        choices: [{ delta: { content: "Hello" }, finish_reason: null }],
      }),
      sseEvent({
        choices: [{ delta: { content: " World" }, finish_reason: null }],
      }),
      sseEvent({
        choices: [{ delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      "data: [DONE]\n\n",
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody,
    });

    const provider = new OpenRouterProvider({ apiKey: "test-key" });
    const params: CreateMessageParams = {
      model: "anthropic/claude-sonnet-4-5-20250929",
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
      { type: "usage", input: 10, output: 5 },
      { type: "stop", reason: "stop" },
    ]);
  });

  it("sends correct headers including OpenRouter-specific ones", async () => {
    const sseBody = createSSEStream([
      sseEvent({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      "data: [DONE]\n\n",
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody,
    });

    const provider = new OpenRouterProvider({
      apiKey: "or-test-key",
      referer: "https://finwatch.app",
      title: "FinWatch Agent",
    });
    const params: CreateMessageParams = {
      model: "anthropic/claude-sonnet-4-5-20250929",
      messages: [{ role: "user", content: "test" }],
      maxTokens: 512,
    };

    // Consume stream
    for await (const _event of provider.createMessage(params)) {
      // drain
    }

    expect(mockFetch).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: "Bearer or-test-key",
          "HTTP-Referer": "https://finwatch.app",
          "X-Title": "FinWatch Agent",
        }),
      })
    );
  });

  it("sends correct body with system message, temperature, and tools", async () => {
    const sseBody = createSSEStream([
      sseEvent({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      "data: [DONE]\n\n",
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody,
    });

    const provider = new OpenRouterProvider({ apiKey: "test-key" });
    const params: CreateMessageParams = {
      model: "anthropic/claude-opus-4-5-20250929",
      system: "Be concise.",
      messages: [{ role: "user", content: "Summarize" }],
      maxTokens: 4096,
      temperature: 0.7,
      tools: [
        {
          name: "search",
          description: "Search the web",
          inputSchema: { type: "object", properties: { query: { type: "string" } } },
        },
      ],
    };

    for await (const _event of provider.createMessage(params)) {
      // drain
    }

    const callArgs = mockFetch.mock.calls[0]!;
    const body = JSON.parse(callArgs[1].body as string);

    expect(body.model).toBe("anthropic/claude-opus-4-5-20250929");
    expect(body.max_tokens).toBe(4096);
    expect(body.temperature).toBe(0.7);
    expect(body.stream).toBe(true);
    // System message should be prepended as a system role message
    expect(body.messages[0]).toEqual({ role: "system", content: "Be concise." });
    expect(body.messages[1]).toEqual({ role: "user", content: "Summarize" });
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "search",
          description: "Search the web",
          parameters: { type: "object", properties: { query: { type: "string" } } },
        },
      },
    ]);
  });

  it("throws on non-ok HTTP response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: vi.fn().mockResolvedValue('{"error":{"message":"Rate limited"}}'),
    });

    const provider = new OpenRouterProvider({ apiKey: "test-key" });
    const params: CreateMessageParams = {
      model: "anthropic/claude-sonnet-4-5-20250929",
      messages: [{ role: "user", content: "Hi" }],
      maxTokens: 1024,
    };

    const events: StreamEvent[] = [];
    await expect(async () => {
      for await (const event of provider.createMessage(params)) {
        events.push(event);
      }
    }).rejects.toThrow("OpenRouter API error 429");
  });

  it("healthCheck returns healthy on success", async () => {
    const sseBody = createSSEStream([
      sseEvent({ choices: [{ delta: {}, finish_reason: "stop" }] }),
      "data: [DONE]\n\n",
    ]);

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody,
    });

    const provider = new OpenRouterProvider({ apiKey: "test-key" });
    const health = await provider.healthCheck();
    expect(health.providerId).toBe("openrouter");
    expect(health.status).toBe("healthy");
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("healthCheck returns offline on failure", async () => {
    mockFetch.mockRejectedValue(new Error("DNS resolution failed"));

    const provider = new OpenRouterProvider({ apiKey: "test-key" });
    const health = await provider.healthCheck();
    expect(health.providerId).toBe("openrouter");
    expect(health.status).toBe("offline");
    expect(health.lastError).toContain("DNS resolution failed");
  });

  it("listModels returns known models", () => {
    const provider = new OpenRouterProvider({ apiKey: "test-key" });
    const models = provider.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models).toContain("anthropic/claude-opus-4-5-20250929");
  });

  describe("tool use streaming", () => {
    it("yields tool_use event when finish_reason is tool_calls", async () => {
      const sseBody = createSSEStream([
        sseEvent({
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: "call_abc",
                type: "function",
                function: { name: "search_memory", arguments: "" },
              }],
            },
            finish_reason: null,
          }],
        }),
        sseEvent({
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: '{"query":' },
              }],
            },
            finish_reason: null,
          }],
        }),
        sseEvent({
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: '"test"}' },
              }],
            },
            finish_reason: null,
          }],
        }),
        sseEvent({
          choices: [{ delta: {}, finish_reason: "tool_calls" }],
          usage: { prompt_tokens: 50, completion_tokens: 20 },
        }),
        "data: [DONE]\n\n",
      ]);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        body: sseBody,
      });

      const provider = new OpenRouterProvider({ apiKey: "test-key" });
      const params: CreateMessageParams = {
        model: "anthropic/claude-sonnet-4-5-20250929",
        messages: [{ role: "user", content: "Search" }],
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
        id: "call_abc",
        name: "search_memory",
        input: { query: "test" },
      });
    });

    it("handles text followed by tool call", async () => {
      const sseBody = createSSEStream([
        sseEvent({
          choices: [{ delta: { content: "Searching..." }, finish_reason: null }],
        }),
        sseEvent({
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: "call_xyz",
                type: "function",
                function: { name: "get_historical_data", arguments: '{"symbol":"GOOG"}' },
              }],
            },
            finish_reason: null,
          }],
        }),
        sseEvent({
          choices: [{ delta: {}, finish_reason: "tool_calls" }],
          usage: { prompt_tokens: 30, completion_tokens: 10 },
        }),
        "data: [DONE]\n\n",
      ]);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        body: sseBody,
      });

      const provider = new OpenRouterProvider({ apiKey: "test-key" });
      const params: CreateMessageParams = {
        model: "anthropic/claude-sonnet-4-5-20250929",
        messages: [{ role: "user", content: "Check GOOG" }],
        maxTokens: 1024,
      };

      const events: StreamEvent[] = [];
      for await (const event of provider.createMessage(params)) {
        events.push(event);
      }

      expect(events[0]).toEqual({ type: "text_delta", text: "Searching..." });
      const toolEvent = events.find((e) => e.type === "tool_use");
      expect(toolEvent).toEqual({
        type: "tool_use",
        id: "call_xyz",
        name: "get_historical_data",
        input: { symbol: "GOOG" },
      });
    });
  });

  describe("structured JSON output", () => {
    it("passes response_format to API when responseFormat is json_object", async () => {
      const sseBody = createSSEStream([
        sseEvent({ choices: [{ delta: {}, finish_reason: "stop" }] }),
        "data: [DONE]\n\n",
      ]);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        body: sseBody,
      });

      const provider = new OpenRouterProvider({ apiKey: "test-key" });
      const params: CreateMessageParams = {
        model: "anthropic/claude-sonnet-4-5-20250929",
        messages: [{ role: "user", content: "Analyze" }],
        maxTokens: 1024,
        responseFormat: { type: "json_object" },
      };

      for await (const _event of provider.createMessage(params)) {
        // drain
      }

      const callArgs = mockFetch.mock.calls[0]!;
      const body = JSON.parse(callArgs[1].body as string);
      expect(body.response_format).toEqual({ type: "json_object" });
    });

    it("does not include response_format when responseFormat is not set", async () => {
      const sseBody = createSSEStream([
        sseEvent({ choices: [{ delta: {}, finish_reason: "stop" }] }),
        "data: [DONE]\n\n",
      ]);

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        body: sseBody,
      });

      const provider = new OpenRouterProvider({ apiKey: "test-key" });
      const params: CreateMessageParams = {
        model: "anthropic/claude-sonnet-4-5-20250929",
        messages: [{ role: "user", content: "Analyze" }],
        maxTokens: 1024,
      };

      for await (const _event of provider.createMessage(params)) {
        // drain
      }

      const callArgs = mockFetch.mock.calls[0]!;
      const body = JSON.parse(callArgs[1].body as string);
      expect(body.response_format).toBeUndefined();
    });
  });
});
