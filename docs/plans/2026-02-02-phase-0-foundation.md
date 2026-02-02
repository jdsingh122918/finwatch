# Phase 0: Foundation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Scaffold the FinWatch monorepo with Tauri v2 + React + Node.js agent sidecar, define all shared type contracts, and establish the TDD infrastructure so that Phase 1 parallel agents can start immediately with zero ambiguity.

**Architecture:** Tauri v2 desktop app (Rust backend) with React/TypeScript frontend and a Node.js agent sidecar communicating over stdio JSON-RPC. Shared types package defines all IPC contracts. Vitest for TypeScript tests, cargo test for Rust tests.

**Tech Stack:** Tauri v2, React 19, TypeScript 5, Zod 3, Vitest, Rust (edition 2021), pnpm workspaces

---

## Task 1: Initialize Git Repository and Monorepo Scaffold

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`

**Step 1: Initialize git repo**

```bash
cd /Users/jdsingh/Projects/AI/finwatch
git init
```

**Step 2: Create `.gitignore`**

```gitignore
# Dependencies
node_modules/
.pnpm-store/

# Build output
dist/
target/
src-tauri/target/

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Environment
.env
.env.local

# Tauri
src-tauri/gen/

# FinWatch runtime data (never commit user data)
.finwatch/

# Test coverage
coverage/

# Logs
*.log
```

**Step 3: Create root `package.json`**

```json
{
  "name": "finwatch",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "pnpm --filter @finwatch/frontend dev",
    "build": "pnpm --filter @finwatch/frontend build",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:ts": "vitest run",
    "test:rust": "cargo test --manifest-path src-tauri/Cargo.toml",
    "test:all": "pnpm test:ts && pnpm test:rust",
    "lint": "tsc --noEmit",
    "tauri": "tauri"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.2.0"
  }
}
```

**Step 4: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "shared"
  - "agent"
  - "src"
```

**Step 5: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": false
  }
}
```

**Step 6: Install dependencies and verify**

```bash
pnpm install
```

Expected: lockfile created, no errors.

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: initialize monorepo scaffold"
```

---

## Task 2: Scaffold Tauri v2 App with React Frontend

**Files:**
- Create: `src-tauri/` (entire Tauri backend)
- Create: `src/` (React frontend)
- Modify: `package.json` (add Tauri + React deps)

**Step 1: Create Tauri v2 + React project**

Run from project root. When prompted:
- Project name: `finwatch`
- Identifier: `com.finwatch.app`
- Frontend language: TypeScript / JavaScript
- Package manager: pnpm
- UI template: React
- UI flavor: TypeScript

```bash
pnpm create tauri-app@latest . --manager pnpm --template react-ts --yes
```

If `create-tauri-app` does not support in-place init, create in a temp dir and move files:

```bash
pnpm create tauri-app finwatch-tmp
# Then manually move src-tauri/, src/, and merge package.json deps
```

**Step 2: Install all dependencies**

```bash
pnpm install
```

**Step 3: Add Tauri shell plugin for sidecar support**

```bash
cd /Users/jdsingh/Projects/AI/finwatch
pnpm tauri add shell
```

This adds `tauri-plugin-shell` to `src-tauri/Cargo.toml` and the JS bindings.

**Step 4: Add Tauri process plugin**

```bash
pnpm tauri add process
```

**Step 5: Verify Rust compiles**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: compiles with no errors. Trust the Rust compiler.

**Step 6: Verify Tauri dev window opens**

```bash
pnpm tauri dev
```

