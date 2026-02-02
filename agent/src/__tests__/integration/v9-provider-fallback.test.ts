// agent/src/__tests__/integration/v9-provider-fallback.test.ts
import { describe, it, expect, vi } from "vitest";
import type { LLMProvider, StreamEvent } from "@finwatch/shared";
import { ProviderRegistry } from "../../providers/provider-registry.js";
import { withFallback } from "../../providers/fallback.js";

function workingProvider(id: string, response: string): LLMProvider {
  return {
    id,
    name: `Provider ${id}`,
    async *createMessage(): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", text: response };
      yield { type: "usage", input: 50, output: 25 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi
      .fn()
      .mockResolvedValue({
        providerId: id,
        status: "healthy",
        latencyMs: 10,
      }),
    listModels: vi.fn().mockReturnValue(["model-a"]),
  };
}

function failingProvider(id: string): LLMProvider {
  return {
    id,
    name: `Failing ${id}`,
    async *createMessage(): AsyncIterable<StreamEvent> {
      throw new Error(`Provider ${id} is offline`);
    },
    healthCheck: vi
      .fn()
      .mockResolvedValue({
        providerId: id,
        status: "offline",
        latencyMs: 0,
      }),
    listModels: vi.fn().mockReturnValue([]),
  };
}

describe("V9: Provider Fallback Integration", () => {
  it("falls back to secondary when primary fails", async () => {
    const registry = new ProviderRegistry();
    const primary = failingProvider("anthropic");
    const secondary = workingProvider(
      "openrouter",
      "Analysis from fallback provider.",
    );

    registry.register(primary);
    registry.register(secondary);

    const fallbackProvider = withFallback([primary, secondary]);

    let response = "";
    for await (const event of fallbackProvider.createMessage({
      model: "mock-model",
      messages: [{ role: "user", content: "Analyze this data" }],
      maxTokens: 1024,
    })) {
      if (event.type === "text_delta") response += event.text;
    }

    expect(response).toBe("Analysis from fallback provider.");
  });

  it("uses primary when it works", async () => {
    const primary = workingProvider("anthropic", "Primary response.");
    const secondary = workingProvider("openrouter", "Should not see this.");

    const fallbackProvider = withFallback([primary, secondary]);

    let response = "";
    for await (const event of fallbackProvider.createMessage({
      model: "mock-model",
      messages: [{ role: "user", content: "Analyze" }],
      maxTokens: 1024,
    })) {
      if (event.type === "text_delta") response += event.text;
    }

    expect(response).toBe("Primary response.");
  });

  it("fails when all providers are down", async () => {
    const fallbackProvider = withFallback([
      failingProvider("a"),
      failingProvider("b"),
      failingProvider("c"),
    ]);

    await expect(async () => {
      for await (const event of fallbackProvider.createMessage({
        model: "mock-model",
        messages: [{ role: "user", content: "Analyze" }],
        maxTokens: 1024,
      })) {
        // consume events
      }
    }).rejects.toThrow();
  });
});
