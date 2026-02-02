# Phase 3B: Self-Improvement System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the self-improvement loop: feedback learning, knowledge accumulation, weekly consolidation, daily rule evolution, and auto-revert safety.

**Architecture:** User feedback flows into `feedback_log` table → batch trigger fires after 10 feedbacks or 2 hours → LLM integration turn adjusts thresholds/rules/confidence. Knowledge accumulates after each analysis turn. Weekly consolidation merges/deduplicates/prunes. Daily evolution produces versioned rule snapshots. Auto-revert fires when FP rate exceeds 50%.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, `@finwatch/shared` types, existing memory/providers modules.

---

## Boundary Rules

- **ONLY modify files in:** `agent/src/improvement/`
- **Read-only imports from:** `@finwatch/shared`, `agent/src/memory/`, `agent/src/providers/`, `agent/src/session/`
- **Do NOT modify** any other directories

---

### Task 1: Feedback Store (SQLite table)

**Files:**
- Create: `agent/src/improvement/__tests__/feedback-store.test.ts`
- Create: `agent/src/improvement/feedback-store.ts`

**Step 1: Write the failing test**

```typescript
// agent/src/improvement/__tests__/feedback-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { AnomalyFeedback } from "@finwatch/shared";
import { FeedbackStore } from "../feedback-store.js";

let db: Database.Database;
let store: FeedbackStore;

beforeEach(() => {
  db = new Database(":memory:");
  store = new FeedbackStore(db);
});

afterEach(() => {
  db.close();
});

function makeFeedback(anomalyId: string, verdict: "confirmed" | "false_positive" | "needs_review" = "confirmed"): AnomalyFeedback {
  return { anomalyId, verdict, timestamp: Date.now() };
}

describe("FeedbackStore", () => {
  it("inserts and retrieves feedback", () => {
    store.insert(makeFeedback("a1", "confirmed"));
    store.insert(makeFeedback("a2", "false_positive"));

    const all = store.getAll();
    expect(all).toHaveLength(2);
  });

  it("queries unprocessed feedback", () => {
    store.insert(makeFeedback("a1"));
    store.insert(makeFeedback("a2"));
    store.insert(makeFeedback("a3"));

    const unprocessed = store.getUnprocessed();
    expect(unprocessed).toHaveLength(3);

    store.markProcessed(["a1", "a2"]);

    const remaining = store.getUnprocessed();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.anomalyId).toBe("a3");
  });

  it("counts unprocessed feedback", () => {
    store.insert(makeFeedback("a1"));
    store.insert(makeFeedback("a2"));
    expect(store.unprocessedCount()).toBe(2);

    store.markProcessed(["a1"]);
    expect(store.unprocessedCount()).toBe(1);
  });

  it("queries feedback by verdict", () => {
    store.insert(makeFeedback("a1", "confirmed"));
    store.insert(makeFeedback("a2", "false_positive"));
    store.insert(makeFeedback("a3", "false_positive"));

    const fps = store.getByVerdict("false_positive");
    expect(fps).toHaveLength(2);
  });

  it("computes false positive rate", () => {
    store.insert(makeFeedback("a1", "confirmed"));
    store.insert(makeFeedback("a2", "confirmed"));
    store.insert(makeFeedback("a3", "false_positive"));
    store.insert(makeFeedback("a4", "false_positive"));

    expect(store.falsePositiveRate()).toBeCloseTo(0.5);
  });

  it("returns 0 FP rate when no feedback exists", () => {
    expect(store.falsePositiveRate()).toBe(0);
  });

  it("computes FP rate for a time window", () => {
    const old = { anomalyId: "old", verdict: "false_positive" as const, timestamp: Date.now() - 86400000 * 2 };
    const recent = makeFeedback("recent", "confirmed");

    store.insert(old);
    store.insert(recent);

    // Last 24 hours: only "recent" (confirmed), FP rate = 0
    const rate = store.falsePositiveRate(86400000);
    expect(rate).toBe(0);
  });

  it("stores optional note", () => {
    store.insert({ anomalyId: "a1", verdict: "false_positive", note: "This was a scheduled event", timestamp: Date.now() });
    const all = store.getAll();
    expect(all[0]!.note).toBe("This was a scheduled event");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/improvement/__tests__/feedback-store.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// agent/src/improvement/feedback-store.ts
import type Database from "better-sqlite3";
import type { AnomalyFeedback, FeedbackVerdict } from "@finwatch/shared";

export class FeedbackStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feedback_log (
        anomaly_id TEXT PRIMARY KEY,
        verdict TEXT NOT NULL,
        note TEXT,
        timestamp INTEGER NOT NULL,
        processed INTEGER NOT NULL DEFAULT 0
      )
    `);
  }

  insert(feedback: AnomalyFeedback): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO feedback_log (anomaly_id, verdict, note, timestamp, processed)
       VALUES (?, ?, ?, ?, 0)`
    ).run(feedback.anomalyId, feedback.verdict, feedback.note ?? null, feedback.timestamp);
  }

  getAll(): AnomalyFeedback[] {
    const rows = this.db.prepare("SELECT * FROM feedback_log ORDER BY timestamp").all() as any[];
    return rows.map((r) => ({
      anomalyId: r.anomaly_id,
      verdict: r.verdict as FeedbackVerdict,
      note: r.note ?? undefined,
      timestamp: r.timestamp,
    }));
  }

  getUnprocessed(): AnomalyFeedback[] {
    const rows = this.db.prepare("SELECT * FROM feedback_log WHERE processed = 0 ORDER BY timestamp").all() as any[];
    return rows.map((r) => ({
      anomalyId: r.anomaly_id,
      verdict: r.verdict as FeedbackVerdict,
      note: r.note ?? undefined,
      timestamp: r.timestamp,
    }));
  }

  unprocessedCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM feedback_log WHERE processed = 0").get() as any;
    return row.count;
  }

  markProcessed(anomalyIds: string[]): void {
    const stmt = this.db.prepare("UPDATE feedback_log SET processed = 1 WHERE anomaly_id = ?");
    const tx = this.db.transaction(() => {
      for (const id of anomalyIds) stmt.run(id);
    });
    tx();
  }

  getByVerdict(verdict: FeedbackVerdict): AnomalyFeedback[] {
    const rows = this.db.prepare("SELECT * FROM feedback_log WHERE verdict = ? ORDER BY timestamp").all(verdict) as any[];
    return rows.map((r) => ({
      anomalyId: r.anomaly_id,
      verdict: r.verdict as FeedbackVerdict,
      note: r.note ?? undefined,
      timestamp: r.timestamp,
    }));
  }

  falsePositiveRate(windowMs?: number): number {
    let query = "SELECT verdict FROM feedback_log";
    const params: unknown[] = [];

    if (windowMs !== undefined) {
      const since = Date.now() - windowMs;
      query += " WHERE timestamp >= ?";
      params.push(since);
    }

    const rows = this.db.prepare(query).all(...params) as any[];
    if (rows.length === 0) return 0;

    const fpCount = rows.filter((r) => r.verdict === "false_positive").length;
    return fpCount / rows.length;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/improvement/__tests__/feedback-store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add agent/src/improvement/__tests__/feedback-store.test.ts agent/src/improvement/feedback-store.ts
git commit -m "feat(improvement): add feedback store with SQLite persistence"
```