Expected: desktop window opens with React starter page. Close it.

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: scaffold Tauri v2 with React frontend and shell plugin"
```

---

## Task 3: Create Shared Types Package

**Files:**
- Create: `shared/package.json`
- Create: `shared/tsconfig.json`
- Create: `shared/src/index.ts`
- Create: `shared/src/data.ts`
- Create: `shared/src/anomaly.ts`
- Create: `shared/src/memory.ts`
- Create: `shared/src/agent.ts`
- Create: `shared/src/provider.ts`
- Create: `shared/src/ipc.ts`
- Create: `shared/src/__tests__/types.test.ts`

**Step 1: Create `shared/package.json`**

```json
{
  "name": "@finwatch/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

**Step 2: Create `shared/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

**Step 3: Write the failing type tests**

Create `shared/src/__tests__/types.test.ts`:

```typescript
import { describe, it, expectTypeOf } from "vitest";
import type {
  DataTick,
  SourceHealth,
  SourceConfig,
  Anomaly,
  AnomalyFeedback,
  Severity,
  MemoryEntry,
  SearchResult,
  DomainPattern,
  AgentMessage,
  SessionMeta,
  CycleState,
  AgentStatus,
  AgentActivity,
  LLMProvider,
  ProviderHealth,
  ModelSlot,
  IpcCommands,
  IpcEvents,
} from "../index.js";

describe("shared types", () => {
  it("DataTick has required fields", () => {
    expectTypeOf<DataTick>().toHaveProperty("sourceId");
    expectTypeOf<DataTick>().toHaveProperty("timestamp");
    expectTypeOf<DataTick>().toHaveProperty("metrics");
    expectTypeOf<DataTick>().toHaveProperty("metadata");
  });

  it("DataTick.metrics is Record<string, number>", () => {
    expectTypeOf<DataTick["metrics"]>().toEqualTypeOf<
      Record<string, number>
    >();
  });

  it("SourceHealth has status union", () => {
    expectTypeOf<SourceHealth["status"]>().toEqualTypeOf<
      "healthy" | "degraded" | "offline"
    >();
  });

  it("Anomaly has required fields", () => {
    expectTypeOf<Anomaly>().toHaveProperty("id");
    expectTypeOf<Anomaly>().toHaveProperty("severity");
    expectTypeOf<Anomaly>().toHaveProperty("source");
    expectTypeOf<Anomaly>().toHaveProperty("timestamp");
    expectTypeOf<Anomaly>().toHaveProperty("description");
  });

  it("Severity is a union of levels", () => {
    expectTypeOf<Severity>().toEqualTypeOf<"low" | "medium" | "high" | "critical">();
  });

  it("AnomalyFeedback has verdict", () => {
    expectTypeOf<AnomalyFeedback>().toHaveProperty("anomalyId");
    expectTypeOf<AnomalyFeedback>().toHaveProperty("verdict");
    expectTypeOf<AnomalyFeedback["verdict"]>().toEqualTypeOf<
      "confirmed" | "false_positive" | "needs_review"
    >();
  });

  it("MemoryEntry has content and embedding", () => {
    expectTypeOf<MemoryEntry>().toHaveProperty("id");
    expectTypeOf<MemoryEntry>().toHaveProperty("content");
    expectTypeOf<MemoryEntry>().toHaveProperty("embedding");
  });

  it("SearchResult has score", () => {
    expectTypeOf<SearchResult>().toHaveProperty("entry");
    expectTypeOf<SearchResult>().toHaveProperty("score");
    expectTypeOf<SearchResult["score"]>().toBeNumber();
  });

  it("SessionMeta has required fields", () => {
    expectTypeOf<SessionMeta>().toHaveProperty("id");
    expectTypeOf<SessionMeta>().toHaveProperty("startedAt");
    expectTypeOf<SessionMeta>().toHaveProperty("kind");
    expectTypeOf<SessionMeta["kind"]>().toEqualTypeOf<
      "monitor" | "subagent" | "improvement"
    >();
  });

  it("AgentStatus has state union", () => {
    expectTypeOf<AgentStatus>().toHaveProperty("state");
    expectTypeOf<AgentStatus["state"]>().toEqualTypeOf<
      "idle" | "running" | "paused" | "error"
    >();
  });

  it("LLMProvider has required methods shape", () => {
    expectTypeOf<LLMProvider>().toHaveProperty("id");
    expectTypeOf<LLMProvider>().toHaveProperty("name");
    expectTypeOf<LLMProvider>().toHaveProperty("createMessage");
    expectTypeOf<LLMProvider>().toHaveProperty("healthCheck");
  });

  it("ProviderHealth has status", () => {
    expectTypeOf<ProviderHealth["status"]>().toEqualTypeOf<
      "healthy" | "degraded" | "offline" | "rate_limited"
    >();
  });

  it("IpcCommands defines all command signatures", () => {
    expectTypeOf<IpcCommands>().toHaveProperty("agent:start");
    expectTypeOf<IpcCommands>().toHaveProperty("agent:stop");
    expectTypeOf<IpcCommands>().toHaveProperty("agent:status");
    expectTypeOf<IpcCommands>().toHaveProperty("config:get");
    expectTypeOf<IpcCommands>().toHaveProperty("config:update");
    expectTypeOf<IpcCommands>().toHaveProperty("anomalies:list");
    expectTypeOf<IpcCommands>().toHaveProperty("anomalies:feedback");
    expectTypeOf<IpcCommands>().toHaveProperty("memory:search");
    expectTypeOf<IpcCommands>().toHaveProperty("sources:health");
  });

  it("IpcEvents defines all event signatures", () => {
    expectTypeOf<IpcEvents>().toHaveProperty("agent:activity");
    expectTypeOf<IpcEvents>().toHaveProperty("data:tick");
    expectTypeOf<IpcEvents>().toHaveProperty("anomaly:detected");
    expectTypeOf<IpcEvents>().toHaveProperty("source:health-change");
    expectTypeOf<IpcEvents>().toHaveProperty("memory:updated");
  });
});
```

**Step 4: Run tests — verify they FAIL**

```bash
pnpm vitest run shared/
```

Expected: FAIL — types not defined yet.

**Step 5: Implement `shared/src/data.ts`**

```typescript
export type DataTick = {
  sourceId: string;
  timestamp: number;
  symbol?: string;
  metrics: Record<string, number>;
  metadata: Record<string, unknown>;
  raw?: unknown;
};

export type SourceHealthStatus = "healthy" | "degraded" | "offline";

export type SourceHealth = {
  sourceId: string;
  status: SourceHealthStatus;
  lastSuccess: number;
  lastFailure?: number;
  failCount: number;
  latencyMs: number;
  message?: string;
};

export type SourceType = "polling" | "streaming" | "file";

export type SourceConfig = {
  id: string;
  name: string;
  type: SourceType;
  plugin: string;
  config: Record<string, unknown>;
  pollIntervalMs?: number;
  enabled: boolean;
};
```

**Step 6: Implement `shared/src/anomaly.ts`**

```typescript
export type Severity = "low" | "medium" | "high" | "critical";

export type Anomaly = {
  id: string;
  severity: Severity;
  source: string;
  symbol?: string;
  timestamp: number;
  description: string;
  metrics: Record<string, number>;
  preScreenScore: number;
  sessionId: string;
};

export type FeedbackVerdict = "confirmed" | "false_positive" | "needs_review";

export type AnomalyFeedback = {
  anomalyId: string;
  verdict: FeedbackVerdict;
  note?: string;
  timestamp: number;
};

export type AnomalyFilter = {
  severity?: Severity[];
  source?: string;
  symbol?: string;
  since?: number;
  limit?: number;
};
```

**Step 7: Implement `shared/src/memory.ts`**

```typescript
export type MemoryEntry = {
  id: string;
  content: string;
  embedding: number[];
  source: string;
  timestamp: number;
  tags: string[];
};

export type SearchResult = {
  entry: MemoryEntry;
  score: number;
  matchType: "vector" | "keyword" | "hybrid";
};

export type DomainPattern = {
  id: string;
  pattern: string;
  confidence: number;
  source: string;
  createdAt: number;
  updatedAt: number;
};

export type DomainCorrelation = {
  id: string;
  sourceA: string;
  sourceB: string;
  rule: string;
  confidence: number;
  createdAt: number;
};

export type DomainThreshold = {
  id: string;
  source: string;
  metric: string;
  value: number;
  direction: "above" | "below";
  updatedAt: number;
};

export type MemoryEvent = {
  type: "created" | "updated" | "deleted";
  entryId: string;
  timestamp: number;
};
```

**Step 8: Implement `shared/src/agent.ts`**

```typescript
import type { DataTick } from "./data.js";
import type { Anomaly, AnomalyFeedback } from "./anomaly.js";

export type SessionKind = "monitor" | "subagent" | "improvement";

export type SessionMeta = {
  id: string;
  startedAt: number;
  endedAt?: number;
  kind: SessionKind;
  parentSessionId?: string;
  tokenCount: number;
};

export type AgentMessageRole = "user" | "assistant" | "system";

export type AgentMessage = {
  role: AgentMessageRole;
  content: string;
  model?: string;
  usage?: { input: number; output: number };
  timestamp: number;
};

export type CycleState = {
  cycleId: string;
  sessionId: string;
  batchNumber: number;
  tickCount: number;
  anomaliesDetected: number;
  startedAt: number;
};

export type AgentState = "idle" | "running" | "paused" | "error";

export type AgentStatus = {
  state: AgentState;
  currentSessionId?: string;
  currentCycleId?: string;
  totalCycles: number;
  totalAnomalies: number;
  uptime: number;
  lastError?: string;
};

export type AgentActivityType =
  | "cycle_start"
  | "cycle_end"
  | "anomaly_detected"
  | "memory_flush"
  | "compaction"
  | "subagent_spawn"
  | "feedback_processed"
  | "rule_evolved"
  | "error";

export type AgentActivity = {
  type: AgentActivityType;
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
};

export type SessionTranscriptEntry =
  | { type: "session"; version: number; id: string; timestamp: string; kind: SessionKind }
  | { type: "data_tick"; source: string; payload: DataTick }
  | { type: "message"; message: AgentMessage }
  | { type: "anomaly"; anomaly: Anomaly }
  | { type: "feedback"; feedback: AnomalyFeedback };
```

**Step 9: Implement `shared/src/provider.ts`**

```typescript
export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "usage"; input: number; output: number }
  | { type: "stop"; reason: string };

