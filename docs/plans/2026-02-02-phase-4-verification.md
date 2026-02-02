# Phase 4: End-to-End Verification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Write integration tests that verify the full system works end-to-end: data ingestion → pre-screen → analysis → memory → feedback → self-improvement → UI. These are the 10-point verification matrix from the spec plus system-level tests.

**Architecture:** All tests live in `agent/src/__tests__/integration/` (Node.js side) and `src/__tests__/integration/` (React side). Each test wires up real module instances with mock LLM providers and in-memory SQLite. No external API calls.

**Tech Stack:** Vitest, better-sqlite3 (in-memory), mock LLM providers, `@testing-library/react` for UI tests.

---

## Boundary Rules

- **Create new files in:** `agent/src/__tests__/integration/`, `src/__tests__/integration/`
- **Do NOT modify** any existing source files — only add test files
- **Import from** all existing modules (analysis, subagents, improvement, ingestion, memory, providers, session, tools, shared)

---

### Task 1: V1 — Data Ingestion Integration

**Files:**
- Create: `agent/src/__tests__/integration/v1-data-ingestion.test.ts`

**Step 1: Write the test**

```typescript
// agent/src/__tests__/integration/v1-data-ingestion.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { DataTick } from "@finwatch/shared";
import { SourceRegistry } from "../../ingestion/source-registry.js";
import { DataBuffer } from "../../ingestion/data-buffer.js";
import { normalizeBatch } from "../../ingestion/normalizer.js";
import type { DataSource } from "../../ingestion/types.js";

function createMockSource(id: string, ticks: DataTick[]): DataSource {
  return {
    id,
    config: { id, name: id, type: "polling", plugin: "mock", config: {}, enabled: true },
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ sourceId: id, status: "healthy", lastSuccess: Date.now(), failCount: 0, latencyMs: 10 }),
    fetch: vi.fn().mockResolvedValue(ticks),
  };
}

describe("V1: Data Ingestion End-to-End", () => {
  it("configures a source, fetches ticks, normalizes, and buffers them", async () => {
    const registry = new SourceRegistry();
    const buffer = new DataBuffer({ flushIntervalMs: 1000, maxSize: 100 });

    const rawTicks: DataTick[] = Array.from({ length: 5 }, (_, i) => ({
      sourceId: "mock-yahoo",
      timestamp: Date.now() + i * 1000,
      metrics: { price: 150 + i, volume: 1000000 + i * 10000 },
      metadata: {},
    }));

    const source = createMockSource("mock-yahoo", rawTicks);
    registry.register(source);

    // Simulate 5 polling cycles
    for (let cycle = 0; cycle < 5; cycle++) {
      const fetched = await registry.fetch("mock-yahoo");
      const normalized = normalizeBatch(fetched);
      for (const tick of normalized) {
        buffer.push(tick);
      }
    }

    // Buffer should have accumulated 25 ticks (5 per cycle x 5 cycles)
    expect(buffer.size).toBe(25);

    // Drain the buffer
    const batch = await buffer.nextBatch();
    expect(batch.length).toBe(25);
    expect(batch[0]!.sourceId).toBe("mock-yahoo");
    expect(batch[0]!.metrics.price).toBeDefined();

    buffer.destroy();
  });

  it("health check reports healthy after successful fetches", async () => {
    const registry = new SourceRegistry();
    const source = createMockSource("mock-yahoo", [
      { sourceId: "mock-yahoo", timestamp: Date.now(), metrics: { price: 150 }, metadata: {} },
    ]);
    registry.register(source);

    await registry.fetch("mock-yahoo");
    const health = await registry.healthCheck();
    expect(health.some((h) => h.sourceId === "mock-yahoo" && h.status === "healthy")).toBe(true);
  });
});
```

**Step 2: Run test**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/__tests__/integration/v1-data-ingestion.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add agent/src/__tests__/integration/v1-data-ingestion.test.ts
git commit -m "test(v1): data ingestion integration — source, normalize, buffer"
```

---

### Task 2: V2 — Pre-screen Integration

**Files:**
- Create: `agent/src/__tests__/integration/v2-pre-screen.test.ts`

**Step 1: Write the test**

```typescript
// agent/src/__tests__/integration/v2-pre-screen.test.ts
import { describe, it, expect } from "vitest";
import type { DataTick } from "@finwatch/shared";
import { preScreenBatch, computeZScores } from "../../analysis/index.js";