---

### Task 2: Feedback Batch Trigger

**Files:**
- Create: `agent/src/improvement/__tests__/feedback-trigger.test.ts`
- Create: `agent/src/improvement/feedback-trigger.ts`

**Step 1: Write the failing test**

```typescript
// agent/src/improvement/__tests__/feedback-trigger.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FeedbackTrigger, type FeedbackTriggerConfig } from "../feedback-trigger.js";

describe("FeedbackTrigger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("triggers after reaching count threshold", () => {
    const onTrigger = vi.fn();
    const trigger = new FeedbackTrigger({
      countThreshold: 3,
      timeoutMs: 7200000,
      onTrigger,
    });

    trigger.recordFeedback();
    trigger.recordFeedback();
    expect(onTrigger).not.toHaveBeenCalled();

    trigger.recordFeedback();
    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it("triggers after timeout even with fewer feedbacks", () => {
    const onTrigger = vi.fn();
    const trigger = new FeedbackTrigger({
      countThreshold: 10,
      timeoutMs: 7200000,
      onTrigger,
    });

    trigger.recordFeedback();
    trigger.start();

    vi.advanceTimersByTime(7200000);
    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it("does not trigger timeout if no feedbacks recorded", () => {
    const onTrigger = vi.fn();
    const trigger = new FeedbackTrigger({
      countThreshold: 10,
      timeoutMs: 7200000,
      onTrigger,
    });

    trigger.start();
    vi.advanceTimersByTime(7200000);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("resets count after trigger", () => {
    const onTrigger = vi.fn();
    const trigger = new FeedbackTrigger({
      countThreshold: 2,
      timeoutMs: 7200000,
      onTrigger,
    });

    trigger.recordFeedback();
    trigger.recordFeedback();
    expect(onTrigger).toHaveBeenCalledOnce();

    trigger.recordFeedback();
    expect(onTrigger).toHaveBeenCalledOnce();

    trigger.recordFeedback();
    expect(onTrigger).toHaveBeenCalledTimes(2);
  });

  it("can be stopped", () => {
    const onTrigger = vi.fn();
    const trigger = new FeedbackTrigger({
      countThreshold: 10,
      timeoutMs: 7200000,
      onTrigger,
    });

    trigger.recordFeedback();
    trigger.start();
    trigger.stop();

    vi.advanceTimersByTime(7200000);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("reports pending count", () => {
    const trigger = new FeedbackTrigger({
      countThreshold: 10,
      timeoutMs: 7200000,
      onTrigger: vi.fn(),
    });

    trigger.recordFeedback();
    trigger.recordFeedback();
    expect(trigger.pendingCount).toBe(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/improvement/__tests__/feedback-trigger.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// agent/src/improvement/feedback-trigger.ts
export type FeedbackTriggerConfig = {
  countThreshold: number;
  timeoutMs: number;
  onTrigger: () => void;
};

export class FeedbackTrigger {
  private config: FeedbackTriggerConfig;
  private count = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private hasPending = false;

  constructor(config: FeedbackTriggerConfig) {
    this.config = config;
  }

  get pendingCount(): number {
    return this.count;
  }

  recordFeedback(): void {
    this.count++;
    this.hasPending = true;
    if (this.count >= this.config.countThreshold) {
      this.fire();
    }
  }

  start(): void {
    this.stop();
    this.timer = setInterval(() => {
      if (this.hasPending) {
        this.fire();
      }
    }, this.config.timeoutMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private fire(): void {
    this.count = 0;
    this.hasPending = false;
    this.config.onTrigger();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/improvement/__tests__/feedback-trigger.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add agent/src/improvement/__tests__/feedback-trigger.test.ts agent/src/improvement/feedback-trigger.ts
git commit -m "feat(improvement): add feedback batch trigger with count and timeout thresholds"
```