export type LLMMessage = {
  role: "user" | "assistant";
  content: string;
};

export type CreateMessageParams = {
  model: string;
  system?: string;
  messages: LLMMessage[];
  maxTokens: number;
  temperature?: number;
  tools?: ToolDefinition[];
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type LLMProvider = {
  id: string;
  name: string;
  createMessage(params: CreateMessageParams): AsyncIterable<StreamEvent>;
  healthCheck(): Promise<ProviderHealth>;
  listModels(): string[];
};

export type ProviderHealthStatus = "healthy" | "degraded" | "offline" | "rate_limited";

export type ProviderHealth = {
  providerId: string;
  status: ProviderHealthStatus;
  latencyMs: number;
  lastSuccess?: number;
  lastError?: string;
  cooldownUntil?: number;
};

export type ModelSlot = "analysis" | "subagent" | "improvement";

export type ModelAssignment = {
  slot: ModelSlot;
  provider: string;
  model: string;
};
```

**Step 10: Implement `shared/src/ipc.ts`**

```typescript
import type { AgentStatus, AgentActivity } from "./agent.js";
import type { Anomaly, AnomalyFeedback, AnomalyFilter } from "./anomaly.js";
import type { DataTick, SourceHealth } from "./data.js";
import type { SearchResult, MemoryEvent } from "./memory.js";
import type { Config } from "./config.js";

// Commands: React -> Rust -> Node.js (request/response)
export type IpcCommands = {
  "agent:start": () => void;
  "agent:stop": () => void;
  "agent:status": () => AgentStatus;
  "config:get": () => Config;
  "config:update": (patch: Partial<Config>) => Config;
  "anomalies:list": (filter: AnomalyFilter) => Anomaly[];
  "anomalies:feedback": (id: string, feedback: AnomalyFeedback) => void;
  "memory:search": (query: string) => SearchResult[];
  "sources:health": () => Record<string, SourceHealth>;
};

// Events: Node.js -> Rust -> React (push, fire-and-forget)
export type IpcEvents = {
  "agent:activity": AgentActivity;
  "data:tick": DataTick;
  "anomaly:detected": Anomaly;
  "source:health-change": SourceHealth;
  "memory:updated": MemoryEvent;
};
```

**Step 11: Implement `shared/src/index.ts` (barrel export)**

```typescript
export type {
  DataTick,
  SourceHealth,
  SourceHealthStatus,
  SourceConfig,
  SourceType,
} from "./data.js";

export type {
  Severity,
  Anomaly,
  AnomalyFeedback,
  AnomalyFilter,
  FeedbackVerdict,
} from "./anomaly.js";

export type {
  MemoryEntry,
  SearchResult,
  DomainPattern,
  DomainCorrelation,
  DomainThreshold,
  MemoryEvent,
} from "./memory.js";

export type {
  SessionKind,
  SessionMeta,
  AgentMessage,
  AgentMessageRole,
  CycleState,
  AgentState,
  AgentStatus,
  AgentActivity,
  AgentActivityType,
  SessionTranscriptEntry,
} from "./agent.js";

export type {
  StreamEvent,
  LLMMessage,
  CreateMessageParams,
  ToolDefinition,
  LLMProvider,
  ProviderHealth,
  ProviderHealthStatus,
  ModelSlot,
  ModelAssignment,
} from "./provider.js";

export type { IpcCommands, IpcEvents } from "./ipc.js";

export { type Config, ConfigSchema, parseConfig } from "./config.js";
```

**Step 12: Run tests — verify they PASS**

```bash
pnpm vitest run shared/
```

Expected: ALL PASS.

**Step 13: Commit**

```bash
git add shared/
git commit -m "feat: add shared types package with full IPC contract"
```

---

## Task 4: Zod Config Schema with Validation

**Files:**
- Create: `shared/src/config.ts`
- Create: `shared/src/__tests__/config.test.ts`
- Modify: `shared/package.json` (add zod dependency)

**Step 1: Add Zod dependency**

```bash
pnpm --filter @finwatch/shared add zod
```

**Step 2: Write the failing config tests**

Create `shared/src/__tests__/config.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { ConfigSchema, parseConfig } from "../config.js";

const validConfig = {
  providers: [
    { id: "anthropic", type: "anthropic" as const, apiKeyEnv: "ANTHROPIC_API_KEY" },
  ],
  model: {
    analysis: { provider: "anthropic", model: "claude-opus-4-5-20251101" },
    subagent: { provider: "anthropic", model: "claude-sonnet-4-5-20241022" },
    improvement: { provider: "anthropic", model: "claude-opus-4-5-20251101" },
    fallbacks: [],
    temperature: 0.3,
    maxTokens: 8192,
  },
  monitor: {
    analysisIntervalMs: 60000,
    preScreen: { zScoreThreshold: 3.0, urgentThreshold: 0.6, skipThreshold: 0.2 },
    maxCycleTokenRatio: 0.8,
    maxCycleAgeMs: 14400000,
  },
  sources: [
    {
      id: "yahoo-finance",
      name: "Yahoo Finance",
      type: "polling" as const,
      plugin: "market-api",
      config: { provider: "yahoo", symbols: ["AAPL", "GOOGL"], interval: "5m" },
      pollIntervalMs: 300000,
      enabled: true,
    },
  ],
  memory: {
    embedding: { provider: "openai", model: "text-embedding-3-small" },
    search: { vectorWeight: 0.7, textWeight: 0.3, maxResults: 6, minScore: 0.35 },
    chunking: { tokens: 400, overlap: 80 },
  },
  improvement: {
    feedback: { batchSize: 10, batchIntervalMs: 7200000 },
    evolution: { enabled: true, intervalMs: 86400000, autoRevertThreshold: 0.5 },
    consolidation: { enabled: true, intervalMs: 604800000 },
  },
  subagents: { maxConcurrent: 3, defaultTimeoutSeconds: 120 },
};

describe("ConfigSchema", () => {
  it("parses a valid full config", () => {
    const result = ConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const result = ConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects invalid provider type", () => {
    const bad = {
      ...validConfig,
      providers: [{ id: "x", type: "invalid", apiKeyEnv: "X" }],
    };
    const result = ConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects negative analysisIntervalMs", () => {
    const bad = {
      ...validConfig,
      monitor: { ...validConfig.monitor, analysisIntervalMs: -1 },
    };
    const result = ConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects zScoreThreshold below 0", () => {
    const bad = {
      ...validConfig,
      monitor: {
        ...validConfig.monitor,
        preScreen: { ...validConfig.monitor.preScreen, zScoreThreshold: -1 },
      },
    };
    const result = ConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("applies defaults for optional fields", () => {
    const minimal = {
      providers: validConfig.providers,
      model: validConfig.model,
      monitor: validConfig.monitor,
      sources: [],
      memory: validConfig.memory,
      improvement: validConfig.improvement,
      subagents: validConfig.subagents,
    };
    const result = ConfigSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });
});

describe("parseConfig", () => {
  it("returns parsed config for valid input", () => {
    const config = parseConfig(validConfig);
    expect(config.providers[0].id).toBe("anthropic");
  });

  it("throws on invalid input", () => {
    expect(() => parseConfig({})).toThrow();
  });
});
```

**Step 3: Run tests — verify they FAIL**

```bash
pnpm vitest run shared/src/__tests__/config.test.ts
```

Expected: FAIL — `config.js` does not exist.

**Step 4: Implement `shared/src/config.ts`**

```typescript
import { z } from "zod";

const ProviderConfigSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["anthropic", "claude-max", "openrouter"]),
  apiKeyEnv: z.string().optional(),
});

const ModelAssignmentSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
});

const ModelConfigSchema = z.object({
  analysis: ModelAssignmentSchema,
  subagent: ModelAssignmentSchema,
  improvement: ModelAssignmentSchema,
  fallbacks: z.array(ModelAssignmentSchema).default([]),
  temperature: z.number().min(0).max(2).default(0.3),
  maxTokens: z.number().int().positive().default(8192),
});

const PreScreenConfigSchema = z.object({
  zScoreThreshold: z.number().nonnegative().default(3.0),
  urgentThreshold: z.number().min(0).max(1).default(0.6),
  skipThreshold: z.number().min(0).max(1).default(0.2),
});

const MonitorConfigSchema = z.object({
  analysisIntervalMs: z.number().int().positive().default(60000),
  preScreen: PreScreenConfigSchema,
  maxCycleTokenRatio: z.number().min(0).max(1).default(0.8),
  maxCycleAgeMs: z.number().int().positive().default(14400000),
});

const SourceConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["polling", "streaming", "file"]),
  plugin: z.string().min(1),
  config: z.record(z.unknown()),
  pollIntervalMs: z.number().int().positive().optional(),
  enabled: z.boolean().default(true),
});

const MemoryConfigSchema = z.object({
  embedding: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
  }),
  search: z.object({
    vectorWeight: z.number().min(0).max(1).default(0.7),
    textWeight: z.number().min(0).max(1).default(0.3),
    maxResults: z.number().int().positive().default(6),
    minScore: z.number().min(0).max(1).default(0.35),
  }),
  chunking: z.object({
    tokens: z.number().int().positive().default(400),
    overlap: z.number().int().nonnegative().default(80),
  }),
});

