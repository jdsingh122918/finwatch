# Phase 1B: Node.js Agent Core — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the core Node.js agent infrastructure: enhanced JSON-RPC server, multi-provider LLM interface with fallback, JSONL session management with compaction, and a typed tool executor framework.

**Architecture:** Node.js agent sidecar with pluggable LLM provider registry (Anthropic + OpenRouter), JSONL-based session transcripts with automatic compaction, and a Zod-validated tool execution framework.

**Tech Stack:** TypeScript, Node.js, Zod, @anthropic-ai/sdk (for Anthropic API), node-fetch or built-in fetch (for OpenRouter)

**Worktree:** `/Users/jdsingh/Projects/AI/finwatch-node-agent`
**Branch:** `feat/node-agent`
**Owns:** `agent/` — EXCLUSIVE

---

## Task 1B.1: JSON-RPC Server Improvements

**Goal:** Refactor the JSON-RPC server with a proper method registry, typed async handlers, and improved error handling. The current `index.ts` has a hardcoded `methods` object; we replace it with a `JsonRpcServer` class that supports `register()`, async handlers, and proper JSON-RPC error codes.

**Files:**
- Create: `agent/src/ipc/__tests__/json-rpc-server.test.ts`
- Create: `agent/src/ipc/json-rpc-server.ts`
- Modify: `agent/src/index.ts` (use new server class)

### Step 1: Write failing tests

Create `agent/src/ipc/__tests__/json-rpc-server.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { JsonRpcServer } from "../json-rpc-server.js";

describe("JsonRpcServer", () => {
  it("can register and call a method", async () => {
    const server = new JsonRpcServer();
    server.register("ping", async () => ({ status: "ok" }));

    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: {} })
    );
    const parsed = JSON.parse(response);
    expect(parsed.jsonrpc).toBe("2.0");
    expect(parsed.id).toBe(1);
    expect(parsed.result).toEqual({ status: "ok" });
    expect(parsed.error).toBeUndefined();
  });

  it("passes params to handler", async () => {
    const server = new JsonRpcServer();
    server.register("echo", async (params) => ({ echo: params.message }));

    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "echo", params: { message: "hello" } })
    );
    const parsed = JSON.parse(response);
    expect(parsed.result).toEqual({ echo: "hello" });
  });

  it("returns method-not-found error for unregistered method", async () => {
    const server = new JsonRpcServer();

    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "nonexistent", params: {} })
    );
    const parsed = JSON.parse(response);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBe(-32601);
    expect(parsed.error.message).toContain("Method not found");
  });

  it("returns parse error for invalid JSON", async () => {
    const server = new JsonRpcServer();

    const response = await server.handleRequest("not valid json{{{");
    const parsed = JSON.parse(response);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBe(-32700);
  });

  it("returns internal error when handler throws", async () => {
    const server = new JsonRpcServer();
    server.register("fail", async () => {
      throw new Error("something broke");
    });

    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0", id: 4, method: "fail", params: {} })
    );
    const parsed = JSON.parse(response);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBe(-32603);
    expect(parsed.error.message).toContain("something broke");
  });

  it("returns invalid-request error for missing required fields", async () => {
    const server = new JsonRpcServer();

    const response = await server.handleRequest(
      JSON.stringify({ jsonrpc: "2.0" })
    );
    const parsed = JSON.parse(response);
    expect(parsed.error).toBeDefined();
    expect(parsed.error.code).toBe(-32600);
  });

  it("lists registered methods", () => {
    const server = new JsonRpcServer();
    server.register("a", async () => ({}));
    server.register("b", async () => ({}));
    expect(server.listMethods()).toEqual(["a", "b"]);
  });

  it("prevents duplicate method registration", () => {
    const server = new JsonRpcServer();
    server.register("dup", async () => ({}));
    expect(() => server.register("dup", async () => ({}))).toThrow(
      "Method already registered: dup"
    );
  });
});
```

### Step 2: Run tests, verify FAIL

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && npx vitest run agent/src/ipc/__tests__/json-rpc-server.test.ts
```

Expected: All 8 tests fail because `json-rpc-server.ts` does not exist.

### Step 3: Write implementation

Create `agent/src/ipc/json-rpc-server.ts`:

```typescript
import {
  parseJsonRpcRequest,
  createJsonRpcResponse,
  createJsonRpcError,
} from "./json-rpc.js";

export type JsonRpcHandler = (
  params: Record<string, unknown>
) => Promise<unknown>;

export class JsonRpcServer {
  private handlers = new Map<string, JsonRpcHandler>();

  register(method: string, handler: JsonRpcHandler): void {
    if (this.handlers.has(method)) {
      throw new Error(`Method already registered: ${method}`);
    }
    this.handlers.set(method, handler);
  }

  listMethods(): string[] {
    return [...this.handlers.keys()];
  }

  async handleRequest(raw: string): Promise<string> {
    let id: number | string = 0;

    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return JSON.stringify(createJsonRpcError(0, -32700, "Parse error"));
      }

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("method" in parsed) ||
        !("id" in parsed)
      ) {
        return JSON.stringify(
          createJsonRpcError(0, -32600, "Invalid Request: missing required fields")
        );
      }

      const req = parseJsonRpcRequest(raw);
      id = req.id;

      const handler = this.handlers.get(req.method);
      if (!handler) {
        return JSON.stringify(
          createJsonRpcError(id, -32601, `Method not found: ${req.method}`)
        );
      }

      const result = await handler(req.params ?? {});
      return JSON.stringify(createJsonRpcResponse(id, result));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      return JSON.stringify(createJsonRpcError(id, -32603, message));
    }
  }
}
```

Modify `agent/src/index.ts` to use the new server class:

```typescript
import { JsonRpcServer } from "./ipc/json-rpc-server.js";

export { JsonRpcServer } from "./ipc/json-rpc-server.js";

const server = new JsonRpcServer();

server.register("ping", async () => ({
  status: "ok",
  timestamp: Date.now(),
}));

export function start(): void {
  process.stdin.setEncoding("utf-8");
  let buffer = "";

  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim()) {
        server.handleRequest(line.trim()).then((response) => {
          process.stdout.write(response + "\n");
        });
      }
    }
  });
}

// Start when run directly
const isMain =
  process.argv[1]?.endsWith("index.ts") ||
  process.argv[1]?.endsWith("index.js");
if (isMain) {
  start();
}
```

### Step 4: Run tests, verify PASS

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && npx vitest run agent/src/ipc/__tests__/json-rpc-server.test.ts
```

Expected: All 8 tests pass.