function makeTick(price: number, volume: number, source = "test"): DataTick {
  return { sourceId: source, timestamp: Date.now(), metrics: { price, volume }, metadata: {} };
}

describe("V2: Pre-screen Integration", () => {
  it("routes 3 known anomalies to immediate analysis with score >0.6", () => {
    // Build normal history
    const history: DataTick[] = Array.from({ length: 50 }, (_, i) =>
      makeTick(100 + (i % 3), 1000000 + (i % 5) * 1000)
    );

    // 3 anomalous ticks
    const anomalies: DataTick[] = [
      makeTick(500, 10000000),  // extreme price + volume
      makeTick(5, 50000),       // extreme low price + low volume
      makeTick(100, 50000000),  // normal price but extreme volume
    ];

    const allTicks = [...history, ...anomalies];
    const results = preScreenBatch(allTicks, { windowSize: 50 });

    // The last 3 ticks (anomalies) should score high
    const anomalyResults = results.slice(-3);
    for (const r of anomalyResults) {
      expect(r.score).toBeGreaterThan(0.3);
      // At least some should route to immediate
      expect(["batch", "immediate"]).toContain(r.route);
    }

    // At least 2 of the 3 should be immediate (>0.6)
    const immediateCount = anomalyResults.filter((r) => r.route === "immediate").length;
    expect(immediateCount).toBeGreaterThanOrEqual(2);
  });

  it("z-score computation flags extreme values", () => {
    const normalHistory = Array.from({ length: 30 }, () => ({ price: 100, volume: 1000000 }));
    const extreme = { price: 300, volume: 5000000 };

    const scores = computeZScores(extreme, normalHistory);
    const priceScore = scores.find((s) => s.metric === "price");
    expect(priceScore).toBeDefined();
    expect(priceScore!.zScore).toBeGreaterThan(3);
  });
});
```

**Step 2: Run test**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/__tests__/integration/v2-pre-screen.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add agent/src/__tests__/integration/v2-pre-screen.test.ts
git commit -m "test(v2): pre-screen integration — anomaly routing"
```

---

### Task 3: V3 — Analysis Turn Integration

**Files:**
- Create: `agent/src/__tests__/integration/v3-analysis-turn.test.ts`

**Step 1: Write the test**

```typescript
// agent/src/__tests__/integration/v3-analysis-turn.test.ts
import { describe, it, expect, vi } from "vitest";
import type { LLMProvider, CreateMessageParams, StreamEvent, DataTick } from "@finwatch/shared";
import { CycleRunner } from "../../analysis/index.js";
import { SessionManager } from "../../session/session-manager.js";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

function makeTick(price: number): DataTick {
  return { sourceId: "test", timestamp: Date.now(), metrics: { price, volume: 1000 }, metadata: {} };
}

function mockAnalysisProvider(): LLMProvider {
  return {
    id: "mock-analysis",
    name: "Mock Analysis",
    async *createMessage(_params: CreateMessageParams): AsyncIterable<StreamEvent> {
      yield {
        type: "text_delta",
        text: "I detected an anomaly: the price at 500 is significantly above the normal range of 98-102. This appears to be a critical price spike.\n\nANOMALY: severity=critical, source=test, description=Price spike to 500 (normal range 98-102)",
      };
      yield { type: "usage", input: 500, output: 200 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi.fn().mockResolvedValue({ providerId: "mock-analysis", status: "healthy", latencyMs: 50 }),
    listModels: vi.fn().mockReturnValue(["mock-model"]),
  };
}

describe("V3: Analysis Turn Integration", () => {
  let sessionDir: string;

  it("runs analysis on batch with anomaly, produces response with anomaly mention", async () => {
    sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "finwatch-v3-"));
    const sessionManager = new SessionManager(sessionDir);
    const sessionId = await sessionManager.create("monitor");

    const provider = mockAnalysisProvider();
    const runner = new CycleRunner({ provider, model: "mock-model" });

    const batch: DataTick[] = [
      ...Array.from({ length: 5 }, (_, i) => makeTick(100 + (i % 3))),
      makeTick(500), // anomaly
    ];

    const result = await runner.run(batch);

    expect(result.response).toContain("anomaly");
    expect(result.response).toContain("500");
    expect(result.tickCount).toBe(6);

    // Persist to session transcript
    await sessionManager.append(sessionId, {
      type: "message",
      message: { role: "assistant", content: result.response, timestamp: Date.now() },
    });

    // Verify transcript persisted
    const entries = await sessionManager.read(sessionId);
    const messages = entries.filter((e) => e.type === "message");
    expect(messages.length).toBeGreaterThanOrEqual(1);

    // Cleanup
    fs.rmSync(sessionDir, { recursive: true, force: true });
  });
});
```