const ImprovementConfigSchema = z.object({
  feedback: z.object({
    batchSize: z.number().int().positive().default(10),
    batchIntervalMs: z.number().int().positive().default(7200000),
  }),
  evolution: z.object({
    enabled: z.boolean().default(true),
    intervalMs: z.number().int().positive().default(86400000),
    autoRevertThreshold: z.number().min(0).max(1).default(0.5),
  }),
  consolidation: z.object({
    enabled: z.boolean().default(true),
    intervalMs: z.number().int().positive().default(604800000),
  }),
});

const SubagentConfigSchema = z.object({
  maxConcurrent: z.number().int().positive().default(3),
  defaultTimeoutSeconds: z.number().int().positive().default(120),
});

export const ConfigSchema = z.object({
  providers: z.array(ProviderConfigSchema).min(1),
  model: ModelConfigSchema,
  monitor: MonitorConfigSchema,
  sources: z.array(SourceConfigSchema).default([]),
  memory: MemoryConfigSchema,
  improvement: ImprovementConfigSchema,
  subagents: SubagentConfigSchema,
});

export type Config = z.infer<typeof ConfigSchema>;

export function parseConfig(raw: unknown): Config {
  return ConfigSchema.parse(raw);
}
```

**Step 5: Run tests — verify they PASS**

```bash
pnpm vitest run shared/src/__tests__/config.test.ts
```

Expected: ALL PASS.

**Step 6: Run all shared tests**

```bash
pnpm vitest run shared/
```

Expected: ALL PASS (types + config).

**Step 7: Commit**

```bash
git add shared/
git commit -m "feat: add Zod config schema with validation"
```

---

## Task 5: Rust Mirror Types + Serde Tests

**Files:**
- Create: `src-tauri/src/types.rs`
- Create: `src-tauri/src/types/data.rs`
- Create: `src-tauri/src/types/anomaly.rs`
- Create: `src-tauri/src/types/memory.rs`
- Create: `src-tauri/src/types/agent.rs`
- Create: `src-tauri/src/types/provider.rs`
- Create: `src-tauri/src/types/config.rs`
- Modify: `src-tauri/src/lib.rs` (add `mod types`)
- Modify: `src-tauri/Cargo.toml` (add serde_json)

**Step 1: Add serde_json to Cargo.toml**

Add under `[dependencies]` in `src-tauri/Cargo.toml`:

```toml
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

(serde may already be present via Tauri — check first, only add if missing.)

**Step 2: Write the failing Rust tests**

Create `src-tauri/src/types/mod.rs`:

```rust
pub mod data;
pub mod anomaly;
pub mod memory;
pub mod agent;
pub mod provider;
pub mod config;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    #[test]
    fn data_tick_roundtrip() {
        let json = r#"{
            "sourceId": "yahoo-finance",
            "timestamp": 1706800000,
            "symbol": "AAPL",
            "metrics": {"price": 150.25, "volume": 1200000.0},
            "metadata": {}
        }"#;
        let tick: data::DataTick = serde_json::from_str(json).unwrap();
        assert_eq!(tick.source_id, "yahoo-finance");
        assert_eq!(tick.symbol, Some("AAPL".to_string()));
        let re_json = serde_json::to_string(&tick).unwrap();
        let tick2: data::DataTick = serde_json::from_str(&re_json).unwrap();
        assert_eq!(tick.source_id, tick2.source_id);
    }

    #[test]
    fn source_health_roundtrip() {
        let json = r#"{
            "sourceId": "yahoo",
            "status": "healthy",
            "lastSuccess": 1706800000,
            "failCount": 0,
            "latencyMs": 50
        }"#;
        let health: data::SourceHealth = serde_json::from_str(json).unwrap();
        assert_eq!(health.status, data::SourceHealthStatus::Healthy);
        let re_json = serde_json::to_string(&health).unwrap();
        assert!(re_json.contains("\"healthy\""));
    }

    #[test]
    fn anomaly_roundtrip() {
        let json = r#"{
            "id": "anom-001",
            "severity": "high",
            "source": "yahoo-finance",
            "timestamp": 1706800000,
            "description": "Volume spike detected",
            "metrics": {"volume": 5000000.0},
            "preScreenScore": 0.85,
            "sessionId": "cycle-001"
        }"#;
        let anomaly: anomaly::Anomaly = serde_json::from_str(json).unwrap();
        assert_eq!(anomaly.severity, anomaly::Severity::High);
        let re_json = serde_json::to_string(&anomaly).unwrap();
        let anomaly2: anomaly::Anomaly = serde_json::from_str(&re_json).unwrap();
        assert_eq!(anomaly.id, anomaly2.id);
    }

    #[test]
    fn anomaly_feedback_roundtrip() {
        let json = r#"{
            "anomalyId": "anom-001",
            "verdict": "confirmed",
            "timestamp": 1706800000
        }"#;
        let fb: anomaly::AnomalyFeedback = serde_json::from_str(json).unwrap();
        assert_eq!(fb.verdict, anomaly::FeedbackVerdict::Confirmed);
    }

    #[test]
    fn agent_status_roundtrip() {
        let json = r#"{
            "state": "running",
            "currentSessionId": "cycle-001",
            "totalCycles": 42,
            "totalAnomalies": 7,
            "uptime": 3600
        }"#;
        let status: agent::AgentStatus = serde_json::from_str(json).unwrap();
        assert_eq!(status.state, agent::AgentState::Running);
        assert_eq!(status.total_cycles, 42);
    }

    #[test]
    fn provider_health_roundtrip() {
        let json = r#"{
            "providerId": "anthropic",
            "status": "rate_limited",
            "latencyMs": 200,
            "lastError": "429 Too Many Requests"
        }"#;
        let health: provider::ProviderHealth = serde_json::from_str(json).unwrap();
        assert_eq!(health.status, provider::ProviderHealthStatus::RateLimited);
    }
}
```