Also verify the existing tests still pass:

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && npx vitest run --project agent
```

Expected: All previous tests (index.test.ts, json-rpc.test.ts) plus new tests pass (14 total).

### Step 5: Commit

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && git add agent/src/ipc/json-rpc-server.ts agent/src/ipc/__tests__/json-rpc-server.test.ts agent/src/index.ts && git commit -m "feat(agent): add JsonRpcServer class with method registry and async handlers

Replace hardcoded methods object with JsonRpcServer supporting register(),
async handlers, typed error codes, and method listing.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 1B.2: LLM Provider Interface + Registry

**Goal:** Create a `ProviderRegistry` class that manages multiple `LLMProvider` instances. It supports `register()`, `get()`, `list()`, and `health()` methods. The registry uses the shared `LLMProvider`, `ProviderHealth`, and `ModelSlot` types from `@finwatch/shared`.

**Files:**
- Create: `agent/src/providers/__tests__/provider-registry.test.ts`
- Create: `agent/src/providers/provider-registry.ts`

### Step 1: Write failing tests

Create `agent/src/providers/__tests__/provider-registry.test.ts`:

```typescript
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
```

### Step 2: Run tests, verify FAIL

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && npx vitest run agent/src/providers/__tests__/provider-registry.test.ts
```

Expected: All 7 tests fail because `provider-registry.ts` does not exist.

### Step 3: Write implementation

Create `agent/src/providers/provider-registry.ts`:

```typescript
import type { LLMProvider, ProviderHealth } from "@finwatch/shared";

export class ProviderRegistry {
  private providers = new Map<string, LLMProvider>();

  register(provider: LLMProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
  }

  unregister(id: string): void {
    this.providers.delete(id);
  }

  get(id: string): LLMProvider | undefined {
    return this.providers.get(id);
  }

  list(): LLMProvider[] {
    return [...this.providers.values()];
  }

  async health(): Promise<ProviderHealth[]> {
    const results: ProviderHealth[] = [];

    for (const provider of this.providers.values()) {
      try {
        const h = await provider.healthCheck();
        results.push(h);
      } catch (err) {
        results.push({
          providerId: provider.id,
          status: "offline",
          latencyMs: -1,
          lastError: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return results;
  }
}
```

### Step 4: Run tests, verify PASS

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && npx vitest run agent/src/providers/__tests__/provider-registry.test.ts
```

Expected: All 7 tests pass.

### Step 5: Commit

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && git add agent/src/providers/provider-registry.ts agent/src/providers/__tests__/provider-registry.test.ts && git commit -m "feat(agent): add ProviderRegistry with register, get, list, health

Manages LLMProvider instances with health-check aggregation that
gracefully handles individual provider failures.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 1B.3: Anthropic Provider Adapter

**Goal:** Implement `AnthropicProvider` that wraps `@anthropic-ai/sdk` to implement the shared `LLMProvider` interface. It streams responses and yields `StreamEvent` objects. All tests use mocks -- no real API calls.

**Files:**
- Modify: `agent/package.json` (add `@anthropic-ai/sdk` dependency)
- Create: `agent/src/providers/__tests__/anthropic-provider.test.ts`
- Create: `agent/src/providers/anthropic-provider.ts`

### Step 1: Install dependency and write failing tests

First, add the dependency:

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && cd agent && pnpm add @anthropic-ai/sdk
```

Create `agent/src/providers/__tests__/anthropic-provider.test.ts`:

```typescript
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
```

### Step 2: Run tests, verify FAIL

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && npx vitest run agent/src/providers/__tests__/anthropic-provider.test.ts
```

Expected: All 8 tests fail because `anthropic-provider.ts` does not exist.

### Step 3: Write implementation

Create `agent/src/providers/anthropic-provider.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type {
  LLMProvider,
  ProviderHealth,
  CreateMessageParams,
  StreamEvent,
} from "@finwatch/shared";

export type AnthropicProviderOptions = {
  apiKey: string;
  id?: string;
  name?: string;
};

const SUPPORTED_MODELS = [
  "claude-opus-4-5-20251101",
  "claude-sonnet-4-5-20241022",
  "claude-haiku-35-20241022",
];

