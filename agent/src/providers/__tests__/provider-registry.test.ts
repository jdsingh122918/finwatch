import { describe, it, expect, vi } from "vitest";
import type { LLMProvider, ProviderHealth, StreamEvent, CreateMessageParams } from "@finwatch/shared";
import { ProviderRegistry } from "../provider-registry.js";

function createMockProvider(overrides: Partial<LLMProvider> = {}): LLMProvider {
  return {
    id: "mock",
    name: "Mock Provider",
    async *createMessage(_params: CreateMessageParams): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", text: "hello" };
      yield { type: "usage", input: 10, output: 5 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi.fn<[], Promise<ProviderHealth>>().mockResolvedValue({
      providerId: "mock",
      status: "healthy",
      latencyMs: 50,
      lastSuccess: Date.now(),
    }),
    listModels: vi.fn<[], string[]>().mockReturnValue(["mock-model-1"]),
    ...overrides,
  };
}

describe("ProviderRegistry", () => {
  it("registers and retrieves a provider by id", () => {
    const registry = new ProviderRegistry();
    const provider = createMockProvider({ id: "test-provider" });
    registry.register(provider);
    expect(registry.get("test-provider")).toBe(provider);
  });

  it("returns undefined for unregistered provider", () => {
    const registry = new ProviderRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("lists all registered providers", () => {
    const registry = new ProviderRegistry();
    registry.register(createMockProvider({ id: "a", name: "A" }));
    registry.register(createMockProvider({ id: "b", name: "B" }));
    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("prevents duplicate provider registration", () => {
    const registry = new ProviderRegistry();
    registry.register(createMockProvider({ id: "dup" }));
    expect(() => registry.register(createMockProvider({ id: "dup" }))).toThrow(
      "Provider already registered: dup"
    );
  });

  it("returns health for all providers", async () => {
    const registry = new ProviderRegistry();
    registry.register(
      createMockProvider({
        id: "healthy-one",
        healthCheck: vi.fn<[], Promise<ProviderHealth>>().mockResolvedValue({
          providerId: "healthy-one",
          status: "healthy",
          latencyMs: 25,
        }),
      })
    );
    registry.register(
      createMockProvider({
        id: "degraded-one",
        healthCheck: vi.fn<[], Promise<ProviderHealth>>().mockResolvedValue({
          providerId: "degraded-one",
          status: "degraded",
          latencyMs: 500,
        }),
      })
    );

    const health = await registry.health();
    expect(health).toHaveLength(2);
    expect(health[0]!.providerId).toBe("healthy-one");
    expect(health[0]!.status).toBe("healthy");
    expect(health[1]!.providerId).toBe("degraded-one");
    expect(health[1]!.status).toBe("degraded");
  });

  it("handles health check failures gracefully", async () => {
    const registry = new ProviderRegistry();
    registry.register(
      createMockProvider({
        id: "broken",
        healthCheck: vi.fn<[], Promise<ProviderHealth>>().mockRejectedValue(new Error("connection refused")),
      })
    );

    const health = await registry.health();
    expect(health).toHaveLength(1);
    expect(health[0]!.providerId).toBe("broken");
    expect(health[0]!.status).toBe("offline");
    expect(health[0]!.lastError).toContain("connection refused");
  });

  it("unregisters a provider by id", () => {
    const registry = new ProviderRegistry();
    registry.register(createMockProvider({ id: "removable" }));
    expect(registry.get("removable")).toBeDefined();
    registry.unregister("removable");
    expect(registry.get("removable")).toBeUndefined();
  });
});