**Step 3: Run tests — verify they FAIL**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL — type modules don't exist.

**Step 4: Implement `src-tauri/src/types/data.rs`**

```rust
use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataTick {
    pub source_id: String,
    pub timestamp: u64,
    pub symbol: Option<String>,
    pub metrics: HashMap<String, f64>,
    pub metadata: HashMap<String, serde_json::Value>,
    pub raw: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceHealthStatus {
    Healthy,
    Degraded,
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceHealth {
    pub source_id: String,
    pub status: SourceHealthStatus,
    pub last_success: u64,
    pub last_failure: Option<u64>,
    pub fail_count: u32,
    pub latency_ms: u64,
    pub message: Option<String>,
}
```

**Step 5: Implement `src-tauri/src/types/anomaly.rs`**

```rust
use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Anomaly {
    pub id: String,
    pub severity: Severity,
    pub source: String,
    pub symbol: Option<String>,
    pub timestamp: u64,
    pub description: String,
    pub metrics: HashMap<String, f64>,
    pub pre_screen_score: f64,
    pub session_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FeedbackVerdict {
    Confirmed,
    FalsePositive,
    NeedsReview,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnomalyFeedback {
    pub anomaly_id: String,
    pub verdict: FeedbackVerdict,
    pub note: Option<String>,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnomalyFilter {
    pub severity: Option<Vec<Severity>>,
    pub source: Option<String>,
    pub symbol: Option<String>,
    pub since: Option<u64>,
    pub limit: Option<u32>,
}
```