export class AnthropicProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  private client: Anthropic;

  constructor(options: AnthropicProviderOptions) {
    this.id = options.id ?? "anthropic";
    this.name = options.name ?? "Anthropic";
    this.client = new Anthropic({ apiKey: options.apiKey });
  }

  async *createMessage(params: CreateMessageParams): AsyncIterable<StreamEvent> {
    const requestBody: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.maxTokens,
      stream: true,
      messages: params.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    };

    if (params.system) {
      requestBody.system = params.system;
    }

    if (params.temperature !== undefined) {
      requestBody.temperature = params.temperature;
    }

    if (params.tools && params.tools.length > 0) {
      requestBody.tools = params.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }

    const stream = await this.client.messages.create(
      requestBody as Parameters<typeof this.client.messages.create>[0]
    );

    let inputTokens = 0;
    let outputTokens = 0;

    for await (const event of stream as AsyncIterable<Record<string, unknown>>) {
      const eventType = event.type as string;

      if (eventType === "message_start") {
        const message = event.message as Record<string, unknown> | undefined;
        const usage = message?.usage as Record<string, number> | undefined;
        if (usage?.input_tokens) {
          inputTokens = usage.input_tokens;
        }
      } else if (eventType === "content_block_delta") {
        const delta = event.delta as Record<string, unknown> | undefined;
        if (delta?.type === "text_delta" && typeof delta.text === "string") {
          yield { type: "text_delta", text: delta.text };
        }
      } else if (eventType === "message_delta") {
        const usage = event.usage as Record<string, number> | undefined;
        if (usage?.output_tokens) {
          outputTokens = usage.output_tokens;
        }
      } else if (eventType === "message_stop") {
        if (inputTokens > 0 || outputTokens > 0) {
          yield { type: "usage", input: inputTokens, output: outputTokens };
        }
        yield { type: "stop", reason: "end_turn" };
      }
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      // Simple health check: create a minimal message
      const stream = await this.client.messages.create({
        model: "claude-haiku-35-20241022",
        max_tokens: 1,
        stream: true,
        messages: [{ role: "user", content: "." }],
      });
      // Consume the stream to completion
      for await (const _event of stream as AsyncIterable<unknown>) {
        // drain
      }
      return {
        providerId: this.id,
        status: "healthy",
        latencyMs: Date.now() - start,
        lastSuccess: Date.now(),
      };
    } catch (err) {
      return {
        providerId: this.id,
        status: "offline",
        latencyMs: Date.now() - start,
        lastError: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  listModels(): string[] {
    return [...SUPPORTED_MODELS];
  }
}
```

### Step 4: Run tests, verify PASS

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && npx vitest run agent/src/providers/__tests__/anthropic-provider.test.ts
```

Expected: All 8 tests pass.

### Step 5: Commit

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && git add agent/package.json agent/src/providers/anthropic-provider.ts agent/src/providers/__tests__/anthropic-provider.test.ts && git commit -m "feat(agent): add AnthropicProvider implementing LLMProvider with streaming

Wraps @anthropic-ai/sdk to stream responses as StreamEvent objects.
Supports system prompts, temperature, tools, and health checks.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 1B.4: OpenRouter Provider Adapter

**Goal:** Implement `OpenRouterProvider` that uses the standard `fetch` API to call the OpenRouter chat completions endpoint. It implements the same `LLMProvider` interface and yields `StreamEvent` objects from SSE streams. Uses OpenRouter-specific headers (`HTTP-Referer`, `X-Title`).

**Files:**
- Create: `agent/src/providers/__tests__/openrouter-provider.test.ts`
- Create: `agent/src/providers/openrouter-provider.ts`

### Step 1: Write failing tests

Create `agent/src/providers/__tests__/openrouter-provider.test.ts`:

```typescript
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
      model: "anthropic/claude-sonnet-4-5-20241022",
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
      model: "anthropic/claude-sonnet-4-5-20241022",
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
      model: "anthropic/claude-opus-4-5-20251101",
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

    expect(body.model).toBe("anthropic/claude-opus-4-5-20251101");
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
      model: "anthropic/claude-sonnet-4-5-20241022",
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
    expect(models).toContain("anthropic/claude-opus-4-5-20251101");
  });
});
```

### Step 2: Run tests, verify FAIL

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && npx vitest run agent/src/providers/__tests__/openrouter-provider.test.ts
```

Expected: All 9 tests fail because `openrouter-provider.ts` does not exist.

### Step 3: Write implementation

Create `agent/src/providers/openrouter-provider.ts`:

```typescript
import type {
  LLMProvider,
  ProviderHealth,
  CreateMessageParams,
  StreamEvent,
} from "@finwatch/shared";

export type OpenRouterProviderOptions = {
  apiKey: string;
  id?: string;
  name?: string;
  referer?: string;
  title?: string;
  baseUrl?: string;
};

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

const SUPPORTED_MODELS = [
  "anthropic/claude-opus-4-5-20251101",
  "anthropic/claude-sonnet-4-5-20241022",
  "anthropic/claude-haiku-35-20241022",
  "google/gemini-2.5-pro",
  "openai/gpt-4o",
];

export class OpenRouterProvider implements LLMProvider {
  readonly id: string;
  readonly name: string;
  private apiKey: string;
  private referer: string;
  private title: string;
  private baseUrl: string;

  constructor(options: OpenRouterProviderOptions) {
    this.id = options.id ?? "openrouter";
    this.name = options.name ?? "OpenRouter";
    this.apiKey = options.apiKey;
    this.referer = options.referer ?? "https://finwatch.app";
    this.title = options.title ?? "FinWatch Agent";
    this.baseUrl = options.baseUrl ?? OPENROUTER_BASE_URL;
  }

  async *createMessage(params: CreateMessageParams): AsyncIterable<StreamEvent> {
    const messages: Array<{ role: string; content: string }> = [];

    if (params.system) {
      messages.push({ role: "system", content: params.system });
    }

    for (const m of params.messages) {
      messages.push({ role: m.role, content: m.content });
    }

    const body: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.maxTokens,
      stream: true,
      messages,
    };

    if (params.temperature !== undefined) {
      body.temperature = params.temperature;
    }

    if (params.tools && params.tools.length > 0) {
      body.tools = params.tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
    }

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": this.referer,
        "X-Title": this.title,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenRouter API error ${response.status}: ${errorText}`
      );
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{
              delta?: { content?: string };
              finish_reason?: string | null;
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };

          const choice = parsed.choices?.[0];
          if (!choice) continue;

          if (choice.delta?.content) {
            yield { type: "text_delta", text: choice.delta.content };
          }

          if (choice.finish_reason) {
            if (parsed.usage) {
              yield {
                type: "usage",
                input: parsed.usage.prompt_tokens ?? 0,
                output: parsed.usage.completion_tokens ?? 0,
              };
            }
            yield { type: "stop", reason: choice.finish_reason };
          }
        } catch {
          // Skip malformed SSE data lines
        }
      }
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "HTTP-Referer": this.referer,
          "X-Title": this.title,
        },
        body: JSON.stringify({
          model: "anthropic/claude-haiku-35-20241022",
          max_tokens: 1,
          stream: true,
          messages: [{ role: "user", content: "." }],
        }),
      });

      if (!response.ok) {
        return {
          providerId: this.id,
          status: "degraded",
          latencyMs: Date.now() - start,
          lastError: `HTTP ${response.status}`,
        };
      }

      // Consume body to complete the request
      const reader = response.body?.getReader();
      if (reader) {
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      }

      return {
        providerId: this.id,
        status: "healthy",
        latencyMs: Date.now() - start,
        lastSuccess: Date.now(),
      };
    } catch (err) {
      return {
        providerId: this.id,
        status: "offline",
        latencyMs: Date.now() - start,
        lastError: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  listModels(): string[] {
    return [...SUPPORTED_MODELS];
  }
}
```

### Step 4: Run tests, verify PASS

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && npx vitest run agent/src/providers/__tests__/openrouter-provider.test.ts
```

Expected: All 9 tests pass.

### Step 5: Commit

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && git add agent/src/providers/openrouter-provider.ts agent/src/providers/__tests__/openrouter-provider.test.ts && git commit -m "feat(agent): add OpenRouterProvider with SSE streaming and custom headers

Uses fetch to stream from OpenRouter chat completions endpoint.
Sends HTTP-Referer and X-Title headers per OpenRouter spec.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 1B.5: Provider Fallback Chain

**Goal:** Implement a `withFallback()` wrapper that takes an ordered list of providers and tries each one in sequence when the current provider fails. Returns the first successful stream. If all fail, throws an `AllProvidersFailedError` with details.

**Files:**
- Create: `agent/src/providers/__tests__/fallback.test.ts`
- Create: `agent/src/providers/fallback.ts`

### Step 1: Write failing tests

Create `agent/src/providers/__tests__/fallback.test.ts`:

```typescript
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
```

### Step 2: Run tests, verify FAIL

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && npx vitest run agent/src/providers/__tests__/fallback.test.ts
```

Expected: All 10 tests fail because `fallback.ts` does not exist.

### Step 3: Write implementation

Create `agent/src/providers/fallback.ts`:

```typescript
import type {
  LLMProvider,
  ProviderHealth,
  CreateMessageParams,
  StreamEvent,
} from "@finwatch/shared";

export type ProviderError = {
  providerId: string;
  error: Error;
};

export class AllProvidersFailedError extends Error {
  readonly errors: ProviderError[];

  constructor(errors: ProviderError[]) {
    const summary = errors.map((e) => `${e.providerId}: ${e.error.message}`).join("; ");
    super(`All providers failed: ${summary}`);
    this.name = "AllProvidersFailedError";
    this.errors = errors;
  }
}

export function withFallback(providers: LLMProvider[]): LLMProvider {
  if (providers.length === 0) {
    throw new Error("At least one provider is required");
  }

  return {
    id: "fallback",
    name: `Fallback(${providers.map((p) => p.id).join(", ")})`,

    async *createMessage(params: CreateMessageParams): AsyncIterable<StreamEvent> {
      const errors: ProviderError[] = [];

      for (const provider of providers) {
        try {
          const events: StreamEvent[] = [];
          for await (const event of provider.createMessage(params)) {
            events.push(event);
          }
          // Only yield if we successfully consumed the entire stream
          for (const event of events) {
            yield event;
          }
          return;
        } catch (err) {
          errors.push({
            providerId: provider.id,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      }

      throw new AllProvidersFailedError(errors);
    },

    async healthCheck(): Promise<ProviderHealth> {
      for (const provider of providers) {
        try {
          const health = await provider.healthCheck();
          if (health.status === "healthy" || health.status === "degraded") {
            return health;
          }
        } catch {
          // try next
        }
      }

      return {
        providerId: "fallback",
        status: "offline",
        latencyMs: -1,
        lastError: "All providers unhealthy",
      };
    },

    listModels(): string[] {
      const seen = new Set<string>();
      const models: string[] = [];
      for (const provider of providers) {
        for (const model of provider.listModels()) {
          if (!seen.has(model)) {
            seen.add(model);
            models.push(model);
          }
        }
      }
      return models;
    },
  };
}
```

### Step 4: Run tests, verify PASS

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && npx vitest run agent/src/providers/__tests__/fallback.test.ts
```

Expected: All 10 tests pass.

### Step 5: Commit

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && git add agent/src/providers/fallback.ts agent/src/providers/__tests__/fallback.test.ts && git commit -m "feat(agent): add withFallback() provider chain with mid-stream recovery

Tries providers in order; buffers stream events before yielding so
mid-stream failures fall through cleanly. AllProvidersFailedError
collects all individual errors.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 1B.6: Session Manager (JSONL Read/Write)

**Goal:** Implement `SessionManager` that manages session transcript files in JSONL format. Each session is a `.jsonl` file. The manager supports `create()`, `append()`, `read()`, `list()`, and `rotate()` operations using the `SessionTranscriptEntry` type from `@finwatch/shared`.

**Files:**
- Create: `agent/src/session/__tests__/session-manager.test.ts`
- Create: `agent/src/session/session-manager.ts`

### Step 1: Write failing tests

Create `agent/src/session/__tests__/session-manager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { SessionTranscriptEntry, AgentMessage } from "@finwatch/shared";
import { SessionManager } from "../session-manager.js";

// Use a temporary directory for tests
const TEST_DIR = path.join(import.meta.dirname ?? ".", ".test-sessions");

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    manager = new SessionManager(TEST_DIR);
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("creates a new session file with header entry", async () => {
    const sessionId = await manager.create("monitor");

    expect(typeof sessionId).toBe("string");
    expect(sessionId.length).toBeGreaterThan(0);

    const entries = await manager.read(sessionId);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe("session");
    if (entries[0]!.type === "session") {
      expect(entries[0]!.id).toBe(sessionId);
      expect(entries[0]!.kind).toBe("monitor");
      expect(entries[0]!.version).toBe(1);
    }
  });

  it("creates sessions with unique ids", async () => {
    const id1 = await manager.create("monitor");
    const id2 = await manager.create("subagent");
    expect(id1).not.toBe(id2);
  });

  it("appends entries to an existing session", async () => {
    const sessionId = await manager.create("monitor");

    const message: AgentMessage = {
      role: "user",
      content: "Analyze AAPL",
      timestamp: Date.now(),
    };

    const entry: SessionTranscriptEntry = {
      type: "message",
      message,
    };

    await manager.append(sessionId, entry);

    const entries = await manager.read(sessionId);
    expect(entries).toHaveLength(2);
    expect(entries[1]!.type).toBe("message");
    if (entries[1]!.type === "message") {
      expect(entries[1]!.message.content).toBe("Analyze AAPL");
    }
  });

  it("appends multiple entries in sequence", async () => {
    const sessionId = await manager.create("monitor");

    await manager.append(sessionId, {
      type: "message",
      message: { role: "user", content: "First", timestamp: 1 },
    });
    await manager.append(sessionId, {
      type: "message",
      message: { role: "assistant", content: "Second", timestamp: 2 },
    });

    const entries = await manager.read(sessionId);
    expect(entries).toHaveLength(3); // header + 2 messages
  });

  it("throws when appending to nonexistent session", async () => {
    await expect(
      manager.append("nonexistent", {
        type: "message",
        message: { role: "user", content: "test", timestamp: 1 },
      })
    ).rejects.toThrow("Session not found: nonexistent");
  });

  it("throws when reading nonexistent session", async () => {
    await expect(manager.read("nonexistent")).rejects.toThrow(
      "Session not found: nonexistent"
    );
  });

  it("reads entries as correct types", async () => {
    const sessionId = await manager.create("monitor");

    await manager.append(sessionId, {
      type: "data_tick",
      source: "yahoo",
      payload: {
        sourceId: "yahoo",
        timestamp: Date.now(),
        metrics: { price: 150.25 },
        metadata: {},
      },
    });

    await manager.append(sessionId, {
      type: "anomaly",
      anomaly: {
        id: "anom-1",
        severity: "high",
        source: "yahoo",
        timestamp: Date.now(),
        description: "Price spike",
        metrics: { price: 200 },
        preScreenScore: 0.9,
        sessionId,
      },
    });

    const entries = await manager.read(sessionId);
    expect(entries).toHaveLength(3);
    expect(entries[1]!.type).toBe("data_tick");
    expect(entries[2]!.type).toBe("anomaly");
  });

  it("lists all sessions sorted by creation time (newest first)", async () => {
    const id1 = await manager.create("monitor");
    const id2 = await manager.create("subagent");
    const id3 = await manager.create("improvement");

    const sessions = await manager.list();
    expect(sessions).toHaveLength(3);
    // Newest first
    expect(sessions[0]!.id).toBe(id3);
    expect(sessions[1]!.id).toBe(id2);
    expect(sessions[2]!.id).toBe(id1);
  });

  it("list returns session metadata (id, kind, timestamp)", async () => {
    const id = await manager.create("subagent");
    const sessions = await manager.list();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.id).toBe(id);
    expect(sessions[0]!.kind).toBe("subagent");
    expect(typeof sessions[0]!.timestamp).toBe("string");
  });

  it("rotates (archives) old sessions beyond max count", async () => {
    // Create 5 sessions
    for (let i = 0; i < 5; i++) {
      await manager.create("monitor");
    }

    // Rotate, keeping only 3
    const archived = await manager.rotate(3);

    expect(archived).toHaveLength(2);
    const remaining = await manager.list();
    expect(remaining).toHaveLength(3);
  });

  it("rotate does nothing when count is below max", async () => {
    await manager.create("monitor");
    await manager.create("monitor");

    const archived = await manager.rotate(5);
    expect(archived).toHaveLength(0);

    const remaining = await manager.list();
    expect(remaining).toHaveLength(2);
  });

  it("getPath returns the file path for a session", async () => {
    const id = await manager.create("monitor");
    const filePath = manager.getPath(id);
    expect(filePath).toBe(path.join(TEST_DIR, `${id}.jsonl`));
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it("handles entries with special characters in content", async () => {
    const sessionId = await manager.create("monitor");

    await manager.append(sessionId, {
      type: "message",
      message: {
        role: "user",
        content: 'Line1\nLine2\t"quoted"\nLine3',
        timestamp: 1,
      },
    });

    const entries = await manager.read(sessionId);
    expect(entries).toHaveLength(2);
    if (entries[1]!.type === "message") {
      expect(entries[1]!.message.content).toBe('Line1\nLine2\t"quoted"\nLine3');
    }
  });
});
```

### Step 2: Run tests, verify FAIL

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && npx vitest run agent/src/session/__tests__/session-manager.test.ts
```

Expected: All 13 tests fail because `session-manager.ts` does not exist.

### Step 3: Write implementation

Create `agent/src/session/session-manager.ts`:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import type { SessionTranscriptEntry, SessionKind } from "@finwatch/shared";

export type SessionListEntry = {
  id: string;
  kind: SessionKind;
  timestamp: string;
};

export class SessionManager {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    fs.mkdirSync(this.baseDir, { recursive: true });
  }

  async create(kind: SessionKind): Promise<string> {
    const id = `session-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    const filePath = this.getPath(id);
    const timestamp = new Date().toISOString();

    const header: SessionTranscriptEntry = {
      type: "session",
      version: 1,
      id,
      timestamp,
      kind,
    };

    await fs.promises.writeFile(filePath, JSON.stringify(header) + "\n", "utf-8");
    return id;
  }

  async append(sessionId: string, entry: SessionTranscriptEntry): Promise<void> {
    const filePath = this.getPath(sessionId);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    await fs.promises.appendFile(filePath, JSON.stringify(entry) + "\n", "utf-8");
  }

  async read(sessionId: string): Promise<SessionTranscriptEntry[]> {
    const filePath = this.getPath(sessionId);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const content = await fs.promises.readFile(filePath, "utf-8");
    const lines = content.trim().split("\n");
    const entries: SessionTranscriptEntry[] = [];

    for (const line of lines) {
      if (line.trim()) {
        entries.push(JSON.parse(line) as SessionTranscriptEntry);
      }
    }

    return entries;
  }

  async list(): Promise<SessionListEntry[]> {
    const files = await fs.promises.readdir(this.baseDir);
    const sessions: SessionListEntry[] = [];

    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;

      const filePath = path.join(this.baseDir, file);
      const content = await fs.promises.readFile(filePath, "utf-8");
      const firstLine = content.split("\n")[0];
      if (!firstLine) continue;

      try {
        const header = JSON.parse(firstLine) as SessionTranscriptEntry;
        if (header.type === "session") {
          sessions.push({
            id: header.id,
            kind: header.kind,
            timestamp: header.timestamp,
          });
        }
      } catch {
        // Skip malformed files
      }
    }

    // Sort newest first
    sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return sessions;
  }

  async rotate(maxSessions: number): Promise<string[]> {
    const sessions = await this.list();

    if (sessions.length <= maxSessions) {
      return [];
    }

    // Sessions are already sorted newest-first, so archive the tail
    const toArchive = sessions.slice(maxSessions);
    const archivedIds: string[] = [];

    for (const session of toArchive) {
      const filePath = this.getPath(session.id);
      await fs.promises.unlink(filePath);
      archivedIds.push(session.id);
    }

    return archivedIds;
  }

  getPath(sessionId: string): string {
    return path.join(this.baseDir, `${sessionId}.jsonl`);
  }
}
```

### Step 4: Run tests, verify PASS

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && npx vitest run agent/src/session/__tests__/session-manager.test.ts
```

Expected: All 13 tests pass.

### Step 5: Commit

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && git add agent/src/session/session-manager.ts agent/src/session/__tests__/session-manager.test.ts && git commit -m "feat(agent): add SessionManager for JSONL transcript read/write/rotate

Manages session transcripts as JSONL files with create, append, read,
list (newest-first), and rotate (archive oldest beyond max count).

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 1B.7: Session Compaction

**Goal:** Add a `compact()` method that estimates token counts per message entry, and when the session exceeds `maxCycleTokenRatio * contextWindow`, summarizes the oldest 40% of messages into a single system message via an LLM call, keeping the newest 60% intact. Requires `gpt-tokenizer` for token counting.

**Files:**
- Modify: `agent/package.json` (add `gpt-tokenizer` dependency)
- Create: `agent/src/session/__tests__/session-compaction.test.ts`
- Create: `agent/src/session/session-compaction.ts`

### Step 1: Install dependency and write failing tests

First, add the dependency:

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && cd agent && pnpm add gpt-tokenizer
```

Create `agent/src/session/__tests__/session-compaction.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  LLMProvider,
  ProviderHealth,
  CreateMessageParams,
  StreamEvent,
  SessionTranscriptEntry,
  AgentMessage,
} from "@finwatch/shared";
import {
  estimateTokens,
  shouldCompact,
  compactSession,
  type CompactionOptions,
} from "../session-compaction.js";

function makeMessageEntry(
  role: "user" | "assistant" | "system",
  content: string,
): SessionTranscriptEntry {
  return {
    type: "message",
    message: {
      role,
      content,
      timestamp: Date.now(),
    },
  };
}

function makeSessionHeader(): SessionTranscriptEntry {
  return {
    type: "session",
    version: 1,
    id: "test-session",
    timestamp: new Date().toISOString(),
    kind: "monitor",
  };
}

function createSummaryProvider(summaryText: string): LLMProvider {
  return {
    id: "mock-summary",
    name: "Mock Summary",
    async *createMessage(_params: CreateMessageParams): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", text: summaryText };
      yield { type: "usage", input: 50, output: 20 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi.fn<[], Promise<ProviderHealth>>().mockResolvedValue({
      providerId: "mock-summary",
      status: "healthy",
      latencyMs: 10,
    }),
    listModels: vi.fn<[], string[]>().mockReturnValue(["mock-model"]),
  };
}

describe("estimateTokens", () => {
  it("returns a positive number for non-empty text", () => {
    const count = estimateTokens("Hello, how are you?");
    expect(count).toBeGreaterThan(0);
  });

  it("returns 0 for empty text", () => {
    const count = estimateTokens("");
    expect(count).toBe(0);
  });

  it("longer text has more tokens", () => {
    const shortCount = estimateTokens("Hi");
    const longCount = estimateTokens(
      "This is a much longer piece of text that contains many more words and should result in a significantly higher token count."
    );
    expect(longCount).toBeGreaterThan(shortCount);
  });
});

describe("shouldCompact", () => {
  it("returns false when token count is below threshold", () => {
    const entries: SessionTranscriptEntry[] = [
      makeSessionHeader(),
      makeMessageEntry("user", "Short message"),
      makeMessageEntry("assistant", "Short reply"),
    ];

    const result = shouldCompact(entries, {
      contextWindow: 100000,
      maxCycleTokenRatio: 0.8,
    });
    expect(result).toBe(false);
  });

  it("returns true when token count exceeds threshold", () => {
    // Create a lot of large messages to exceed threshold
    const entries: SessionTranscriptEntry[] = [makeSessionHeader()];
    const longText = "word ".repeat(500); // ~500 tokens

    for (let i = 0; i < 200; i++) {
      entries.push(makeMessageEntry("user", longText));
      entries.push(makeMessageEntry("assistant", longText));
    }

    // contextWindow=1000, ratio=0.8 => threshold=800 tokens
    // 400 messages x ~500 tokens each = ~200000 tokens >> 800
    const result = shouldCompact(entries, {
      contextWindow: 1000,
      maxCycleTokenRatio: 0.8,
    });
    expect(result).toBe(true);
  });

  it("ignores non-message entries for token counting", () => {
    const entries: SessionTranscriptEntry[] = [
      makeSessionHeader(),
      {
        type: "data_tick",
        source: "yahoo",
        payload: {
          sourceId: "yahoo",
          timestamp: Date.now(),
          metrics: { price: 150 },
          metadata: {},
        },
      },
    ];

    const result = shouldCompact(entries, {
      contextWindow: 100,
      maxCycleTokenRatio: 0.8,
    });
    expect(result).toBe(false);
  });
});

describe("compactSession", () => {
  it("summarizes oldest 40% of messages and keeps newest 60%", async () => {
    const entries: SessionTranscriptEntry[] = [makeSessionHeader()];

    // Add 10 messages
    for (let i = 1; i <= 10; i++) {
      entries.push(
        makeMessageEntry(
          i % 2 === 1 ? "user" : "assistant",
          `Message number ${i}`
        )
      );
    }

    const provider = createSummaryProvider("Summary of old messages: 1-4");

    const options: CompactionOptions = {
      provider,
      model: "mock-model",
      contextWindow: 100,
      maxCycleTokenRatio: 0.8,
    };

    const compacted = await compactSession(entries, options);

    // Original: 1 header + 10 messages = 11 entries
    // Oldest 40% of messages (4 messages) compacted to 1 summary
    // Kept: 1 header + 1 summary + 6 newest messages = 8 entries
    expect(compacted.length).toBe(8);

    // First should be the original header
    expect(compacted[0]!.type).toBe("session");

    // Second should be the summary (a system message)
    expect(compacted[1]!.type).toBe("message");
    if (compacted[1]!.type === "message") {
      expect(compacted[1]!.message.role).toBe("system");
      expect(compacted[1]!.message.content).toContain("Summary of old messages");
    }

    // Last message should be the 10th original message
    const lastEntry = compacted[compacted.length - 1]!;
    expect(lastEntry.type).toBe("message");
    if (lastEntry.type === "message") {
      expect(lastEntry.message.content).toBe("Message number 10");
    }
  });

  it("sends correct prompt to the LLM for summarization", async () => {
    const entries: SessionTranscriptEntry[] = [
      makeSessionHeader(),
      makeMessageEntry("user", "What is AAPL doing?"),
      makeMessageEntry("assistant", "AAPL is up 5%."),
      makeMessageEntry("user", "Any anomalies?"),
      makeMessageEntry("assistant", "No anomalies detected."),
      makeMessageEntry("user", "Check GOOGL."),
    ];

    const createMessageSpy = vi.fn<
      [CreateMessageParams],
      AsyncIterable<StreamEvent>
    >();
    // Return a proper async iterable from the spy
    createMessageSpy.mockImplementation(async function* () {
      yield { type: "text_delta", text: "Compacted summary." };
      yield { type: "stop", reason: "end_turn" };
    });

    const provider: LLMProvider = {
      id: "spy-provider",
      name: "Spy",
      createMessage: createMessageSpy,
      healthCheck: vi.fn<[], Promise<ProviderHealth>>().mockResolvedValue({
        providerId: "spy-provider",
        status: "healthy",
        latencyMs: 10,
      }),
      listModels: vi.fn<[], string[]>().mockReturnValue(["spy-model"]),
    };

    await compactSession(entries, {
      provider,
      model: "spy-model",
      contextWindow: 100,
      maxCycleTokenRatio: 0.8,
    });

    expect(createMessageSpy).toHaveBeenCalledOnce();
    const callParams = createMessageSpy.mock.calls[0]![0];
    expect(callParams.model).toBe("spy-model");
    expect(callParams.system).toContain("summarize");
    // The user message should contain the old messages being compacted
    expect(callParams.messages[0]!.role).toBe("user");
    expect(callParams.messages[0]!.content).toContain("What is AAPL doing?");
  });

  it("preserves non-message entries in their original positions", async () => {
    const entries: SessionTranscriptEntry[] = [
      makeSessionHeader(),
      makeMessageEntry("user", "Msg 1"),
      makeMessageEntry("assistant", "Msg 2"),
      {
        type: "anomaly",
        anomaly: {
          id: "a1",
          severity: "high",
          source: "test",
          timestamp: Date.now(),
          description: "Spike",
          metrics: { x: 1 },
          preScreenScore: 0.9,
          sessionId: "test-session",
        },
      },
      makeMessageEntry("user", "Msg 3"),
      makeMessageEntry("assistant", "Msg 4"),
      makeMessageEntry("user", "Msg 5"),
      makeMessageEntry("assistant", "Msg 6"),
      makeMessageEntry("user", "Msg 7"),
      makeMessageEntry("assistant", "Msg 8"),
    ];

    const provider = createSummaryProvider("Summary of old messages");

    const compacted = await compactSession(entries, {
      provider,
      model: "mock-model",
      contextWindow: 100,
      maxCycleTokenRatio: 0.8,
    });

    // Non-message entries like anomalies should be preserved
    const anomalyEntries = compacted.filter((e) => e.type === "anomaly");
    expect(anomalyEntries).toHaveLength(1);
  });

  it("returns original entries unchanged when there are too few messages to compact", async () => {
    const entries: SessionTranscriptEntry[] = [
      makeSessionHeader(),
      makeMessageEntry("user", "Only one"),
    ];

    const provider = createSummaryProvider("Should not be called");

    const compacted = await compactSession(entries, {
      provider,
      model: "mock-model",
      contextWindow: 100,
      maxCycleTokenRatio: 0.8,
    });

    // With only 1 message, 40% = 0 messages to compact => return unchanged
    expect(compacted).toEqual(entries);
  });
});
```

### Step 2: Run tests, verify FAIL

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && npx vitest run agent/src/session/__tests__/session-compaction.test.ts
```

Expected: All tests fail because `session-compaction.ts` does not exist.

### Step 3: Write implementation

Create `agent/src/session/session-compaction.ts`:

```typescript
import { encode } from "gpt-tokenizer";
import type {
  LLMProvider,
  CreateMessageParams,
  StreamEvent,
  SessionTranscriptEntry,
} from "@finwatch/shared";

export type CompactionOptions = {
  provider: LLMProvider;
  model: string;
  contextWindow: number;
  maxCycleTokenRatio: number;
};

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}

export function shouldCompact(
  entries: SessionTranscriptEntry[],
  options: { contextWindow: number; maxCycleTokenRatio: number },
): boolean {
  const threshold = options.contextWindow * options.maxCycleTokenRatio;
  let totalTokens = 0;

  for (const entry of entries) {
    if (entry.type === "message") {
      totalTokens += estimateTokens(entry.message.content);
      if (totalTokens > threshold) return true;
    }
  }

  return false;
}

export async function compactSession(
  entries: SessionTranscriptEntry[],
  options: CompactionOptions,
): Promise<SessionTranscriptEntry[]> {
  // Separate header, messages, and non-message entries with their indices
  const header = entries.find((e) => e.type === "session");
  const messageEntries: Array<{ index: number; entry: SessionTranscriptEntry }> = [];
  const nonMessageEntries: Array<{ index: number; entry: SessionTranscriptEntry }> = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.type === "message") {
      messageEntries.push({ index: i, entry });
    } else if (entry.type !== "session") {
      nonMessageEntries.push({ index: i, entry });
    }
  }

  // Calculate how many messages to compact (oldest 40%)
  const compactCount = Math.floor(messageEntries.length * 0.4);

  if (compactCount < 1) {
    return entries;
  }

  const oldMessages = messageEntries.slice(0, compactCount);
  const keptMessages = messageEntries.slice(compactCount);

  // Build the text to summarize
  const oldText = oldMessages
    .map((m) => {
      if (m.entry.type === "message") {
        return `[${m.entry.message.role}]: ${m.entry.message.content}`;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");

  // Call LLM to summarize
  const summaryText = await callLLMForSummary(oldText, options);

  // Build compacted entries
  const result: SessionTranscriptEntry[] = [];

  // Header first
  if (header) {
    result.push(header);
  }

  // Summary as system message
  const summaryEntry: SessionTranscriptEntry = {
    type: "message",
    message: {
      role: "system",
      content: summaryText,
      timestamp: Date.now(),
    },
  };
  result.push(summaryEntry);

  // Merge kept messages and non-message entries, preserving order
  const remaining = [
    ...keptMessages.map((m) => m.entry),
    ...nonMessageEntries.map((m) => m.entry),
  ];

  // Sort by original index to maintain order
  const allRemaining = [
    ...keptMessages,
    ...nonMessageEntries,
  ].sort((a, b) => a.index - b.index);

  for (const item of allRemaining) {
    result.push(item.entry);
  }

  return result;
}

async function callLLMForSummary(
  oldText: string,
  options: CompactionOptions,
): Promise<string> {
  const params: CreateMessageParams = {
    model: options.model,
    system:
      "You are a session compaction assistant. Your job is to summarize the following conversation messages into a concise summary that preserves all key facts, decisions, anomalies detected, and context needed for continued analysis. Be factual and thorough.",
    messages: [
      {
        role: "user",
        content: `Please summarize the following conversation messages:\n\n${oldText}`,
      },
    ],
    maxTokens: 2048,
    temperature: 0.2,
  };

  let summary = "";
  for await (const event of options.provider.createMessage(params)) {
    if (event.type === "text_delta") {
      summary += event.text;
    }
  }

  return summary;
}
```

### Step 4: Run tests, verify PASS

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && npx vitest run agent/src/session/__tests__/session-compaction.test.ts
```

Expected: All tests pass.

### Step 5: Commit

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && git add agent/package.json agent/src/session/session-compaction.ts agent/src/session/__tests__/session-compaction.test.ts && git commit -m "feat(agent): add session compaction with token estimation and LLM summary

Compacts oldest 40% of messages into a system summary when tokens
exceed maxCycleTokenRatio * contextWindow. Uses gpt-tokenizer for
accurate token estimation.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 1B.8: Tool Executor Framework

**Goal:** Implement a `ToolRegistry` where each tool has a name, description, Zod input schema, and an async handler. The registry validates inputs against the schema before executing, and provides tool definitions in the format expected by `CreateMessageParams.tools`.

**Files:**
- Modify: `agent/package.json` (add `zod` as a direct dependency)
- Create: `agent/src/tools/__tests__/tool-registry.test.ts`
- Create: `agent/src/tools/tool-registry.ts`

### Step 1: Install dependency and write failing tests

First, add zod as a direct dependency of the agent package (it is already in shared, but the tool registry needs it directly for schema definitions):

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && cd agent && pnpm add zod
```

Create `agent/src/tools/__tests__/tool-registry.test.ts`:

```typescript
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
```

### Step 2: Run tests, verify FAIL

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && npx vitest run agent/src/tools/__tests__/tool-registry.test.ts
```

Expected: All 11 tests fail because `tool-registry.ts` does not exist.

### Step 3: Write implementation

Create `agent/src/tools/tool-registry.ts`:

```typescript
import { z, type ZodObject, type ZodRawShape } from "zod";
import type { ToolDefinition } from "@finwatch/shared";

export type ToolHandler<T extends ZodRawShape> = (
  args: z.infer<ZodObject<T>>
) => Promise<unknown>;

export type ToolEntry<T extends ZodRawShape = ZodRawShape> = {
  name: string;
  description: string;
  inputSchema: ZodObject<T>;
  handler: ToolHandler<T>;
};

export class ToolNotFoundError extends Error {
  constructor(name: string) {
    super(`Tool not found: ${name}`);
    this.name = "ToolNotFoundError";
  }
}

export class ToolValidationError extends Error {
  constructor(toolName: string, issues: z.ZodIssue[]) {
    const details = issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
    super(`Validation failed for tool '${toolName}': ${details}`);
    this.name = "ToolValidationError";
  }
}

export class ToolExecutionError extends Error {
  constructor(toolName: string, cause: Error) {
    super(`Tool '${toolName}' execution failed: ${cause.message}`);
    this.name = "ToolExecutionError";
    this.cause = cause;
  }
}

// Internal storage type that erases the generic
type StoredTool = {
  name: string;
  description: string;
  inputSchema: ZodObject<ZodRawShape>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
};

export class ToolRegistry {
  private tools = new Map<string, StoredTool>();

  register<T extends ZodRawShape>(entry: ToolEntry<T>): void {
    if (this.tools.has(entry.name)) {
      throw new Error(`Tool already registered: ${entry.name}`);
    }
    this.tools.set(entry.name, {
      name: entry.name,
      description: entry.description,
      inputSchema: entry.inputSchema as unknown as ZodObject<ZodRawShape>,
      handler: entry.handler as (args: Record<string, unknown>) => Promise<unknown>,
    });
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  listTools(): string[] {
    return [...this.tools.keys()];
  }

  async execute(name: string, rawArgs: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new ToolNotFoundError(name);
    }

    // Validate input
    const parseResult = tool.inputSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      throw new ToolValidationError(name, parseResult.error.issues);
    }

    // Execute handler with validated & coerced args
    try {
      return await tool.handler(parseResult.data as Record<string, unknown>);
    } catch (err) {
      throw new ToolExecutionError(
        name,
        err instanceof Error ? err : new Error(String(err))
      );
    }
  }

  getToolDefinitions(): ToolDefinition[] {
    const definitions: ToolDefinition[] = [];

    for (const tool of this.tools.values()) {
      // Convert Zod schema to JSON Schema
      const jsonSchema = zodToJsonSchema(tool.inputSchema);
      definitions.push({
        name: tool.name,
        description: tool.description,
        inputSchema: jsonSchema,
      });
    }

    return definitions;
  }
}

/**
 * Converts a Zod object schema to a JSON Schema compatible object.
 * Handles common Zod types used in tool definitions.
 */
function zodToJsonSchema(schema: ZodObject<ZodRawShape>): Record<string, unknown> {
  const shape = schema.shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const { jsonSchema, isOptional } = zodFieldToJsonSchema(value as z.ZodTypeAny);
    properties[key] = jsonSchema;
    if (!isOptional) {
      required.push(key);
    }
  }

  const result: Record<string, unknown> = {
    type: "object",
    properties,
  };

  if (required.length > 0) {
    result.required = required;
  }

  return result;
}

function zodFieldToJsonSchema(field: z.ZodTypeAny): {
  jsonSchema: Record<string, unknown>;
  isOptional: boolean;
} {
  let isOptional = false;
  let current: z.ZodTypeAny = field;

  // Unwrap optional
  if (current instanceof z.ZodOptional) {
    isOptional = true;
    current = current.unwrap();
  }

  // Unwrap default
  if (current instanceof z.ZodDefault) {
    isOptional = true;
    current = current._def.innerType as z.ZodTypeAny;
  }

  const schema: Record<string, unknown> = {};

  if (current instanceof z.ZodString) {
    schema.type = "string";
  } else if (current instanceof z.ZodNumber) {
    schema.type = "number";
  } else if (current instanceof z.ZodBoolean) {
    schema.type = "boolean";
  } else if (current instanceof z.ZodEnum) {
    schema.type = "string";
    schema.enum = current._def.values;
  } else if (current instanceof z.ZodArray) {
    schema.type = "array";
    const inner = zodFieldToJsonSchema(current._def.type as z.ZodTypeAny);
    schema.items = inner.jsonSchema;
  } else if (current instanceof z.ZodObject) {
    const inner = zodToJsonSchema(current as ZodObject<ZodRawShape>);
    Object.assign(schema, inner);
  } else {
    // Fallback for unhandled types
    schema.type = "object";
  }

  // Add description if present
  if (current.description) {
    schema.description = current.description;
  }

  return { jsonSchema: schema, isOptional };
}
```

### Step 4: Run tests, verify PASS

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && npx vitest run agent/src/tools/__tests__/tool-registry.test.ts
```

Expected: All 11 tests pass.

### Step 5: Commit

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && git add agent/package.json agent/src/tools/tool-registry.ts agent/src/tools/__tests__/tool-registry.test.ts && git commit -m "feat(agent): add ToolRegistry with Zod schema validation and JSON Schema export

Each tool has a name, description, Zod input schema, and async handler.
Registry validates inputs before execution and exports definitions in
LLM-compatible ToolDefinition format.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Final Verification

After all 8 tasks are complete, run the full test suite to verify everything works together:

```bash
cd /Users/jdsingh/Projects/AI/finwatch-node-agent && npx vitest run --project agent
```

Expected output: All tests pass across all test files:
- `agent/src/__tests__/index.test.ts` (1 test)
- `agent/src/__tests__/json-rpc.test.ts` (5 tests)
- `agent/src/ipc/__tests__/json-rpc-server.test.ts` (8 tests)
- `agent/src/providers/__tests__/provider-registry.test.ts` (7 tests)
- `agent/src/providers/__tests__/anthropic-provider.test.ts` (8 tests)
- `agent/src/providers/__tests__/openrouter-provider.test.ts` (9 tests)
- `agent/src/providers/__tests__/fallback.test.ts` (10 tests)
- `agent/src/session/__tests__/session-manager.test.ts` (13 tests)
- `agent/src/session/__tests__/session-compaction.test.ts` (7+ tests)
- `agent/src/tools/__tests__/tool-registry.test.ts` (11 tests)

**Total: ~79 tests across 10 test files.**

## File Tree After Completion

```
agent/
  package.json                                   (modified: +@anthropic-ai/sdk, +gpt-tokenizer, +zod)
  tsconfig.json                                  (unchanged)
  src/
    index.ts                                     (modified: uses JsonRpcServer)
    ipc/
      json-rpc.ts                                (unchanged)
      json-rpc-server.ts                         (NEW)
      __tests__/
        json-rpc.test.ts                         (unchanged)
        json-rpc-server.test.ts                  (NEW)
    providers/
      provider-registry.ts                       (NEW)
      anthropic-provider.ts                      (NEW)
      openrouter-provider.ts                     (NEW)
      fallback.ts                                (NEW)
      __tests__/
        provider-registry.test.ts                (NEW)
        anthropic-provider.test.ts               (NEW)
        openrouter-provider.test.ts              (NEW)
        fallback.test.ts                         (NEW)
    session/
      session-manager.ts                         (NEW)
      session-compaction.ts                      (NEW)
      __tests__/
        session-manager.test.ts                  (NEW)
        session-compaction.test.ts               (NEW)
    tools/
      tool-registry.ts                           (NEW)
      __tests__/
        tool-registry.test.ts                    (NEW)
```