---

### Task 3: Feedback Integration Turn

**Files:**
- Create: `agent/src/improvement/__tests__/feedback-integration.test.ts`
- Create: `agent/src/improvement/feedback-integration.ts`

**Step 1: Write the failing test**

```typescript
// agent/src/improvement/__tests__/feedback-integration.test.ts
import { describe, it, expect, vi } from "vitest";
import type { LLMProvider, CreateMessageParams, StreamEvent, AnomalyFeedback } from "@finwatch/shared";
import { FeedbackIntegration, type FeedbackIntegrationDeps, type IntegrationResult } from "../feedback-integration.js";

function mockProvider(response: string): LLMProvider {
  return {
    id: "mock",
    name: "Mock",
    async *createMessage(): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", text: response };
      yield { type: "usage", input: 100, output: 50 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi.fn().mockResolvedValue({ providerId: "mock", status: "healthy", latencyMs: 10 }),
    listModels: vi.fn().mockReturnValue(["mock-model"]),
  };
}

const sampleFeedback: AnomalyFeedback[] = [
  { anomalyId: "a1", verdict: "false_positive", note: "Scheduled maintenance", timestamp: Date.now() },
  { anomalyId: "a2", verdict: "confirmed", timestamp: Date.now() },
  { anomalyId: "a3", verdict: "false_positive", timestamp: Date.now() },
];

describe("FeedbackIntegration", () => {
  it("runs an integration turn with feedback batch", async () => {
    const deps: FeedbackIntegrationDeps = {
      provider: mockProvider("Based on the feedback, I recommend increasing the price threshold from 3.0 to 3.5 for source yahoo."),
      model: "mock-model",
    };

    const integration = new FeedbackIntegration(deps);
    const result = await integration.run(sampleFeedback);

    expect(result.response).toContain("threshold");
    expect(result.feedbackCount).toBe(3);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("includes feedback details in the prompt to the LLM", async () => {
    const createMessageSpy = vi.fn<[CreateMessageParams], AsyncIterable<StreamEvent>>();
    createMessageSpy.mockImplementation(async function* () {
      yield { type: "text_delta", text: "Adjustments noted." };
      yield { type: "stop", reason: "end_turn" };
    });

    const provider: LLMProvider = {
      id: "spy",
      name: "Spy",
      createMessage: createMessageSpy,
      healthCheck: vi.fn().mockResolvedValue({ providerId: "spy", status: "healthy", latencyMs: 10 }),
      listModels: vi.fn().mockReturnValue(["spy-model"]),
    };

    const integration = new FeedbackIntegration({ provider, model: "spy-model" });
    await integration.run(sampleFeedback);

    expect(createMessageSpy).toHaveBeenCalledOnce();
    const params = createMessageSpy.mock.calls[0]![0];
    expect(params.system).toContain("feedback");
    expect(params.messages[0]!.content).toContain("false_positive");
    expect(params.messages[0]!.content).toContain("confirmed");
  });

  it("handles empty feedback batch", async () => {
    const integration = new FeedbackIntegration({
      provider: mockProvider("No feedback to process."),
      model: "mock-model",
    });

    const result = await integration.run([]);
    expect(result.feedbackCount).toBe(0);
    expect(result.skipped).toBe(true);
  });

  it("computes verdict summary", async () => {
    const integration = new FeedbackIntegration({
      provider: mockProvider("Processed."),
      model: "mock-model",
    });

    const result = await integration.run(sampleFeedback);
    expect(result.verdictSummary).toEqual({
      confirmed: 1,
      false_positive: 2,
      needs_review: 0,
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/improvement/__tests__/feedback-integration.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// agent/src/improvement/feedback-integration.ts
import type { LLMProvider, AnomalyFeedback, FeedbackVerdict } from "@finwatch/shared";

export type FeedbackIntegrationDeps = {
  provider: LLMProvider;
  model: string;
};

export type IntegrationResult = {
  response: string;
  feedbackCount: number;
  verdictSummary: Record<FeedbackVerdict, number>;
  durationMs: number;
  skipped: boolean;
};

export class FeedbackIntegration {
  private deps: FeedbackIntegrationDeps;

  constructor(deps: FeedbackIntegrationDeps) {
    this.deps = deps;
  }

  async run(feedbackBatch: AnomalyFeedback[]): Promise<IntegrationResult> {
    const startTime = Date.now();

    const verdictSummary: Record<FeedbackVerdict, number> = {
      confirmed: 0,
      false_positive: 0,
      needs_review: 0,
    };

    for (const f of feedbackBatch) {
      verdictSummary[f.verdict]++;
    }

    if (feedbackBatch.length === 0) {
      return {
        response: "",
        feedbackCount: 0,
        verdictSummary,
        durationMs: Date.now() - startTime,
        skipped: true,
      };
    }

    const feedbackText = feedbackBatch
      .map((f) => `- Anomaly ${f.anomalyId}: ${f.verdict}${f.note ? ` (${f.note})` : ""}`)
      .join("\n");

    const summaryText = `Summary: ${verdictSummary.confirmed} confirmed, ${verdictSummary.false_positive} false positives, ${verdictSummary.needs_review} needs review`;

    let response = "";
    const stream = this.deps.provider.createMessage({
      model: this.deps.model,
      system: "You are a feedback integration assistant. Analyze user feedback on anomaly detections and recommend adjustments to detection thresholds, rule confidence scores, and pattern recognition. Be specific about which parameters to change and by how much.",
      messages: [
        {
          role: "user",
          content: `Please analyze this feedback batch and recommend threshold/rule adjustments:\n\n${feedbackText}\n\n${summaryText}`,
        },
      ],
      maxTokens: 2048,
      temperature: 0.3,
    });

    for await (const event of stream) {
      if (event.type === "text_delta") {
        response += event.text;
      }
    }

    return {
      response,
      feedbackCount: feedbackBatch.length,
      verdictSummary,
      durationMs: Date.now() - startTime,
      skipped: false,
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/improvement/__tests__/feedback-integration.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add agent/src/improvement/__tests__/feedback-integration.test.ts agent/src/improvement/feedback-integration.ts
git commit -m "feat(improvement): add feedback integration turn with LLM analysis"
```