**Step 6: Implement `src-tauri/src/types/memory.rs`**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEntry {
    pub id: String,
    pub content: String,
    pub embedding: Vec<f32>,
    pub source: String,
    pub timestamp: u64,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub entry: MemoryEntry,
    pub score: f64,
    pub match_type: MatchType,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MatchType {
    Vector,
    Keyword,
    Hybrid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryEvent {
    #[serde(rename = "type")]
    pub event_type: MemoryEventType,
    pub entry_id: String,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryEventType {
    Created,
    Updated,
    Deleted,
}
```

**Step 7: Implement `src-tauri/src/types/agent.rs`**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentState {
    Idle,
    Running,
    Paused,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub state: AgentState,
    pub current_session_id: Option<String>,
    pub current_cycle_id: Option<String>,
    pub total_cycles: u64,
    pub total_anomalies: u64,
    pub uptime: u64,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentActivityType {
    CycleStart,
    CycleEnd,
    AnomalyDetected,
    MemoryFlush,
    Compaction,
    SubagentSpawn,
    FeedbackProcessed,
    RuleEvolved,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentActivity {
    #[serde(rename = "type")]
    pub activity_type: AgentActivityType,
    pub message: String,
    pub timestamp: u64,
    pub data: Option<std::collections::HashMap<String, serde_json::Value>>,
}
```

**Step 8: Implement `src-tauri/src/types/provider.rs`**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderHealthStatus {
    Healthy,
    Degraded,
    Offline,
    RateLimited,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHealth {
    pub provider_id: String,
    pub status: ProviderHealthStatus,
    pub latency_ms: u64,
    pub last_success: Option<u64>,
    pub last_error: Option<String>,
    pub cooldown_until: Option<u64>,
}
```

**Step 9: Implement `src-tauri/src/types/config.rs`**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderType {
    Anthropic,
    ClaudeMax,
    Openrouter,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    #[serde(rename = "type")]
    pub provider_type: ProviderType,
    pub api_key_env: Option<String>,
}
```

**Step 10: Wire up `mod types` in `src-tauri/src/lib.rs`**

Add this line near the top of `src-tauri/src/lib.rs`:

```rust
pub mod types;
```

**Step 11: Run tests — verify they PASS**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: ALL PASS. Trust the Rust compiler.

**Step 12: Commit**

```bash
git add src-tauri/
git commit -m "feat: add Rust mirror types with serde JSON round-trip tests"
```

---

## Task 6: IPC Contract Stubs in Rust

**Files:**
- Create: `src-tauri/src/commands/mod.rs`
- Create: `src-tauri/src/commands/agent.rs`
- Create: `src-tauri/src/commands/config.rs`
- Create: `src-tauri/src/commands/anomalies.rs`
- Create: `src-tauri/src/commands/memory.rs`
- Create: `src-tauri/src/commands/sources.rs`
- Modify: `src-tauri/src/lib.rs` (register commands)

**Step 1: Write the failing test — verify commands compile and return correct shapes**

Add to `src-tauri/src/commands/mod.rs`:

```rust
pub mod agent;
pub mod config;
pub mod anomalies;
pub mod memory;
pub mod sources;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_status_returns_valid_json() {
        let status = agent::agent_status();
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"state\""));
    }

    #[test]
    fn sources_health_returns_map() {
        let health = sources::sources_health();
        let json = serde_json::to_string(&health).unwrap();
        // Should be a valid JSON object (even if empty)
        assert!(json.starts_with('{'));
    }
}
```

**Step 2: Run tests — verify they FAIL**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: FAIL — command modules don't exist.

**Step 3: Implement command stubs**

`src-tauri/src/commands/agent.rs`:

```rust
use crate::types::agent::{AgentState, AgentStatus};

#[tauri::command]
pub fn agent_start() {
    // Stub: will be implemented by sidecar bridge
}

#[tauri::command]
pub fn agent_stop() {
    // Stub: will be implemented by sidecar bridge
}

#[tauri::command]
pub fn agent_status() -> AgentStatus {
    AgentStatus {
        state: AgentState::Idle,
        current_session_id: None,
        current_cycle_id: None,
        total_cycles: 0,
        total_anomalies: 0,
        uptime: 0,
        last_error: None,
    }
}
```

`src-tauri/src/commands/config.rs`:

```rust
#[tauri::command]
pub fn config_get() -> String {
    // Stub: returns empty config JSON
    "{}".to_string()
}

#[tauri::command]
pub fn config_update(patch: String) -> String {
    // Stub: echo back the patch
    patch
}
```

`src-tauri/src/commands/anomalies.rs`:

```rust
use crate::types::anomaly::{Anomaly, AnomalyFeedback};

#[tauri::command]
pub fn anomalies_list() -> Vec<Anomaly> {
    Vec::new()
}

#[tauri::command]
pub fn anomalies_feedback(id: String, feedback: AnomalyFeedback) {
    let _ = (id, feedback);
    // Stub: will persist to SQLite
}
```

`src-tauri/src/commands/memory.rs`:

```rust
use crate::types::memory::SearchResult;

#[tauri::command]
pub fn memory_search(query: String) -> Vec<SearchResult> {
    let _ = query;
    Vec::new()
}
```

`src-tauri/src/commands/sources.rs`:

```rust
use crate::types::data::SourceHealth;
use std::collections::HashMap;

#[tauri::command]
pub fn sources_health() -> HashMap<String, SourceHealth> {
    HashMap::new()
}
```

**Step 4: Register commands in `src-tauri/src/lib.rs`**

Add `pub mod commands;` and update the Tauri builder's `invoke_handler`:

```rust
pub mod commands;
pub mod types;

// In the run() function or wherever the Tauri builder is:
// .invoke_handler(tauri::generate_handler![
//     commands::agent::agent_start,
//     commands::agent::agent_stop,
//     commands::agent::agent_status,
//     commands::config::config_get,
//     commands::config::config_update,
//     commands::anomalies::anomalies_list,
//     commands::anomalies::anomalies_feedback,
//     commands::memory::memory_search,
//     commands::sources::sources_health,
// ])
```

**Step 5: Run tests — verify they PASS**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: ALL PASS.

**Step 6: Verify full build**

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: no errors.

**Step 7: Commit**

```bash
git add src-tauri/
git commit -m "feat: add IPC command stubs for all Tauri commands"
```

---

## Task 7: Agent Sidecar Scaffold

**Files:**
- Create: `agent/package.json`
- Create: `agent/tsconfig.json`
- Create: `agent/src/index.ts`
- Create: `agent/src/ipc/json-rpc.ts`
- Create: `agent/src/__tests__/index.test.ts`
- Create: `agent/src/__tests__/json-rpc.test.ts`

**Step 1: Create `agent/package.json`**

```json
{
  "name": "@finwatch/agent",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@finwatch/shared": "workspace:*"
  },
  "devDependencies": {
    "tsx": "^4.0.0"
  }
}
```

**Step 2: Create `agent/tsconfig.json`**

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "references": [{ "path": "../shared" }]
}
```

**Step 3: Write the failing tests**

Create `agent/src/__tests__/json-rpc.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseJsonRpcRequest, createJsonRpcResponse, createJsonRpcError } from "../ipc/json-rpc.js";

describe("JSON-RPC message parsing", () => {
  it("parses a valid request", () => {
    const raw = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "ping",
      params: {},
    });
    const req = parseJsonRpcRequest(raw);
    expect(req.method).toBe("ping");
    expect(req.id).toBe(1);
  });

  it("rejects invalid JSON", () => {
    expect(() => parseJsonRpcRequest("not json")).toThrow();
  });

  it("rejects missing method", () => {
    const raw = JSON.stringify({ jsonrpc: "2.0", id: 1 });
    expect(() => parseJsonRpcRequest(raw)).toThrow();
  });

  it("creates a valid response", () => {
    const resp = createJsonRpcResponse(1, { status: "ok" });
    expect(resp.jsonrpc).toBe("2.0");
    expect(resp.id).toBe(1);
    expect(resp.result).toEqual({ status: "ok" });
    expect(resp.error).toBeUndefined();
  });

  it("creates a valid error response", () => {
    const resp = createJsonRpcError(1, -32600, "Invalid Request");
    expect(resp.jsonrpc).toBe("2.0");
    expect(resp.id).toBe(1);
    expect(resp.error?.code).toBe(-32600);
    expect(resp.error?.message).toBe("Invalid Request");
    expect(resp.result).toBeUndefined();
  });
});
```

Create `agent/src/__tests__/index.test.ts`:

```typescript
import { describe, it, expect } from "vitest";