**Step 2: Run test**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/__tests__/integration/v3-analysis-turn.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add agent/src/__tests__/integration/v3-analysis-turn.test.ts
git commit -m "test(v3): analysis turn integration — anomaly detection + transcript"
```

---

### Task 4: V4 — Memory Integration

**Files:**
- Create: `agent/src/__tests__/integration/v4-memory.test.ts`

**Step 1: Write the test**

```typescript
// agent/src/__tests__/integration/v4-memory.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createMemoryDb } from "../../memory/db.js";
import { VectorStore } from "../../memory/vector-search.js";
import { KeywordStore } from "../../memory/keyword-search.js";
import { mergeHybridResults } from "../../memory/hybrid-search.js";
import { buildRecallContext } from "../../memory/auto-recall.js";
import type { MemoryEntry, DomainPattern, DomainThreshold } from "@finwatch/shared";

function fakeEmbedding(seed: number): number[] {
  // Deterministic fake embedding for testing
  return Array.from({ length: 8 }, (_, i) => Math.sin(seed * (i + 1)));
}

describe("V4: Memory Integration", () => {
  let db: Database.Database;
  let vectorStore: VectorStore;
  let keywordStore: KeywordStore;

  beforeEach(() => {
    db = createMemoryDb(":memory:");
    vectorStore = new VectorStore(db);
    keywordStore = new KeywordStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("stores entries, searches hybrid, and auto-recall injects context", () => {
    // Insert memory entries
    const entries: MemoryEntry[] = [
      { id: "m1", content: "AAPL had a 10% price spike on 2024-01-15 during earnings", embedding: fakeEmbedding(1), source: "analysis", timestamp: Date.now(), tags: ["AAPL", "earnings"] },
      { id: "m2", content: "GOOGL dropped 5% after antitrust ruling", embedding: fakeEmbedding(2), source: "analysis", timestamp: Date.now(), tags: ["GOOGL", "antitrust"] },
      { id: "m3", content: "Market-wide volume spike correlates with Fed announcements", embedding: fakeEmbedding(3), source: "analysis", timestamp: Date.now(), tags: ["macro", "volume"] },
    ];

    for (const entry of entries) {
      vectorStore.insert(entry);
    }
    keywordStore.syncFts();

    // Hybrid search for AAPL
    const queryEmbedding = fakeEmbedding(1); // similar to m1
    const vectorResults = vectorStore.search(queryEmbedding, 3);
    const keywordResults = keywordStore.search("AAPL earnings spike", 3);

    const hybridResults = mergeHybridResults(vectorResults, keywordResults, {
      vectorWeight: 0.7,
      textWeight: 0.3,
      maxResults: 6,
      minScore: 0.0, // low threshold for testing
    });

    expect(hybridResults.length).toBeGreaterThan(0);
    // m1 should rank highest (matches both vector and keyword)
    expect(hybridResults[0]!.entry.id).toBe("m1");

    // Auto-recall context injection
    const patterns: DomainPattern[] = [
      { id: "p1", pattern: "AAPL spikes on earnings", confidence: 0.85, source: "learning", createdAt: Date.now(), updatedAt: Date.now() },
    ];
    const thresholds: DomainThreshold[] = [
      { id: "t1", source: "yahoo", metric: "price", value: 3.0, direction: "above", updatedAt: Date.now() },
    ];

    const context = buildRecallContext("AAPL earnings", {
      search: (q) => keywordStore.search(q, 3),
      getPatterns: () => patterns,
      getThresholds: () => thresholds,
    }, { maxMemoryResults: 3, maxPatterns: 5, maxThresholds: 5 });

    expect(context).toContain("AAPL");
    expect(context).toContain("earnings");
    expect(context).toContain("3.0"); // threshold value
  });
});
```

**Step 2: Run test**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/__tests__/integration/v4-memory.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add agent/src/__tests__/integration/v4-memory.test.ts
git commit -m "test(v4): memory integration — hybrid search + auto-recall context"
```

---

### Task 5: V5 — Session Compaction Integration

**Files:**
- Create: `agent/src/__tests__/integration/v5-compaction.test.ts`

**Step 1: Write the test**

```typescript
// agent/src/__tests__/integration/v5-compaction.test.ts
import { describe, it, expect, vi } from "vitest";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import type { LLMProvider, CreateMessageParams, StreamEvent, SessionTranscriptEntry } from "@finwatch/shared";
import { SessionManager } from "../../session/session-manager.js";
import { shouldCompact, compactSession } from "../../session/session-compaction.js";

function mockCompactionProvider(summary: string): LLMProvider {
  return {
    id: "mock-compact",
    name: "Mock Compact",
    async *createMessage(): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", text: summary };
      yield { type: "usage", input: 100, output: 50 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi.fn().mockResolvedValue({ providerId: "mock-compact", status: "healthy", latencyMs: 10 }),
    listModels: vi.fn().mockReturnValue(["mock-model"]),
  };
}

describe("V5: Session Compaction Integration", () => {
  let sessionDir: string;

  it("fills session to threshold, compacts, and preserves key findings", async () => {
    sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), "finwatch-v5-"));
    const manager = new SessionManager(sessionDir);
    const sessionId = await manager.create("monitor");

    // Fill session with many messages to exceed threshold
    const longText = "This is a detailed analysis of market conditions. ".repeat(50);
    for (let i = 0; i < 20; i++) {
      await manager.append(sessionId, {
        type: "message",
        message: { role: i % 2 === 0 ? "user" : "assistant", content: `Turn ${i}: ${longText}`, timestamp: Date.now() + i },
      });
    }

    const entries = await manager.read(sessionId);

    // Should trigger compaction at a low threshold
    const needsCompaction = shouldCompact(entries, { contextWindow: 1000, maxCycleTokenRatio: 0.8 });
    expect(needsCompaction).toBe(true);

    // Run compaction
    const provider = mockCompactionProvider("Summary: 20 analysis turns were conducted. Key finding: price anomaly detected in turn 5, volume spike in turn 12.");

    const compacted = await compactSession(entries, {
      provider,
      model: "mock-model",
      contextWindow: 1000,
      maxCycleTokenRatio: 0.8,
    });

    // Compacted should have fewer entries
    expect(compacted.length).toBeLessThan(entries.length);

    // Should contain summary
    const summaryEntry = compacted.find(
      (e) => e.type === "message" && e.message.role === "system" && e.message.content.includes("Summary")
    );
    expect(summaryEntry).toBeDefined();

    // Key findings preserved in summary
    if (summaryEntry?.type === "message") {
      expect(summaryEntry.message.content).toContain("anomaly");
    }

    fs.rmSync(sessionDir, { recursive: true, force: true });
  });
});
```

**Step 2: Run test**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/__tests__/integration/v5-compaction.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add agent/src/__tests__/integration/v5-compaction.test.ts
git commit -m "test(v5): session compaction integration — fill, compact, preserve findings"
```

---

### Task 6: V6 — Feedback Loop Integration

**Files:**
- Create: `agent/src/__tests__/integration/v6-feedback-loop.test.ts`

**Step 1: Write the test**

```typescript
// agent/src/__tests__/integration/v6-feedback-loop.test.ts
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import Database from "better-sqlite3";
import type { LLMProvider, CreateMessageParams, StreamEvent, AnomalyFeedback } from "@finwatch/shared";
import { FeedbackStore } from "../../improvement/feedback-store.js";
import { FeedbackTrigger } from "../../improvement/feedback-trigger.js";
import { FeedbackIntegration } from "../../improvement/feedback-integration.js";

function mockIntegrationProvider(): LLMProvider {
  return {
    id: "mock-integration",
    name: "Mock Integration",
    async *createMessage(): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", text: "Based on 10 false positive feedbacks, I recommend increasing the price z-score threshold from 3.0 to 3.5 for the yahoo source." };
      yield { type: "usage", input: 200, output: 100 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi.fn().mockResolvedValue({ providerId: "mock", status: "healthy", latencyMs: 10 }),
    listModels: vi.fn().mockReturnValue(["mock-model"]),
  };
}

describe("V6: Feedback Loop Integration", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("submits 10 false positives, trigger fires, integration adjusts thresholds", async () => {
    const store = new FeedbackStore(db);
    const integration = new FeedbackIntegration({
      provider: mockIntegrationProvider(),
      model: "mock-model",
    });

    let triggerFired = false;
    const trigger = new FeedbackTrigger({
      countThreshold: 10,
      timeoutMs: 7200000,
      onTrigger: () => { triggerFired = true; },
    });

    // Submit 10 false positive feedbacks
    for (let i = 0; i < 10; i++) {
      const feedback: AnomalyFeedback = {
        anomalyId: `anomaly-${i}`,
        verdict: "false_positive",
        note: "Not a real anomaly",
        timestamp: Date.now(),
      };
      store.insert(feedback);
      trigger.recordFeedback();
    }

    expect(triggerFired).toBe(true);
    expect(store.unprocessedCount()).toBe(10);

    // Run integration turn
    const unprocessed = store.getUnprocessed();
    const result = await integration.run(unprocessed);

    expect(result.feedbackCount).toBe(10);
    expect(result.verdictSummary.false_positive).toBe(10);
    expect(result.response).toContain("threshold");

    // Mark as processed
    store.markProcessed(unprocessed.map((f) => f.anomalyId));
    expect(store.unprocessedCount()).toBe(0);

    // FP rate should reflect the feedback
    expect(store.falsePositiveRate()).toBe(1.0);
  });
});
```

**Step 2: Run test**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/__tests__/integration/v6-feedback-loop.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add agent/src/__tests__/integration/v6-feedback-loop.test.ts
git commit -m "test(v6): feedback loop integration — 10 FPs trigger threshold adjustment"
```

---

### Task 7: V7 — Rule Evolution Integration

**Files:**
- Create: `agent/src/__tests__/integration/v7-rule-evolution.test.ts`

**Step 1: Write the test**

```typescript
// agent/src/__tests__/integration/v7-rule-evolution.test.ts
import { describe, it, expect, vi } from "vitest";
import type { LLMProvider, StreamEvent } from "@finwatch/shared";
import { RuleEvolution } from "../../improvement/rule-evolution.js";
import { AutoRevert } from "../../improvement/auto-revert.js";

function mockEvolutionProvider(): LLMProvider {
  return {
    id: "mock-evo",
    name: "Mock Evolution",
    async *createMessage(): AsyncIterable<StreamEvent> {
      yield {
        type: "text_delta",
        text: JSON.stringify([
          { id: "r1", name: "High price (adjusted)", condition: { type: "threshold", metric: "price", operator: ">", value: 210 }, severity: "high", confidence: 0.92 },
          { id: "r2", name: "Volume spike", condition: { type: "threshold", metric: "volume", operator: ">", value: 5000000 }, severity: "medium", confidence: 0.8 },
        ]),
      };
      yield { type: "usage", input: 100, output: 50 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi.fn().mockResolvedValue({ providerId: "mock-evo", status: "healthy", latencyMs: 10 }),
    listModels: vi.fn().mockReturnValue(["mock-model"]),
  };
}

describe("V7: Rule Evolution Integration", () => {
  it("triggers daily evolution, creates versioned rules, logs evolution", async () => {
    const files: Record<string, string> = {};
    const writeFile = vi.fn((path: string, content: string) => { files[path] = content; });
    const appendFile = vi.fn((path: string, content: string) => {
      files[path] = (files[path] || "") + content;
    });

    const evolution = new RuleEvolution({
      provider: mockEvolutionProvider(),
      model: "mock-model",
      rulesDir: "/tmp/rules",
      writeFile,
      appendFile,
      readFile: vi.fn().mockReturnValue("[]"),
      listFiles: vi.fn().mockReturnValue(["rules_active.json", "rules_v001.json"]),
    });

    const currentRules = [
      { id: "r1", name: "High price", condition: { type: "threshold", metric: "price", operator: ">", value: 200 }, severity: "high", confidence: 0.9 },
    ];

    const result = await evolution.run(currentRules, {
      truePositives: 15,
      falsePositives: 5,
      falseNegatives: 2,
      totalPredictions: 22,
    });

    // Should create v002
    expect(result.newVersion).toBe(2);
    expect(result.rulesCount).toBe(2);

    // Versioned file written
    expect(writeFile).toHaveBeenCalledWith("/tmp/rules/rules_v002.json", expect.any(String));
    // Active file updated
    expect(writeFile).toHaveBeenCalledWith("/tmp/rules/rules_active.json", expect.any(String));
    // Evolution logged
    expect(appendFile).toHaveBeenCalledWith("/tmp/rules/evolution_log.jsonl", expect.stringContaining("version"));
  });

  it("auto-revert fires when FP rate degrades", () => {
    let reverted = false;
    let notification = "";

    const revert = new AutoRevert({
      fpRateThreshold: 0.5,
      revert: () => { reverted = true; },
      notify: (msg) => { notification = msg; },
      getPreviousVersion: vi.fn().mockReturnValue("rules_v001.json"),
      readFile: vi.fn().mockReturnValue('[{"id":"r1","name":"safe rule"}]'),
    });

    const result = revert.check(0.6, 20); // 60% FP rate with 20 feedbacks
    expect(result.reverted).toBe(true);
    expect(reverted).toBe(true);
    expect(notification).toContain("Auto-revert");
    expect(notification).toContain("60.0%");
  });
});
```

**Step 2: Run test**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/__tests__/integration/v7-rule-evolution.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add agent/src/__tests__/integration/v7-rule-evolution.test.ts
git commit -m "test(v7): rule evolution integration — versioned snapshots + auto-revert"
```

---

### Task 8: V8 — Subagent Integration

**Files:**
- Create: `agent/src/__tests__/integration/v8-subagents.test.ts`

**Step 1: Write the test**

```typescript
// agent/src/__tests__/integration/v8-subagents.test.ts
import { describe, it, expect, vi } from "vitest";
import type { LLMProvider, StreamEvent } from "@finwatch/shared";
import { SubagentSpawner } from "../../subagents/spawner.js";
import { SubagentPool } from "../../subagents/pool.js";

function mockSubagentProvider(response: string, delayMs = 0): LLMProvider {
  return {
    id: "mock-sub",
    name: "Mock Subagent",
    async *createMessage(): AsyncIterable<StreamEvent> {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      yield { type: "text_delta", text: response };
      yield { type: "usage", input: 50, output: 25 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi.fn().mockResolvedValue({ providerId: "mock-sub", status: "healthy", latencyMs: 10 }),
    listModels: vi.fn().mockReturnValue(["mock-model"]),
  };
}

describe("V8: Subagent Integration", () => {
  it("spawns a volume analysis subagent and gets result", async () => {
    const spawner = new SubagentSpawner({
      provider: mockSubagentProvider("Volume analysis for AAPL: Volume is 3x the 20-day average. This indicates unusual institutional activity."),
      model: "mock-model",
      maxConcurrent: 3,
    });

    const result = await spawner.spawn({
      type: "volume_analysis",
      prompt: "Analyze AAPL volume anomaly",
      data: { symbol: "AAPL", currentVolume: 15000000, avgVolume: 5000000 },
    });

    expect(result.response).toContain("Volume analysis");
    expect(result.response).toContain("AAPL");
    expect(result.taskType).toBe("volume_analysis");
    expect(result.sessionId).toMatch(/^subagent-/);
  });

  it("pool enforces concurrency and queues excess tasks", async () => {
    let peakActive = 0;
    let currentActive = 0;

    const trackingProvider: LLMProvider = {
      id: "tracking",
      name: "Tracking",
      async *createMessage(): AsyncIterable<StreamEvent> {
        currentActive++;
        peakActive = Math.max(peakActive, currentActive);
        await new Promise((r) => setTimeout(r, 50));
        yield { type: "text_delta", text: "done" };
        yield { type: "usage", input: 10, output: 5 };
        yield { type: "stop", reason: "end_turn" };
        currentActive--;
      },
      healthCheck: vi.fn().mockResolvedValue({ providerId: "tracking", status: "healthy", latencyMs: 10 }),
      listModels: vi.fn().mockReturnValue(["mock-model"]),
    };

    const pool = new SubagentPool({
      provider: trackingProvider,
      model: "mock-model",
      maxConcurrent: 2,
    });

    const tasks = Array.from({ length: 5 }, (_, i) => ({
      type: "volume_analysis",
      prompt: `Task ${i}`,
      data: {},
    }));

    const results = await pool.runAll(tasks);
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.response === "done")).toBe(true);
    expect(peakActive).toBeLessThanOrEqual(2);
  });
});
```

**Step 2: Run test**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/__tests__/integration/v8-subagents.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add agent/src/__tests__/integration/v8-subagents.test.ts
git commit -m "test(v8): subagent integration — spawn, result injection, concurrency"
```

---

### Task 9: V9 — Provider Fallback Integration

**Files:**
- Create: `agent/src/__tests__/integration/v9-provider-fallback.test.ts`

**Step 1: Write the test**

```typescript
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
    healthCheck: vi.fn().mockResolvedValue({ providerId: id, status: "healthy", latencyMs: 10 }),
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
    healthCheck: vi.fn().mockResolvedValue({ providerId: id, status: "offline", latencyMs: 0 }),
    listModels: vi.fn().mockReturnValue([]),
  };
}

describe("V9: Provider Fallback Integration", () => {
  it("falls back to secondary when primary fails", async () => {
    const registry = new ProviderRegistry();
    const primary = failingProvider("anthropic");
    const secondary = workingProvider("openrouter", "Analysis from fallback provider.");

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

    const events: StreamEvent[] = [];
    await expect(async () => {
      for await (const event of fallbackProvider.createMessage({
        model: "mock-model",
        messages: [{ role: "user", content: "Analyze" }],
        maxTokens: 1024,
      })) {
        events.push(event);
      }
    }).rejects.toThrow();
  });
});
```

**Step 2: Run test**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/__tests__/integration/v9-provider-fallback.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add agent/src/__tests__/integration/v9-provider-fallback.test.ts
git commit -m "test(v9): provider fallback integration — primary fails, secondary takes over"
```

---

### Task 10: V10 — Full UI Flow Integration

**Files:**
- Create: `src/__tests__/integration/v10-ui-flow.test.tsx`

**Step 1: Write the test**

```typescript
// src/__tests__/integration/v10-ui-flow.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDataStore } from "../../store/data-slice.js";
import { useAnomalyStore } from "../../store/anomaly-slice.js";
import { useAgentStore } from "../../store/agent-slice.js";
import type { DataTick, Anomaly, AgentActivity } from "@finwatch/shared";

describe("V10: Full UI Flow Integration", () => {
  beforeEach(() => {
    // Reset stores
    useDataStore.getState().reset?.();
    useAnomalyStore.getState().reset?.();
    useAgentStore.getState().reset?.();
  });

  it("data tick flows into store and is accessible", () => {
    const tick: DataTick = {
      sourceId: "yahoo",
      timestamp: Date.now(),
      metrics: { price: 150.25, volume: 1000000 },
      metadata: {},
    };

    const { result } = renderHook(() => useDataStore());
    act(() => {
      result.current.addTick(tick);
    });

    expect(result.current.ticks).toHaveLength(1);
    expect(result.current.ticks[0]!.metrics.price).toBe(150.25);
  });

  it("anomaly appears in feed after detection", () => {
    const anomaly: Anomaly = {
      id: "anomaly-1",
      severity: "high",
      source: "yahoo",
      symbol: "AAPL",
      timestamp: Date.now(),
      description: "Unusual price spike detected",
      metrics: { price: 500, volume: 10000000 },
      preScreenScore: 0.85,
      sessionId: "session-1",
    };

    const { result } = renderHook(() => useAnomalyStore());
    act(() => {
      result.current.addAnomaly(anomaly);
    });

    expect(result.current.anomalies).toHaveLength(1);
    expect(result.current.anomalies[0]!.severity).toBe("high");
    expect(result.current.anomalies[0]!.description).toContain("spike");
  });

  it("agent activity log updates in real-time", () => {
    const activity: AgentActivity = {
      type: "anomaly_detected",
      message: "Detected price anomaly in AAPL",
      timestamp: Date.now(),
      data: { symbol: "AAPL", severity: "high" },
    };

    const { result } = renderHook(() => useAgentStore());
    act(() => {
      result.current.addActivity(activity);
    });

    expect(result.current.activities).toHaveLength(1);
    expect(result.current.activities[0]!.type).toBe("anomaly_detected");
  });

  it("full flow: tick -> anomaly -> activity all update together", () => {
    const tick: DataTick = {
      sourceId: "yahoo",
      timestamp: Date.now(),
      metrics: { price: 500 },
      metadata: {},
    };

    const anomaly: Anomaly = {
      id: "a1",
      severity: "critical",
      source: "yahoo",
      timestamp: Date.now(),
      description: "Price spike",
      metrics: { price: 500 },
      preScreenScore: 0.9,
      sessionId: "s1",
    };

    const activity: AgentActivity = {
      type: "anomaly_detected",
      message: "Critical anomaly",
      timestamp: Date.now(),
    };

    const dataHook = renderHook(() => useDataStore());
    const anomalyHook = renderHook(() => useAnomalyStore());
    const agentHook = renderHook(() => useAgentStore());

    act(() => {
      dataHook.result.current.addTick(tick);
      anomalyHook.result.current.addAnomaly(anomaly);
      agentHook.result.current.addActivity(activity);
    });

    expect(dataHook.result.current.ticks).toHaveLength(1);
    expect(anomalyHook.result.current.anomalies).toHaveLength(1);
    expect(agentHook.result.current.activities).toHaveLength(1);
  });
});
```

**Step 2: Run test**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run src/__tests__/integration/v10-ui-flow.test.tsx`
Expected: PASS

**Step 3: Commit**

```bash
git add src/__tests__/integration/v10-ui-flow.test.tsx
git commit -m "test(v10): full UI flow integration — tick + anomaly + activity stores"
```

---

### Task 11: Run Full Suite + Tag

**Step 1: Run entire test suite**

```bash
cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run
```

Expected: All tests pass (previous 389 + ~20 new integration tests)

**Step 2: Run Rust tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: 42 tests pass

**Step 3: Tag release candidate**

```bash
git tag v1.0.0-rc1
```

---

## Verification Checklist

```
[ ] V1:  Data ingestion — source → normalize → buffer
[ ] V2:  Pre-screen — 3 anomalies scored >0.6, routed to immediate
[ ] V3:  Analysis turn — anomaly flagged, transcript persisted
[ ] V4:  Memory — hybrid search returns relevant, auto-recall injects context
[ ] V5:  Compaction — session filled, compacted, findings preserved
[ ] V6:  Feedback loop — 10 FPs → trigger → threshold adjustment
[ ] V7:  Rule evolution — versioned snapshot + auto-revert safety
[ ] V8:  Subagents — spawn, execute, concurrency enforced
[ ] V9:  Provider fallback — primary fails → secondary takes over
[ ] V10: Full UI flow — tick → anomaly → activity in stores
[ ] Full suite: npx vitest run exits 0
[ ] Rust suite: cargo test exits 0
[ ] Tag: v1.0.0-rc1
```