---

### Task 4: Knowledge Accumulation

**Files:**
- Create: `agent/src/improvement/__tests__/knowledge-accumulator.test.ts`
- Create: `agent/src/improvement/knowledge-accumulator.ts`

**Step 1: Write the failing test**

```typescript
// agent/src/improvement/__tests__/knowledge-accumulator.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { DomainKnowledgeStore } from "../../memory/domain-knowledge.js";
import { KnowledgeAccumulator, type AccumulatorConfig } from "../knowledge-accumulator.js";

let db: Database.Database;
let domainStore: DomainKnowledgeStore;
let accumulator: KnowledgeAccumulator;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS patterns (
      id TEXT PRIMARY KEY, pattern TEXT NOT NULL, confidence REAL NOT NULL,
      source TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS correlations (
      id TEXT PRIMARY KEY, source_a TEXT NOT NULL, source_b TEXT NOT NULL,
      rule TEXT NOT NULL, confidence REAL NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS thresholds (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, metric TEXT NOT NULL,
      value REAL NOT NULL, direction TEXT NOT NULL, updated_at INTEGER NOT NULL
    );
  `);
  domainStore = new DomainKnowledgeStore(db);
  accumulator = new KnowledgeAccumulator(domainStore, { dedupThreshold: 0.9 });
});

afterEach(() => {
  db.close();
});