describe("agent entry", () => {
  it("exports a start function", async () => {
    const mod = await import("../index.js");
    expect(typeof mod.start).toBe("function");
  });
});
```

**Step 4: Run tests — verify they FAIL**

```bash
pnpm vitest run agent/
```

Expected: FAIL — modules don't exist.

**Step 5: Implement `agent/src/ipc/json-rpc.ts`**

```typescript
export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export function parseJsonRpcRequest(raw: string): JsonRpcRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("jsonrpc" in parsed) ||
    !("method" in parsed) ||
    !("id" in parsed)
  ) {
    throw new Error("Invalid JSON-RPC request: missing required fields");
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.method !== "string") {
    throw new Error("Invalid JSON-RPC request: method must be a string");
  }

  return {
    jsonrpc: "2.0",
    id: obj.id as number | string,
    method: obj.method as string,
    params: (obj.params as Record<string, unknown>) ?? {},
  };
}

export function createJsonRpcResponse(
  id: number | string,
  result: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function createJsonRpcError(
  id: number | string,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}
```

**Step 6: Implement `agent/src/index.ts`**

```typescript
import { parseJsonRpcRequest, createJsonRpcResponse, createJsonRpcError } from "./ipc/json-rpc.js";

const methods: Record<string, (params: Record<string, unknown>) => unknown> = {
  ping: () => ({ status: "ok", timestamp: Date.now() }),
};

function handleRequest(raw: string): string {
  try {
    const req = parseJsonRpcRequest(raw);
    const handler = methods[req.method];
    if (!handler) {
      return JSON.stringify(createJsonRpcError(req.id, -32601, `Method not found: ${req.method}`));
    }
    const result = handler(req.params ?? {});
    return JSON.stringify(createJsonRpcResponse(req.id, result));
  } catch (err) {
    return JSON.stringify(createJsonRpcError(0, -32700, "Parse error"));
  }
}

export function start(): void {
  process.stdin.setEncoding("utf-8");
  let buffer = "";

  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.trim()) {
        const response = handleRequest(line.trim());
        process.stdout.write(response + "\n");
      }
    }
  });
}

// Start when run directly
const isMain = process.argv[1]?.endsWith("index.ts") || process.argv[1]?.endsWith("index.js");
if (isMain) {
  start();
}
```

**Step 7: Install agent dependencies**

```bash
pnpm install
```

**Step 8: Run tests — verify they PASS**

```bash
pnpm vitest run agent/
```

Expected: ALL PASS.

**Step 9: Commit**

```bash
git add agent/
git commit -m "feat: scaffold agent sidecar with JSON-RPC stdio bridge"
```

---

## Task 8: Vitest Configuration + `test:all` Script

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (verify scripts)

**Step 1: Write the failing meta-test — verify vitest config loads**

This step is validated by running the test suite itself.

**Step 2: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "shared",
          root: "./shared",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: "agent",
          root: "./agent",
          include: ["src/**/*.test.ts"],
        },
      },
    ],
  },
});
```

**Step 3: Run all TypeScript tests**

```bash
pnpm vitest run
```

Expected: ALL PASS across both projects (shared + agent).

**Step 4: Run all Rust tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: ALL PASS.

**Step 5: Run the unified test:all script**

```bash
pnpm test:all
```

Expected: exits 0. Both vitest and cargo test pass.

**Step 6: Verify TypeScript compilation**

```bash
pnpm lint
```

Expected: `tsc --noEmit` exits 0.

**Step 7: Commit**

```bash
git add vitest.config.ts package.json
git commit -m "feat: add vitest workspace config and test:all script"
```

---

## Task 9: Final Verification Gate + Tag

**Step 1: Run full verification checklist**

```bash
pnpm test:all
```

Expected: exits 0.

```bash
cargo check --manifest-path src-tauri/Cargo.toml --all-targets
```

Expected: exits 0.

**Step 2: Verify shared types import from agent**

```bash
pnpm vitest run agent/
```

Expected: agent tests import from `@finwatch/shared` successfully.

**Step 3: Verify Tauri dev window opens**

```bash
pnpm tauri dev
```

Expected: window opens. Close it.

**Step 4: Tag the foundation**

```bash
git tag v0.0.1-foundation
```

**Step 5: Final commit (if any uncommitted changes)**

```bash
git status
# If clean: done. If not: add and commit.
```

---

## Phase 0 Complete

After all 9 tasks pass, Phase 0 is done. The orchestrator can now create worktrees and dispatch Phase 1 agents:

```bash
git worktree add ../finwatch-rust-backend feat/rust-backend
git worktree add ../finwatch-node-agent feat/node-agent
```

Each Phase 1 agent starts with the full foundation: shared types, Tauri scaffold, agent scaffold, and a green test suite.
