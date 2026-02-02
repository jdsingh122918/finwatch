import { describe, it, expect, vi } from "vitest";
import type {
  LLMProvider,
  ProviderHealth,
  StreamEvent,
  CreateMessageParams,
} from "@finwatch/shared";
import { withFallback, AllProvidersFailedError } from "../fallback.js";

function createMockProvider(
  id: string,
  behavior: "success" | "fail",
): LLMProvider {
  return {
    id,
    name: `Provider ${id}`,
    async *createMessage(_params: CreateMessageParams): AsyncIterable<StreamEvent> {
      if (behavior === "fail") {
        throw new Error(`${id} failed`);
      }
      yield { type: "text_delta", text: `from-${id}` };
      yield { type: "usage", input: 10, output: 5 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi.fn<[], Promise<ProviderHealth>>().mockResolvedValue({
      providerId: id,
      status: "healthy",
      latencyMs: 50,
    }),
    listModels: vi.fn<[], string[]>().mockReturnValue(["model-1"]),
  };
}

function createFailAfterDeltaProvider(id: string): LLMProvider {
  return {
    id,
    name: `Provider ${id}`,
    async *createMessage(_params: CreateMessageParams): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", text: "partial-" };
      throw new Error(`${id} mid-stream failure`);
    },
    healthCheck: vi.fn<[], Promise<ProviderHealth>>().mockResolvedValue({
      providerId: id,
      status: "healthy",
      latencyMs: 50,
    }),
    listModels: vi.fn<[], string[]>().mockReturnValue(["model-1"]),
  };
}

const defaultParams: CreateMessageParams = {
  model: "test-model",
  messages: [{ role: "user", content: "hello" }],
  maxTokens: 1024,
};

describe("withFallback", () => {
  it("returns events from the first provider when it succeeds", async () => {
    const primary = createMockProvider("primary", "success");
    const fallbackProvider = withFallback([primary]);

    const events: StreamEvent[] = [];
    for await (const event of fallbackProvider.createMessage(defaultParams)) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "text_delta", text: "from-primary" },
      { type: "usage", input: 10, output: 5 },
      { type: "stop", reason: "end_turn" },
    ]);
  });

  it("falls back to second provider when first fails", async () => {
    const primary = createMockProvider("primary", "fail");
    const secondary = createMockProvider("secondary", "success");
    const fallbackProvider = withFallback([primary, secondary]);

    const events: StreamEvent[] = [];
    for await (const event of fallbackProvider.createMessage(defaultParams)) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: "text_delta", text: "from-secondary" });
  });

  it("falls back through multiple failures to find a working provider", async () => {
    const a = createMockProvider("a", "fail");
    const b = createMockProvider("b", "fail");
    const c = createMockProvider("c", "success");
    const fallbackProvider = withFallback([a, b, c]);

    const events: StreamEvent[] = [];
    for await (const event of fallbackProvider.createMessage(defaultParams)) {
      events.push(event);
    }

    expect(events[0]).toEqual({ type: "text_delta", text: "from-c" });
  });

  it("throws AllProvidersFailedError when all providers fail", async () => {
    const a = createMockProvider("a", "fail");
    const b = createMockProvider("b", "fail");
    const fallbackProvider = withFallback([a, b]);

    await expect(async () => {
      for await (const _event of fallbackProvider.createMessage(defaultParams)) {
        // drain
      }
    }).rejects.toThrow(AllProvidersFailedError);
  });

  it("AllProvidersFailedError contains all individual errors", async () => {
    const a = createMockProvider("a", "fail");
    const b = createMockProvider("b", "fail");
    const fallbackProvider = withFallback([a, b]);

    try {
      for await (const _event of fallbackProvider.createMessage(defaultParams)) {
        // drain
      }
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AllProvidersFailedError);
      const allErr = err as AllProvidersFailedError;
      expect(allErr.errors).toHaveLength(2);
      expect(allErr.errors[0]!.providerId).toBe("a");
      expect(allErr.errors[1]!.providerId).toBe("b");
    }
  });

  it("falls back when provider fails mid-stream", async () => {
    const failing = createFailAfterDeltaProvider("failing");
    const backup = createMockProvider("backup", "success");
    const fallbackProvider = withFallback([failing, backup]);

    const events: StreamEvent[] = [];
    for await (const event of fallbackProvider.createMessage(defaultParams)) {
      events.push(event);
    }

    // Should get events from backup, not partial events from failing
    expect(events[0]).toEqual({ type: "text_delta", text: "from-backup" });
  });

  it("has id 'fallback' and combined name", () => {
    const a = createMockProvider("a", "success");
    const b = createMockProvider("b", "success");
    const fallbackProvider = withFallback([a, b]);
    expect(fallbackProvider.id).toBe("fallback");
    expect(fallbackProvider.name).toContain("a");
    expect(fallbackProvider.name).toContain("b");
  });

  it("healthCheck returns health from the first healthy provider", async () => {
    const a = createMockProvider("a", "success");
    const b = createMockProvider("b", "success");
    const fallbackProvider = withFallback([a, b]);

    const health = await fallbackProvider.healthCheck();
    expect(health.status).toBe("healthy");
  });

  it("listModels returns merged unique models from all providers", () => {
    const a: LLMProvider = {
      ...createMockProvider("a", "success"),
      listModels: () => ["model-1", "model-2"],
    };
    const b: LLMProvider = {
      ...createMockProvider("b", "success"),
      listModels: () => ["model-2", "model-3"],
    };
    const fallbackProvider = withFallback([a, b]);

    const models = fallbackProvider.listModels();
    expect(models).toEqual(["model-1", "model-2", "model-3"]);
  });

  it("throws if called with empty providers array", () => {
    expect(() => withFallback([])).toThrow("At least one provider is required");
  });
});