describe("KnowledgeAccumulator", () => {
  it("stores a new pattern", () => {
    accumulator.accumulatePattern({
      pattern: "AAPL tends to spike on earnings days",
      confidence: 0.85,
      source: "analysis-turn-1",
    });

    const patterns = domainStore.getPatterns();
    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.pattern).toBe("AAPL tends to spike on earnings days");
  });

  it("updates existing pattern if identical (dedup)", () => {
    accumulator.accumulatePattern({ pattern: "AAPL spikes on earnings", confidence: 0.7, source: "turn-1" });
    accumulator.accumulatePattern({ pattern: "AAPL spikes on earnings", confidence: 0.9, source: "turn-2" });

    const patterns = domainStore.getPatterns();
    expect(patterns).toHaveLength(1);
    expect(patterns[0]!.confidence).toBe(0.9);
  });

  it("stores distinct patterns separately", () => {
    accumulator.accumulatePattern({ pattern: "AAPL spikes on earnings", confidence: 0.7, source: "turn-1" });
    accumulator.accumulatePattern({ pattern: "GOOGL drops after antitrust news", confidence: 0.6, source: "turn-1" });

    expect(domainStore.getPatterns()).toHaveLength(2);
  });

  it("stores a correlation", () => {
    accumulator.accumulateCorrelation({
      sourceA: "yahoo", sourceB: "csv-custom",
      rule: "When AAPL volume > 2x average, MSFT follows within 1 hour",
      confidence: 0.75,
    });

    expect(domainStore.getCorrelations()).toHaveLength(1);
  });

  it("stores a threshold adjustment", () => {
    accumulator.accumulateThreshold({ source: "yahoo", metric: "price", value: 3.5, direction: "above" as const });
    expect(domainStore.getThresholds()).toHaveLength(1);
    expect(domainStore.getThresholds()[0]!.value).toBe(3.5);
  });

  it("updates threshold if same source/metric exists", () => {
    accumulator.accumulateThreshold({ source: "yahoo", metric: "price", value: 3.0, direction: "above" as const });
    accumulator.accumulateThreshold({ source: "yahoo", metric: "price", value: 3.5, direction: "above" as const });

    const thresholds = domainStore.getThresholds();
    expect(thresholds).toHaveLength(1);
    expect(thresholds[0]!.value).toBe(3.5);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/improvement/__tests__/knowledge-accumulator.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// agent/src/improvement/knowledge-accumulator.ts
import { randomUUID } from "crypto";
import type { DomainKnowledgeStore } from "../memory/domain-knowledge.js";

export type AccumulatorConfig = {
  dedupThreshold: number;
};

function simpleTextSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

export class KnowledgeAccumulator {
  private store: DomainKnowledgeStore;
  private config: AccumulatorConfig;

  constructor(store: DomainKnowledgeStore, config: AccumulatorConfig) {
    this.store = store;
    this.config = config;
  }

  accumulatePattern(input: { pattern: string; confidence: number; source: string }): void {
    const existing = this.store.getPatterns();

    for (const p of existing) {
      if (simpleTextSimilarity(p.pattern, input.pattern) >= this.config.dedupThreshold) {
        this.store.upsertPattern({
          ...p,
          confidence: Math.max(p.confidence, input.confidence),
          updatedAt: Date.now(),
        });
        return;
      }
    }

    this.store.upsertPattern({
      id: randomUUID(),
      pattern: input.pattern,
      confidence: input.confidence,
      source: input.source,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  accumulateCorrelation(input: { sourceA: string; sourceB: string; rule: string; confidence: number }): void {
    this.store.upsertCorrelation({
      id: randomUUID(),
      sourceA: input.sourceA,
      sourceB: input.sourceB,
      rule: input.rule,
      confidence: input.confidence,
      createdAt: Date.now(),
    });
  }

  accumulateThreshold(input: { source: string; metric: string; value: number; direction: "above" | "below" }): void {
    const existing = this.store.getThresholds();
    const match = existing.find((t) => t.source === input.source && t.metric === input.metric);

    if (match) {
      this.store.upsertThreshold({ ...match, value: input.value, direction: input.direction, updatedAt: Date.now() });
    } else {
      this.store.upsertThreshold({
        id: randomUUID(), source: input.source, metric: input.metric,
        value: input.value, direction: input.direction, updatedAt: Date.now(),
      });
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/improvement/__tests__/knowledge-accumulator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add agent/src/improvement/__tests__/knowledge-accumulator.test.ts agent/src/improvement/knowledge-accumulator.ts
git commit -m "feat(improvement): add knowledge accumulator with pattern dedup"
```

---

### Task 5: Weekly Consolidation Pass

**Files:**
- Create: `agent/src/improvement/__tests__/consolidation.test.ts`
- Create: `agent/src/improvement/consolidation.ts`

**Step 1: Write the failing test**

```typescript
// agent/src/improvement/__tests__/consolidation.test.ts
import { describe, it, expect, vi } from "vitest";
import type { LLMProvider, CreateMessageParams, StreamEvent, DomainPattern, DomainCorrelation, DomainThreshold } from "@finwatch/shared";
import { WeeklyConsolidation, type ConsolidationDeps, type ConsolidationResult } from "../consolidation.js";

function mockProvider(response: string): LLMProvider {
  return {
    id: "mock", name: "Mock",
    async *createMessage(): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", text: response };
      yield { type: "usage", input: 200, output: 100 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi.fn().mockResolvedValue({ providerId: "mock", status: "healthy", latencyMs: 10 }),
    listModels: vi.fn().mockReturnValue(["mock-model"]),
  };
}

const samplePatterns: DomainPattern[] = [
  { id: "p1", pattern: "AAPL spikes on earnings", confidence: 0.8, source: "turn-1", createdAt: Date.now(), updatedAt: Date.now() },
  { id: "p2", pattern: "GOOGL drops on antitrust news", confidence: 0.9, source: "turn-3", createdAt: Date.now(), updatedAt: Date.now() },
];
const sampleCorrelations: DomainCorrelation[] = [
  { id: "c1", sourceA: "yahoo", sourceB: "csv", rule: "Volume correlation", confidence: 0.7, createdAt: Date.now() },
];
const sampleThresholds: DomainThreshold[] = [
  { id: "t1", source: "yahoo", metric: "price", value: 3.0, direction: "above", updatedAt: Date.now() },
];

describe("WeeklyConsolidation", () => {
  it("runs consolidation and writes KNOWLEDGE.md", async () => {
    const writeFile = vi.fn();
    const consolidation = new WeeklyConsolidation({
      provider: mockProvider("# Consolidated Knowledge\n\n## Patterns\n- AAPL spikes on earnings"),
      model: "mock-model",
      knowledgeFilePath: "/tmp/KNOWLEDGE.md",
      writeFile,
    });

    const result = await consolidation.run(samplePatterns, sampleCorrelations, sampleThresholds);
    expect(result.content).toContain("Consolidated Knowledge");
    expect(result.patternsProcessed).toBe(2);
    expect(writeFile).toHaveBeenCalledWith("/tmp/KNOWLEDGE.md", expect.stringContaining("Consolidated"));
  });

  it("sends all knowledge to LLM", async () => {
    const spy = vi.fn<[CreateMessageParams], AsyncIterable<StreamEvent>>();
    spy.mockImplementation(async function* () {
      yield { type: "text_delta", text: "Consolidated." };
      yield { type: "stop", reason: "end_turn" };
    });

    const consolidation = new WeeklyConsolidation({
      provider: { id: "spy", name: "Spy", createMessage: spy, healthCheck: vi.fn().mockResolvedValue({ providerId: "spy", status: "healthy", latencyMs: 10 }), listModels: vi.fn().mockReturnValue(["spy"]) },
      model: "spy", knowledgeFilePath: "/tmp/KNOWLEDGE.md", writeFile: vi.fn(),
    });

    await consolidation.run(samplePatterns, sampleCorrelations, sampleThresholds);
    expect(spy.mock.calls[0]![0].messages[0]!.content).toContain("AAPL spikes on earnings");
  });

  it("skips when no knowledge exists", async () => {
    const writeFile = vi.fn();
    const consolidation = new WeeklyConsolidation({
      provider: mockProvider("Nothing."), model: "mock-model",
      knowledgeFilePath: "/tmp/KNOWLEDGE.md", writeFile,
    });

    const result = await consolidation.run([], [], []);
    expect(result.skipped).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/improvement/__tests__/consolidation.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// agent/src/improvement/consolidation.ts
import type { LLMProvider, DomainPattern, DomainCorrelation, DomainThreshold } from "@finwatch/shared";

export type ConsolidationDeps = {
  provider: LLMProvider;
  model: string;
  knowledgeFilePath: string;
  writeFile: (path: string, content: string) => void;
};

export type ConsolidationResult = {
  content: string;
  patternsProcessed: number;
  correlationsProcessed: number;
  thresholdsProcessed: number;
  durationMs: number;
  skipped: boolean;
};

export class WeeklyConsolidation {
  private deps: ConsolidationDeps;

  constructor(deps: ConsolidationDeps) { this.deps = deps; }

  async run(patterns: DomainPattern[], correlations: DomainCorrelation[], thresholds: DomainThreshold[]): Promise<ConsolidationResult> {
    const startTime = Date.now();

    if (patterns.length === 0 && correlations.length === 0 && thresholds.length === 0) {
      return { content: "", patternsProcessed: 0, correlationsProcessed: 0, thresholdsProcessed: 0, durationMs: Date.now() - startTime, skipped: true };
    }

    let text = "## Patterns\n";
    for (const p of patterns) text += `- ${p.pattern} (confidence: ${p.confidence}, source: ${p.source})\n`;
    text += "\n## Correlations\n";
    for (const c of correlations) text += `- ${c.sourceA} <-> ${c.sourceB}: ${c.rule} (confidence: ${c.confidence})\n`;
    text += "\n## Thresholds\n";
    for (const t of thresholds) text += `- ${t.source}/${t.metric}: ${t.direction} ${t.value}\n`;

    let content = "";
    const stream = this.deps.provider.createMessage({
      model: this.deps.model,
      system: "You are a knowledge consolidation assistant. Merge, deduplicate, and prune the provided domain knowledge. Remove contradictions. Output a clean KNOWLEDGE.md file in markdown format.",
      messages: [{ role: "user", content: `Please consolidate this domain knowledge:\n\n${text}` }],
      maxTokens: 4096,
      temperature: 0.2,
    });

    for await (const event of stream) {
      if (event.type === "text_delta") content += event.text;
    }

    this.deps.writeFile(this.deps.knowledgeFilePath, content);

    return { content, patternsProcessed: patterns.length, correlationsProcessed: correlations.length, thresholdsProcessed: thresholds.length, durationMs: Date.now() - startTime, skipped: false };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/improvement/__tests__/consolidation.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add agent/src/improvement/__tests__/consolidation.test.ts agent/src/improvement/consolidation.ts
git commit -m "feat(improvement): add weekly knowledge consolidation"
```

---

### Task 6: Rule Evolution (daily)

**Files:**
- Create: `agent/src/improvement/__tests__/rule-evolution.test.ts`
- Create: `agent/src/improvement/rule-evolution.ts`

**Step 1: Write the failing test**

```typescript
// agent/src/improvement/__tests__/rule-evolution.test.ts
import { describe, it, expect, vi } from "vitest";
import type { LLMProvider, CreateMessageParams, StreamEvent } from "@finwatch/shared";
import { RuleEvolution, type RuleEvolutionDeps, type EvolutionResult } from "../rule-evolution.js";

function mockProvider(response: string): LLMProvider {
  return {
    id: "mock", name: "Mock",
    async *createMessage(): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", text: response };
      yield { type: "usage", input: 100, output: 50 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi.fn().mockResolvedValue({ providerId: "mock", status: "healthy", latencyMs: 10 }),
    listModels: vi.fn().mockReturnValue(["mock-model"]),
  };
}

const sampleRules = [{ id: "r1", name: "High price", condition: { type: "threshold", metric: "price", operator: ">", value: 200 }, severity: "high", confidence: 0.9 }];
const sampleMetrics = { truePositives: 8, falsePositives: 2, falseNegatives: 1, totalPredictions: 11 };

describe("RuleEvolution", () => {
  it("produces a versioned rule file", async () => {
    const writeFile = vi.fn();
    const evolution = new RuleEvolution({
      provider: mockProvider(JSON.stringify([{ id: "r1", name: "High price (adjusted)" }])),
      model: "mock-model", rulesDir: "/tmp/rules",
      writeFile, appendFile: vi.fn(),
      readFile: vi.fn().mockReturnValue(JSON.stringify(sampleRules)),
      listFiles: vi.fn().mockReturnValue(["rules_active.json"]),
    });

    const result = await evolution.run(sampleRules, sampleMetrics);
    expect(result.newVersion).toBeGreaterThan(0);
    expect(writeFile.mock.calls.some((c: any) => c[0].includes("rules_v"))).toBe(true);
  });

  it("sends rules + metrics to LLM", async () => {
    const spy = vi.fn<[CreateMessageParams], AsyncIterable<StreamEvent>>();
    spy.mockImplementation(async function* () {
      yield { type: "text_delta", text: "[]" };
      yield { type: "stop", reason: "end_turn" };
    });

    const evolution = new RuleEvolution({
      provider: { id: "spy", name: "Spy", createMessage: spy, healthCheck: vi.fn().mockResolvedValue({ providerId: "spy", status: "healthy", latencyMs: 10 }), listModels: vi.fn().mockReturnValue(["spy"]) },
      model: "spy", rulesDir: "/tmp/rules",
      writeFile: vi.fn(), appendFile: vi.fn(), readFile: vi.fn().mockReturnValue("[]"), listFiles: vi.fn().mockReturnValue([]),
    });

    await evolution.run(sampleRules, sampleMetrics);
    expect(spy.mock.calls[0]![0].messages[0]!.content).toContain("High price");
  });

  it("determines version from existing files", async () => {
    const evolution = new RuleEvolution({
      provider: mockProvider("[]"), model: "mock-model", rulesDir: "/tmp/rules",
      writeFile: vi.fn(), appendFile: vi.fn(), readFile: vi.fn().mockReturnValue("[]"),
      listFiles: vi.fn().mockReturnValue(["rules_active.json", "rules_v001.json", "rules_v002.json"]),
    });

    const result = await evolution.run(sampleRules, sampleMetrics);
    expect(result.newVersion).toBe(3);
  });

  it("logs to evolution_log.jsonl", async () => {
    const appendFile = vi.fn();
    const evolution = new RuleEvolution({
      provider: mockProvider("[]"), model: "mock-model", rulesDir: "/tmp/rules",
      writeFile: vi.fn(), appendFile, readFile: vi.fn().mockReturnValue("[]"), listFiles: vi.fn().mockReturnValue([]),
    });

    await evolution.run(sampleRules, sampleMetrics);
    expect(appendFile).toHaveBeenCalledWith(expect.stringContaining("evolution_log.jsonl"), expect.any(String));
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/improvement/__tests__/rule-evolution.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// agent/src/improvement/rule-evolution.ts
import type { LLMProvider } from "@finwatch/shared";

export type RuleEvolutionDeps = {
  provider: LLMProvider;
  model: string;
  rulesDir: string;
  writeFile: (path: string, content: string) => void;
  appendFile: (path: string, content: string) => void;
  readFile: (path: string) => string;
  listFiles: (dir: string) => string[];
};

export type PerformanceMetrics = {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  totalPredictions: number;
};

export type EvolutionResult = {
  newVersion: number;
  rulesCount: number;
  durationMs: number;
};

export class RuleEvolution {
  private deps: RuleEvolutionDeps;

  constructor(deps: RuleEvolutionDeps) { this.deps = deps; }

  async run(currentRules: unknown[], metrics: PerformanceMetrics): Promise<EvolutionResult> {
    const startTime = Date.now();

    const files = this.deps.listFiles(this.deps.rulesDir);
    const versions = files.map((f) => f.match(/rules_v(\d+)/)).filter((m): m is RegExpMatchArray => m !== null).map((m) => parseInt(m[1]!, 10));
    const nextVersion = versions.length > 0 ? Math.max(...versions) + 1 : 1;

    let response = "";
    const stream = this.deps.provider.createMessage({
      model: this.deps.model,
      system: "You are a rule evolution assistant. Given current detection rules and performance metrics, output an improved JSON rules array. Only output the JSON array.",
      messages: [{ role: "user", content: `Current rules:\n${JSON.stringify(currentRules, null, 2)}\n\nPerformance metrics (last 24h):\n${JSON.stringify(metrics, null, 2)}\n\nPropose updated rules array.` }],
      maxTokens: 4096,
      temperature: 0.3,
    });

    for await (const event of stream) {
      if (event.type === "text_delta") response += event.text;
    }

    let newRules: unknown[];
    try {
      newRules = JSON.parse(response);
      if (!Array.isArray(newRules)) newRules = [];
    } catch {
      newRules = currentRules;
    }

    const versionStr = String(nextVersion).padStart(3, "0");
    this.deps.writeFile(`${this.deps.rulesDir}/rules_v${versionStr}.json`, JSON.stringify(newRules, null, 2));
    this.deps.writeFile(`${this.deps.rulesDir}/rules_active.json`, JSON.stringify(newRules, null, 2));

    this.deps.appendFile(`${this.deps.rulesDir}/evolution_log.jsonl`, JSON.stringify({ timestamp: Date.now(), version: nextVersion, metrics, rulesCount: newRules.length }) + "\n");

    return { newVersion: nextVersion, rulesCount: newRules.length, durationMs: Date.now() - startTime };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/improvement/__tests__/rule-evolution.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add agent/src/improvement/__tests__/rule-evolution.test.ts agent/src/improvement/rule-evolution.ts
git commit -m "feat(improvement): add daily rule evolution with versioned snapshots"
```

---

### Task 7: Auto-Revert Safety

**Files:**
- Create: `agent/src/improvement/__tests__/auto-revert.test.ts`
- Create: `agent/src/improvement/auto-revert.ts`

**Step 1: Write the failing test**

```typescript
// agent/src/improvement/__tests__/auto-revert.test.ts
import { describe, it, expect, vi } from "vitest";
import { AutoRevert, type AutoRevertDeps, type RevertResult } from "../auto-revert.js";

describe("AutoRevert", () => {
  it("reverts when FP rate exceeds 50%", () => {
    const revertFn = vi.fn();
    const notifyFn = vi.fn();

    const revert = new AutoRevert({
      fpRateThreshold: 0.5, revert: revertFn, notify: notifyFn,
      getPreviousVersion: vi.fn().mockReturnValue("rules_v001.json"),
      readFile: vi.fn().mockReturnValue('[{"id":"r1"}]'),
    });

    const result = revert.check(0.55, 3);
    expect(result.reverted).toBe(true);
    expect(revertFn).toHaveBeenCalledWith('[{"id":"r1"}]');
    expect(notifyFn).toHaveBeenCalledWith(expect.stringContaining("Auto-revert"));
  });

  it("does not revert when FP rate is within threshold", () => {
    const revertFn = vi.fn();
    const revert = new AutoRevert({
      fpRateThreshold: 0.5, revert: revertFn, notify: vi.fn(),
      getPreviousVersion: vi.fn(), readFile: vi.fn(),
    });

    const result = revert.check(0.3, 3);
    expect(result.reverted).toBe(false);
    expect(revertFn).not.toHaveBeenCalled();
  });

  it("does not revert at exact threshold", () => {
    const revert = new AutoRevert({
      fpRateThreshold: 0.5, revert: vi.fn(), notify: vi.fn(),
      getPreviousVersion: vi.fn(), readFile: vi.fn(),
    });
    expect(revert.check(0.5, 3).reverted).toBe(false);
  });

  it("does not revert without previous version", () => {
    const revert = new AutoRevert({
      fpRateThreshold: 0.5, revert: vi.fn(), notify: vi.fn(),
      getPreviousVersion: vi.fn().mockReturnValue(null), readFile: vi.fn(),
    });

    const result = revert.check(0.8, 3);
    expect(result.reverted).toBe(false);
    expect(result.reason).toContain("no previous version");
  });

  it("does not revert below minimum feedback count", () => {
    const revert = new AutoRevert({
      fpRateThreshold: 0.5, revert: vi.fn(), notify: vi.fn(),
      getPreviousVersion: vi.fn().mockReturnValue("rules_v001.json"),
      readFile: vi.fn().mockReturnValue("[]"), minFeedbackCount: 5,
    });

    const result = revert.check(0.9, 3);
    expect(result.reverted).toBe(false);
    expect(result.reason).toContain("insufficient feedback");
  });

  it("returns revert metadata", () => {
    const revert = new AutoRevert({
      fpRateThreshold: 0.5, revert: vi.fn(), notify: vi.fn(),
      getPreviousVersion: vi.fn().mockReturnValue("rules_v002.json"),
      readFile: vi.fn().mockReturnValue("[{}]"),
    });

    const result = revert.check(0.7, 10);
    expect(result.reverted).toBe(true);
    expect(result.previousVersion).toBe("rules_v002.json");
    expect(result.fpRate).toBe(0.7);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/improvement/__tests__/auto-revert.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// agent/src/improvement/auto-revert.ts
export type AutoRevertDeps = {
  fpRateThreshold: number;
  revert: (previousRulesJson: string) => void;
  notify: (message: string) => void;
  getPreviousVersion: () => string | null;
  readFile: (path: string) => string;
  minFeedbackCount?: number;
};

export type RevertResult = {
  reverted: boolean;
  reason?: string;
  previousVersion?: string;
  fpRate: number;
};

export class AutoRevert {
  private deps: AutoRevertDeps;

  constructor(deps: AutoRevertDeps) { this.deps = deps; }

  check(currentFpRate: number, feedbackCount: number): RevertResult {
    const minCount = this.deps.minFeedbackCount ?? 0;

    if (feedbackCount < minCount) {
      return { reverted: false, reason: "insufficient feedback count", fpRate: currentFpRate };
    }

    if (currentFpRate <= this.deps.fpRateThreshold) {
      return { reverted: false, fpRate: currentFpRate };
    }

    const previousVersion = this.deps.getPreviousVersion();
    if (!previousVersion) {
      return { reverted: false, reason: "no previous version available", fpRate: currentFpRate };
    }

    const previousRules = this.deps.readFile(previousVersion);
    this.deps.revert(previousRules);
    this.deps.notify(`Auto-revert triggered: FP rate ${(currentFpRate * 100).toFixed(1)}% exceeds threshold ${(this.deps.fpRateThreshold * 100).toFixed(1)}%. Reverted to ${previousVersion}.`);

    return { reverted: true, previousVersion, fpRate: currentFpRate };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/improvement/__tests__/auto-revert.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add agent/src/improvement/__tests__/auto-revert.test.ts agent/src/improvement/auto-revert.ts
git commit -m "feat(improvement): add auto-revert safety for rule evolution"
```

---

### Task 8: Barrel Export

**Files:**
- Create: `agent/src/improvement/index.ts`

**Step 1: Write the barrel export**

```typescript
// agent/src/improvement/index.ts
export { FeedbackStore } from "./feedback-store.js";
export { FeedbackTrigger, type FeedbackTriggerConfig } from "./feedback-trigger.js";
export { FeedbackIntegration, type FeedbackIntegrationDeps, type IntegrationResult } from "./feedback-integration.js";
export { KnowledgeAccumulator, type AccumulatorConfig } from "./knowledge-accumulator.js";
export { WeeklyConsolidation, type ConsolidationDeps, type ConsolidationResult } from "./consolidation.js";
export { RuleEvolution, type RuleEvolutionDeps, type PerformanceMetrics, type EvolutionResult } from "./rule-evolution.js";
export { AutoRevert, type AutoRevertDeps, type RevertResult } from "./auto-revert.js";
```

**Step 2: Run all improvement tests**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/improvement/`
Expected: All pass

**Step 3: Commit**

```bash
git add agent/src/improvement/index.ts
git commit -m "feat(improvement): add barrel export for improvement module"
```

---

## Verification Checklist

After all tasks are complete, verify:

```
[ ] npx vitest run agent/src/improvement/ — all pass
[ ] Feedback store inserts, queries, marks processed
[ ] Batch trigger fires on count (10) and timeout (2hr)
[ ] Feedback integration turn produces threshold adjustments via LLM
[ ] Knowledge accumulation stores patterns with dedup, correlations, thresholds
[ ] Weekly consolidation rewrites KNOWLEDGE.md via LLM
[ ] Rule evolution creates versioned rules_v{NNN}.json files
[ ] Auto-revert fires when FP rate > 50%, reverts to previous version
[ ] No files modified outside agent/src/improvement/
[ ] All work committed to feat/self-improve branch
```
