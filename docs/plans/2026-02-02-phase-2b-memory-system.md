# Phase 2B: Memory System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the three-layer memory system: SQLite-backed semantic memory with hybrid search (vector + FTS5), domain knowledge tables, and auto-recall/auto-capture hooks for the analysis loop.

**Architecture:** Two SQLite databases (memory.sqlite for semantic memory with embeddings + FTS5, domain_knowledge.sqlite for structured knowledge). Hybrid search merges cosine vector similarity with BM25 keyword relevance. Auto-hooks inject/extract context around analysis turns.

**Tech Stack:** TypeScript, better-sqlite3, Vitest, Zod

**Worktree:** `/Users/jdsingh/Projects/AI/finwatch-memory-system`
**Branch:** `feat/memory-system`
**Owns:** `agent/src/memory/` — EXCLUSIVE

---

## Existing State

The agent package has providers (AnthropicProvider, OpenRouterProvider, withFallback), SessionManager, ToolRegistry. Shared types available: MemoryEntry, SearchResult, DomainPattern, DomainCorrelation, DomainThreshold, MemoryEvent.

---

## Task 2B.1: SQLite Setup with better-sqlite3 + FTS5

**Files:**
- Create: `agent/src/memory/db.ts`
- Create: `agent/src/memory/__tests__/db.test.ts`

**Step 1: Add dependency**

```bash
pnpm --filter @finwatch/agent add better-sqlite3
pnpm --filter @finwatch/agent add -D @types/better-sqlite3
```

**Step 2: Write the failing test**

Create `agent/src/memory/__tests__/db.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { createMemoryDb, createDomainDb } from "../db.js";
import Database from "better-sqlite3";

let dbs: Database.Database[] = [];
afterEach(() => { dbs.forEach(db => db.close()); dbs = []; });
function track(db: Database.Database) { dbs.push(db); return db; }

describe("createMemoryDb", () => {
  it("creates entries table", () => {
    const db = track(createMemoryDb(":memory:"));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    expect(tables.map(t => t.name)).toContain("entries");
  });

  it("creates FTS5 virtual table", () => {
    const db = track(createMemoryDb(":memory:"));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    expect(tables.map(t => t.name)).toContain("entries_fts");
  });

  it("is idempotent", () => {
    const db = track(createMemoryDb(":memory:"));
    db.exec("CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY)");
  });
});

describe("createDomainDb", () => {
  it("creates all 4 knowledge tables", () => {
    const db = track(createDomainDb(":memory:"));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain("patterns");
    expect(names).toContain("correlations");
    expect(names).toContain("thresholds");
    expect(names).toContain("seasonal");
  });

  it("creates feedback_log table", () => {
    const db = track(createDomainDb(":memory:"));
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    expect(tables.map(t => t.name)).toContain("feedback_log");
  });
});
```

**Step 3: Run test, verify FAIL:** `pnpm vitest run agent/src/memory/__tests__/db.test.ts`

**Step 4: Implement `agent/src/memory/db.ts`:**

```typescript
import Database from "better-sqlite3";

export function createMemoryDb(path: string): Database.Database {
  const db = new Database(path);
  if (path !== ":memory:") db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY, content TEXT NOT NULL, embedding BLOB,
      source TEXT NOT NULL, timestamp INTEGER NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_entries_timestamp ON entries(timestamp);
    CREATE INDEX IF NOT EXISTS idx_entries_source ON entries(source);
    CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(content, source, tags, content_rowid='rowid');
  `);
  return db;
}

export function createDomainDb(path: string): Database.Database {
  const db = new Database(path);
  if (path !== ":memory:") db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS patterns (
      id TEXT PRIMARY KEY, pattern TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0.5,
      source TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS correlations (
      id TEXT PRIMARY KEY, source_a TEXT NOT NULL, source_b TEXT NOT NULL,
      rule TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0.5, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS thresholds (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('above','below')), updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seasonal (
      id TEXT PRIMARY KEY, pattern TEXT NOT NULL, period TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS feedback_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, anomaly_id TEXT NOT NULL, verdict TEXT NOT NULL,
      note TEXT, timestamp INTEGER NOT NULL, processed INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}
```

**Step 5: Run test, verify PASS:** `pnpm vitest run agent/src/memory/__tests__/db.test.ts`

**Step 6: Commit:** `git add agent/src/memory/ && git commit -m "feat: add SQLite setup for memory and domain knowledge databases"`

---

## Task 2B.2: Embedding Integration

**Files:**
- Create: `agent/src/memory/embeddings.ts`
- Create: `agent/src/memory/__tests__/embeddings.test.ts`

**Step 1: Write the failing test**

Create `agent/src/memory/__tests__/embeddings.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmbeddingService } from "../embeddings.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("EmbeddingService", () => {
  let service: EmbeddingService;
  beforeEach(() => { vi.clearAllMocks(); service = new EmbeddingService("test-key", "text-embedding-3-small"); });

  it("calls OpenAI API with correct params", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ embedding: new Array(1536).fill(0.1) }] }) });
    await service.embed("test text");
    expect(mockFetch).toHaveBeenCalledWith("https://api.openai.com/v1/embeddings", expect.objectContaining({
      method: "POST", headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
    }));
  });

  it("returns number array of correct dimension", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ embedding: new Array(1536).fill(0.5) }] }) });
    const result = await service.embed("test");
    expect(result).toHaveLength(1536);
  });

  it("batches multiple texts in one call", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ embedding: [0.1] }, { embedding: [0.2] }] }) });
    const results = await service.embedBatch(["a", "b"]);
    expect(results).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("throws on API error", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 429, statusText: "Too Many Requests" });
    await expect(service.embed("test")).rejects.toThrow("429");
  });
});
```

**Step 2: Run test, verify FAIL:** `pnpm vitest run agent/src/memory/__tests__/embeddings.test.ts`

**Step 3: Implement `agent/src/memory/embeddings.ts`:**

```typescript
export class EmbeddingService {
  private apiKey: string;
  private model: string;
  constructor(apiKey: string, model: string = "text-embedding-3-small") { this.apiKey = apiKey; this.model = model; }

  async embed(text: string): Promise<number[]> { return (await this.embedBatch([text]))[0]; }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ input: texts, model: this.model }),
    });
    if (!response.ok) throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
    const data = (await response.json()) as { data: { embedding: number[] }[] };
    return data.data.map(d => d.embedding);
  }
}
```

**Step 4: Run test, verify PASS:** `pnpm vitest run agent/src/memory/__tests__/embeddings.test.ts`

**Step 5: Commit:** `git add agent/src/memory/ && git commit -m "feat: add embedding service wrapping OpenAI API"`

---

## Task 2B.3: Vector Search (Cosine Similarity)

**Files:**
- Create: `agent/src/memory/vector-search.ts`
- Create: `agent/src/memory/__tests__/vector-search.test.ts`

**Step 1: Write the failing test**

Create `agent/src/memory/__tests__/vector-search.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { cosineSimilarity, embeddingToBuffer, bufferToEmbedding, VectorStore } from "../vector-search.js";
import { createMemoryDb } from "../db.js";
import Database from "better-sqlite3";

describe("cosineSimilarity", () => {
  it("returns 1.0 for identical vectors", () => { expect(cosineSimilarity([1,2,3], [1,2,3])).toBeCloseTo(1.0); });
  it("returns 0 for orthogonal vectors", () => { expect(cosineSimilarity([1,0], [0,1])).toBeCloseTo(0); });
  it("returns -1 for opposite vectors", () => { expect(cosineSimilarity([1,0], [-1,0])).toBeCloseTo(-1); });
});

describe("embedding buffer conversion", () => {
  it("roundtrips float32 correctly", () => {
    const original = [0.1, 0.2, 0.3, 0.4];
    const result = bufferToEmbedding(embeddingToBuffer(original));
    result.forEach((v, i) => expect(v).toBeCloseTo(original[i]));
  });
});

describe("VectorStore", () => {
  let db: Database.Database;
  afterEach(() => { db?.close(); });

  function setup() { db = createMemoryDb(":memory:"); return new VectorStore(db); }

  it("inserts entry with embedding", () => {
    const store = setup();
    store.insert({ id: "e1", content: "market rally", embedding: [0.1, 0.2, 0.3], source: "a", timestamp: 1, tags: ["market"] });
    const count = db.prepare("SELECT count(*) as c FROM entries").get() as { c: number };
    expect(count.c).toBe(1);
  });

  it("searches by cosine similarity top-K", () => {
    const store = setup();
    store.insert({ id: "e1", content: "tech rally", embedding: [1,0,0], source: "a", timestamp: 1, tags: [] });
    store.insert({ id: "e2", content: "crypto crash", embedding: [0,1,0], source: "a", timestamp: 2, tags: [] });
    store.insert({ id: "e3", content: "tech boom", embedding: [0.9,0.1,0], source: "a", timestamp: 3, tags: [] });
    const results = store.search([1,0,0], 2);
    expect(results).toHaveLength(2);
    expect(results[0].entry.id).toBe("e1");
    expect(results[0].score).toBeGreaterThan(results[1].score);
  });

  it("returns empty for no entries", () => { expect(setup().search([1,0,0], 5)).toHaveLength(0); });
});
```

**Step 2: Run test, verify FAIL:** `pnpm vitest run agent/src/memory/__tests__/vector-search.test.ts`

**Step 3: Implement `agent/src/memory/vector-search.ts`:**

```typescript
import type Database from "better-sqlite3";
import type { MemoryEntry, SearchResult } from "@finwatch/shared";

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]*b[i]; magA += a[i]*a[i]; magB += b[i]*b[i]; }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export function embeddingToBuffer(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

export function bufferToEmbedding(buf: Buffer): number[] {
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
}

export class VectorStore {
  private db: Database.Database;
  constructor(db: Database.Database) { this.db = db; }

  insert(entry: MemoryEntry): void {
    const embBuf = entry.embedding.length > 0 ? embeddingToBuffer(entry.embedding) : null;
    this.db.prepare("INSERT OR REPLACE INTO entries (id,content,embedding,source,timestamp,tags) VALUES (?,?,?,?,?,?)")
      .run(entry.id, entry.content, embBuf, entry.source, entry.timestamp, JSON.stringify(entry.tags));
  }

  search(queryEmbedding: number[], topK: number): SearchResult[] {
    const rows = this.db.prepare("SELECT id,content,embedding,source,timestamp,tags FROM entries WHERE embedding IS NOT NULL")
      .all() as { id: string; content: string; embedding: Buffer; source: string; timestamp: number; tags: string }[];
    return rows.map(row => {
      const embedding = bufferToEmbedding(row.embedding);
      return { entry: { id: row.id, content: row.content, embedding, source: row.source, timestamp: row.timestamp, tags: JSON.parse(row.tags) }, score: cosineSimilarity(queryEmbedding, embedding), matchType: "vector" as const };
    }).sort((a, b) => b.score - a.score).slice(0, topK);
  }
}
```

**Step 4: Run test, verify PASS:** `pnpm vitest run agent/src/memory/__tests__/vector-search.test.ts`

**Step 5: Commit:** `git add agent/src/memory/ && git commit -m "feat: add vector search with cosine similarity over SQLite"`

---

## Task 2B.4: Keyword Search (FTS5 BM25)

**Files:**
- Create: `agent/src/memory/keyword-search.ts`
- Create: `agent/src/memory/__tests__/keyword-search.test.ts`

**Step 1: Write the failing test**

Create `agent/src/memory/__tests__/keyword-search.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { KeywordStore } from "../keyword-search.js";
import { VectorStore } from "../vector-search.js";
import { createMemoryDb } from "../db.js";
import Database from "better-sqlite3";

describe("KeywordStore", () => {
  let db: Database.Database;
  afterEach(() => { db?.close(); });

  function seed() {
    db = createMemoryDb(":memory:");
    const vs = new VectorStore(db);
    const ks = new KeywordStore(db);
    vs.insert({ id: "e1", content: "AAPL stock price surged after earnings report", embedding: [0.1], source: "a", timestamp: 1, tags: ["stock"] });
    vs.insert({ id: "e2", content: "Bitcoin volume spike on weekend trading", embedding: [0.2], source: "a", timestamp: 2, tags: ["crypto"] });
    vs.insert({ id: "e3", content: "AAPL earnings beat expectations significantly", embedding: [0.3], source: "a", timestamp: 3, tags: ["stock"] });
    ks.syncFts();
    return ks;
  }

  it("returns results matching query terms", () => {
    const ks = seed();
    const results = ks.search("AAPL earnings", 10);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => r.matchType === "keyword")).toBe(true);
  });

  it("ranks relevant results higher", () => {
    const ks = seed();
    const ids = ks.search("AAPL earnings", 10).map(r => r.entry.id);
    expect(ids).toContain("e1");
    expect(ids).toContain("e3");
    expect(ids).not.toContain("e2");
  });

  it("returns empty for no matches", () => { expect(seed().search("nonexistent_xyz", 10)).toHaveLength(0); });
  it("respects topK limit", () => { expect(seed().search("AAPL", 1)).toHaveLength(1); });
});
```

**Step 2: Run test, verify FAIL:** `pnpm vitest run agent/src/memory/__tests__/keyword-search.test.ts`

**Step 3: Implement `agent/src/memory/keyword-search.ts`:**

```typescript
import type Database from "better-sqlite3";
import type { SearchResult } from "@finwatch/shared";

export class KeywordStore {
  private db: Database.Database;
  constructor(db: Database.Database) { this.db = db; }

  syncFts(): void {
    this.db.exec("DELETE FROM entries_fts");
    const rows = this.db.prepare("SELECT rowid, content, source, tags FROM entries").all() as { rowid: number; content: string; source: string; tags: string }[];
    const insert = this.db.prepare("INSERT INTO entries_fts(rowid, content, source, tags) VALUES (?,?,?,?)");
    this.db.transaction(() => { for (const row of rows) insert.run(row.rowid, row.content, row.source, row.tags); })();
  }

  search(query: string, topK: number): SearchResult[] {
    return (this.db.prepare(`
      SELECT e.id, e.content, e.source, e.timestamp, e.tags, rank * -1 as score
      FROM entries_fts fts JOIN entries e ON e.rowid = fts.rowid
      WHERE entries_fts MATCH ? ORDER BY rank LIMIT ?
    `).all(query, topK) as { id: string; content: string; source: string; timestamp: number; tags: string; score: number }[])
      .map(row => ({ entry: { id: row.id, content: row.content, embedding: [], source: row.source, timestamp: row.timestamp, tags: JSON.parse(row.tags) }, score: row.score, matchType: "keyword" as const }));
  }
}
```

**Step 4: Run test, verify PASS:** `pnpm vitest run agent/src/memory/__tests__/keyword-search.test.ts`

**Step 5: Commit:** `git add agent/src/memory/ && git commit -m "feat: add FTS5 keyword search with BM25 ranking"`

---

## Task 2B.5: Hybrid Search Merge

**Files:**
- Create: `agent/src/memory/hybrid-search.ts`
- Create: `agent/src/memory/__tests__/hybrid-search.test.ts`

**Step 1: Write the failing test**

Create `agent/src/memory/__tests__/hybrid-search.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { mergeHybridResults, HybridSearchConfig } from "../hybrid-search.js";
import type { SearchResult } from "@finwatch/shared";

function mr(id: string, score: number, mt: "vector"|"keyword"): SearchResult {
  return { entry: { id, content: `c-${id}`, embedding: [], source: "t", timestamp: 1, tags: [] }, score, matchType: mt };
}
const cfg: HybridSearchConfig = { vectorWeight: 0.7, textWeight: 0.3, maxResults: 6, minScore: 0.35 };

describe("mergeHybridResults", () => {
  it("combines with weighted scores", () => {
    const merged = mergeHybridResults([mr("a",0.9,"vector")], [mr("a",0.8,"keyword")], cfg);
    const a = merged.find(r => r.entry.id === "a")!;
    expect(a.score).toBeCloseTo(0.87); // 0.7*0.9 + 0.3*0.8
    expect(a.matchType).toBe("hybrid");
  });
  it("filters below minScore", () => { expect(mergeHybridResults([mr("a",0.3,"vector")], [], cfg)).toHaveLength(0); });
  it("respects maxResults", () => {
    const v = Array.from({length:10},(_,i) => mr(`v${i}`, 0.9-i*0.05, "vector"));
    expect(mergeHybridResults(v, [], {...cfg, maxResults:3})).toHaveLength(3);
  });
  it("sorts descending", () => {
    const m = mergeHybridResults([mr("a",0.5,"vector"),mr("b",0.9,"vector")], [mr("a",0.9,"keyword")], cfg);
    for (let i=1; i<m.length; i++) expect(m[i-1].score).toBeGreaterThanOrEqual(m[i].score);
  });
  it("handles empty inputs", () => { expect(mergeHybridResults([], [], cfg)).toHaveLength(0); });
});
```

**Step 2: Run test, verify FAIL:** `pnpm vitest run agent/src/memory/__tests__/hybrid-search.test.ts`

**Step 3: Implement `agent/src/memory/hybrid-search.ts`:**

```typescript
import type { SearchResult } from "@finwatch/shared";

export type HybridSearchConfig = { vectorWeight: number; textWeight: number; maxResults: number; minScore: number };

export function mergeHybridResults(vectorResults: SearchResult[], keywordResults: SearchResult[], config: HybridSearchConfig): SearchResult[] {
  const merged = new Map<string, { entry: SearchResult["entry"]; vs: number; ks: number }>();
  for (const r of vectorResults) merged.set(r.entry.id, { entry: r.entry, vs: r.score, ks: 0 });
  for (const r of keywordResults) {
    const e = merged.get(r.entry.id);
    if (e) e.ks = r.score; else merged.set(r.entry.id, { entry: r.entry, vs: 0, ks: r.score });
  }
  const results: SearchResult[] = [];
  for (const [, { entry, vs, ks }] of merged) {
    const score = config.vectorWeight * vs + config.textWeight * ks;
    if (score >= config.minScore) results.push({ entry, score, matchType: vs > 0 && ks > 0 ? "hybrid" : vs > 0 ? "vector" : "keyword" });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, config.maxResults);
}
```

**Step 4: Run test, verify PASS:** `pnpm vitest run agent/src/memory/__tests__/hybrid-search.test.ts`

**Step 5: Commit:** `git add agent/src/memory/ && git commit -m "feat: add hybrid search merging vector and keyword results"`

---

## Task 2B.6: Semantic Memory Store (Markdown Files)

**Files:**
- Create: `agent/src/memory/semantic-store.ts`
- Create: `agent/src/memory/__tests__/semantic-store.test.ts`

**Step 1: Write the failing test**

Create `agent/src/memory/__tests__/semantic-store.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { SemanticStore } from "../semantic-store.js";
import { createMemoryDb } from "../db.js";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let db: Database.Database; let tmpDir: string;
afterEach(() => { db?.close(); if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true }); });

describe("SemanticStore", () => {
  function setup() { db = createMemoryDb(":memory:"); tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fw-mem-")); return new SemanticStore(db, tmpDir); }

  it("flushes to markdown file", () => {
    const store = setup();
    store.flush("AAPL volume spike.", ["AAPL"]);
    const files = fs.readdirSync(tmpDir).filter(f => f.endsWith(".md"));
    expect(files.length).toBe(1);
    expect(fs.readFileSync(path.join(tmpDir, files[0]), "utf-8")).toContain("AAPL volume spike");
  });

  it("indexes in SQLite", () => {
    const store = setup();
    store.flush("Test content", ["test"]);
    expect((db.prepare("SELECT count(*) as c FROM entries").get() as { c: number }).c).toBe(1);
  });

  it("lists all by timestamp desc", () => {
    const store = setup();
    store.flush("First", ["a"]); store.flush("Second", ["b"]);
    const all = store.listAll();
    expect(all).toHaveLength(2);
    expect(all[0].timestamp).toBeGreaterThanOrEqual(all[1].timestamp);
  });
});
```

**Step 2: Run test, verify FAIL:** `pnpm vitest run agent/src/memory/__tests__/semantic-store.test.ts`

**Step 3: Implement `agent/src/memory/semantic-store.ts`:**

```typescript
import type Database from "better-sqlite3";
import type { MemoryEntry } from "@finwatch/shared";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export class SemanticStore {
  private db: Database.Database;
  private memoryDir: string;
  constructor(db: Database.Database, memoryDir: string) { this.db = db; this.memoryDir = memoryDir; fs.mkdirSync(memoryDir, { recursive: true }); }

  flush(summary: string, tags: string[]): string {
    const id = crypto.randomUUID();
    const dateStr = new Date().toISOString().slice(0, 13).replace("T", "-");
    const filename = `${dateStr}-${id.slice(0, 8)}.md`;
    fs.writeFileSync(path.join(this.memoryDir, filename), `# Memory: ${dateStr}\n\nTags: ${tags.join(", ")}\n\n${summary}\n`, "utf-8");
    this.db.prepare("INSERT INTO entries (id,content,embedding,source,timestamp,tags) VALUES (?,?,NULL,?,?,?)")
      .run(id, summary, `file:${filename}`, Date.now(), JSON.stringify(tags));
    return id;
  }

  listAll(): MemoryEntry[] {
    return (this.db.prepare("SELECT id,content,source,timestamp,tags FROM entries ORDER BY timestamp DESC").all() as any[])
      .map(r => ({ id: r.id, content: r.content, embedding: [], source: r.source, timestamp: r.timestamp, tags: JSON.parse(r.tags) }));
  }
}
```

**Step 4: Run test, verify PASS:** `pnpm vitest run agent/src/memory/__tests__/semantic-store.test.ts`

**Step 5: Commit:** `git add agent/src/memory/ && git commit -m "feat: add semantic memory store with markdown flush"`

---

## Task 2B.7: Domain Knowledge Tables (CRUD)

**Files:**
- Create: `agent/src/memory/domain-knowledge.ts`
- Create: `agent/src/memory/__tests__/domain-knowledge.test.ts`

**Step 1: Write the failing test**

Create `agent/src/memory/__tests__/domain-knowledge.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { DomainKnowledgeStore } from "../domain-knowledge.js";
import { createDomainDb } from "../db.js";
import Database from "better-sqlite3";

let db: Database.Database;
afterEach(() => { db?.close(); });
function setup() { db = createDomainDb(":memory:"); return new DomainKnowledgeStore(db); }

describe("DomainKnowledgeStore", () => {
  it("inserts and retrieves pattern", () => {
    const s = setup();
    s.upsertPattern({ id: "p1", pattern: "volume spike before earnings", confidence: 0.8, source: "a", createdAt: 1, updatedAt: 1 });
    expect(s.getPatterns()).toHaveLength(1);
  });

  it("updates on upsert", () => {
    const s = setup();
    s.upsertPattern({ id: "p1", pattern: "old", confidence: 0.5, source: "a", createdAt: 1, updatedAt: 1 });
    s.upsertPattern({ id: "p1", pattern: "new", confidence: 0.9, source: "a", createdAt: 1, updatedAt: 2 });
    const p = s.getPatterns();
    expect(p).toHaveLength(1); expect(p[0].confidence).toBe(0.9);
  });

  it("CRUD correlations", () => {
    const s = setup();
    s.upsertCorrelation({ id: "c1", sourceA: "yahoo", sourceB: "binance", rule: "BTC leads COIN", confidence: 0.7, createdAt: 1 });
    expect(s.getCorrelations()).toHaveLength(1);
    s.deleteCorrelation("c1");
    expect(s.getCorrelations()).toHaveLength(0);
  });

  it("CRUD thresholds", () => {
    const s = setup();
    s.upsertThreshold({ id: "t1", source: "yahoo", metric: "volume", value: 5e6, direction: "above", updatedAt: 1 });
    expect(s.getThresholds()).toHaveLength(1);
    expect(s.getThresholds()[0].direction).toBe("above");
  });

  it("filters patterns by min confidence", () => {
    const s = setup();
    s.upsertPattern({ id: "p1", pattern: "low", confidence: 0.2, source: "a", createdAt: 1, updatedAt: 1 });
    s.upsertPattern({ id: "p2", pattern: "high", confidence: 0.8, source: "a", createdAt: 1, updatedAt: 1 });
    expect(s.getPatterns(0.5)).toHaveLength(1);
  });
});
```

**Step 2: Run test, verify FAIL:** `pnpm vitest run agent/src/memory/__tests__/domain-knowledge.test.ts`

**Step 3: Implement `agent/src/memory/domain-knowledge.ts`:**

```typescript
import type Database from "better-sqlite3";
import type { DomainPattern, DomainCorrelation, DomainThreshold } from "@finwatch/shared";

export class DomainKnowledgeStore {
  private db: Database.Database;
  constructor(db: Database.Database) { this.db = db; }

  upsertPattern(p: DomainPattern): void {
    this.db.prepare("INSERT INTO patterns (id,pattern,confidence,source,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET pattern=?,confidence=?,updated_at=?")
      .run(p.id, p.pattern, p.confidence, p.source, p.createdAt, p.updatedAt, p.pattern, p.confidence, p.updatedAt);
  }

  getPatterns(minConfidence = 0): DomainPattern[] {
    return (this.db.prepare("SELECT id,pattern,confidence,source,created_at,updated_at FROM patterns WHERE confidence>=? ORDER BY confidence DESC").all(minConfidence) as any[])
      .map(r => ({ id: r.id, pattern: r.pattern, confidence: r.confidence, source: r.source, createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  upsertCorrelation(c: DomainCorrelation): void {
    this.db.prepare("INSERT INTO correlations (id,source_a,source_b,rule,confidence,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET rule=?,confidence=?")
      .run(c.id, c.sourceA, c.sourceB, c.rule, c.confidence, c.createdAt, c.rule, c.confidence);
  }

  getCorrelations(): DomainCorrelation[] {
    return (this.db.prepare("SELECT id,source_a,source_b,rule,confidence,created_at FROM correlations").all() as any[])
      .map(r => ({ id: r.id, sourceA: r.source_a, sourceB: r.source_b, rule: r.rule, confidence: r.confidence, createdAt: r.created_at }));
  }

  deleteCorrelation(id: string): void { this.db.prepare("DELETE FROM correlations WHERE id=?").run(id); }

  upsertThreshold(t: DomainThreshold): void {
    this.db.prepare("INSERT INTO thresholds (id,source,metric,value,direction,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET value=?,direction=?,updated_at=?")
      .run(t.id, t.source, t.metric, t.value, t.direction, t.updatedAt, t.value, t.direction, t.updatedAt);
  }

  getThresholds(): DomainThreshold[] {
    return (this.db.prepare("SELECT id,source,metric,value,direction,updated_at FROM thresholds").all() as any[])
      .map(r => ({ id: r.id, source: r.source, metric: r.metric, value: r.value, direction: r.direction, updatedAt: r.updated_at }));
  }
}
```

**Step 4: Run test, verify PASS:** `pnpm vitest run agent/src/memory/__tests__/domain-knowledge.test.ts`

**Step 5: Commit:** `git add agent/src/memory/ && git commit -m "feat: add domain knowledge CRUD for patterns, correlations, thresholds"`

---

## Task 2B.8: Auto-Recall Hook

**Files:**
- Create: `agent/src/memory/auto-recall.ts`
- Create: `agent/src/memory/__tests__/auto-recall.test.ts`

**Step 1: Write the failing test**

Create `agent/src/memory/__tests__/auto-recall.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { buildRecallContext } from "../auto-recall.js";
import type { SearchResult, DomainPattern, DomainThreshold } from "@finwatch/shared";

const mockSearch = vi.fn<(q: string) => SearchResult[]>();
const mockPatterns = vi.fn<() => DomainPattern[]>();
const mockThresholds = vi.fn<() => DomainThreshold[]>();
const sources = { search: mockSearch, getPatterns: mockPatterns, getThresholds: mockThresholds };
const cfg = { maxMemoryResults: 3, maxPatterns: 5, maxThresholds: 5 };

describe("buildRecallContext", () => {
  it("includes memory results", () => {
    mockSearch.mockReturnValue([{ entry: { id: "e1", content: "AAPL spike", embedding: [], source: "a", timestamp: 1, tags: [] }, score: 0.8, matchType: "hybrid" }]);
    mockPatterns.mockReturnValue([]); mockThresholds.mockReturnValue([]);
    const ctx = buildRecallContext("AAPL", sources, cfg);
    expect(ctx).toContain("AAPL spike");
    expect(ctx).toContain("<relevant-context>");
  });

  it("includes patterns", () => {
    mockSearch.mockReturnValue([]); mockThresholds.mockReturnValue([]);
    mockPatterns.mockReturnValue([{ id: "p1", pattern: "earnings cause spikes", confidence: 0.9, source: "a", createdAt: 1, updatedAt: 1 }]);
    expect(buildRecallContext("test", sources, cfg)).toContain("earnings cause spikes");
  });

  it("includes thresholds", () => {
    mockSearch.mockReturnValue([]); mockPatterns.mockReturnValue([]);
    mockThresholds.mockReturnValue([{ id: "t1", source: "yahoo", metric: "volume", value: 5e6, direction: "above", updatedAt: 1 }]);
    expect(buildRecallContext("test", sources, cfg)).toContain("5000000");
  });

  it("returns fallback when empty", () => {
    mockSearch.mockReturnValue([]); mockPatterns.mockReturnValue([]); mockThresholds.mockReturnValue([]);
    expect(buildRecallContext("test", sources, cfg)).toContain("No prior context");
  });
});
```

**Step 2: Run test, verify FAIL:** `pnpm vitest run agent/src/memory/__tests__/auto-recall.test.ts`

**Step 3: Implement `agent/src/memory/auto-recall.ts`:**

```typescript
import type { SearchResult, DomainPattern, DomainThreshold } from "@finwatch/shared";

export type AutoRecallConfig = { maxMemoryResults: number; maxPatterns: number; maxThresholds: number };
export type RecallSources = { search: (q: string) => SearchResult[]; getPatterns: () => DomainPattern[]; getThresholds: () => DomainThreshold[] };

export function buildRecallContext(query: string, sources: RecallSources, config: AutoRecallConfig): string {
  const memories = sources.search(query).slice(0, config.maxMemoryResults);
  const patterns = sources.getPatterns().slice(0, config.maxPatterns);
  const thresholds = sources.getThresholds().slice(0, config.maxThresholds);
  const sections: string[] = [];
  if (memories.length > 0) sections.push("## Relevant Memories\n" + memories.map(m => `- [${m.score.toFixed(2)}] ${m.entry.content}`).join("\n"));
  if (patterns.length > 0) sections.push("## Known Patterns\n" + patterns.map(p => `- [${p.confidence.toFixed(2)}] ${p.pattern}`).join("\n"));
  if (thresholds.length > 0) sections.push("## Active Thresholds\n" + thresholds.map(t => `- ${t.source}/${t.metric}: ${t.direction} ${t.value}`).join("\n"));
  return `<relevant-context>\n${sections.length > 0 ? sections.join("\n\n") : "No prior context found."}\n</relevant-context>`;
}
```

**Step 4: Run test, verify PASS:** `pnpm vitest run agent/src/memory/__tests__/auto-recall.test.ts`

**Step 5: Commit:** `git add agent/src/memory/ && git commit -m "feat: add auto-recall hook for context injection"`

---

## Task 2B.9: Auto-Capture Hook

**Files:**
- Create: `agent/src/memory/auto-capture.ts`
- Create: `agent/src/memory/__tests__/auto-capture.test.ts`

**Step 1: Write the failing test**

Create `agent/src/memory/__tests__/auto-capture.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { extractKnowledge } from "../auto-capture.js";

const cfg = { maxUpdatesPerTurn: 5, dedupThreshold: 0.9 };

describe("extractKnowledge", () => {
  it("extracts patterns from response", () => {
    const r = extractKnowledge("Observation: AAPL volume spikes consistently before earnings.", cfg);
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(5);
  });

  it("respects max limit", () => {
    const r = extractKnowledge(Array(20).fill("Pattern: new thing detected in data.").join("\n"), { ...cfg, maxUpdatesPerTurn: 3 });
    expect(r.length).toBeLessThanOrEqual(3);
  });

  it("extracts typed facts", () => {
    const r = extractKnowledge("Threshold recommendation: flag AAPL if volume exceeds 5M.\nCorrelation: BTC price leads COIN stock.", cfg);
    expect(r.some(x => x.type === "threshold" || x.type === "correlation")).toBe(true);
  });

  it("returns empty for uninformative response", () => {
    expect(extractKnowledge("No anomalies detected. Everything looks normal.", cfg)).toHaveLength(0);
  });
});
```

**Step 2: Run test, verify FAIL:** `pnpm vitest run agent/src/memory/__tests__/auto-capture.test.ts`

**Step 3: Implement `agent/src/memory/auto-capture.ts`:**

```typescript
export type AutoCaptureConfig = { maxUpdatesPerTurn: number; dedupThreshold: number };
export type ExtractedKnowledge = { type: "pattern" | "threshold" | "correlation" | "observation"; content: string; confidence: number };

const PATTERN_RE = [/pattern[:\s]+(.+)/gi, /observation[:\s]+(.+)/gi, /(?:consistently|always|typically)\s+(.+)/gi];
const THRESHOLD_RE = [/threshold[:\s]+(.+)/gi, /(?:flag|alert)\s+(?:if|when)\s+(.+)/gi];
const CORRELATION_RE = [/correlat(?:es?|ion)[:\s]+(.+)/gi, /(\w+)\s+(?:leads?|follows?|predicts?)\s+(.+)/gi];

function extract(text: string, regexes: RegExp[], type: ExtractedKnowledge["type"], conf: number): ExtractedKnowledge[] {
  const out: ExtractedKnowledge[] = [];
  for (const re of regexes) {
    re.lastIndex = 0;
    let m; while ((m = re.exec(text)) !== null) {
      const c = (m[1] ?? m[0]).trim();
      if (c.length > 10) out.push({ type, content: c, confidence: conf });
    }
  }
  return out;
}

export function extractKnowledge(response: string, config: AutoCaptureConfig): ExtractedKnowledge[] {
  const all = [...extract(response, PATTERN_RE, "pattern", 0.6), ...extract(response, THRESHOLD_RE, "threshold", 0.7), ...extract(response, CORRELATION_RE, "correlation", 0.5)];
  const unique: ExtractedKnowledge[] = [];
  for (const item of all) { if (!unique.some(e => e.content.includes(item.content) || item.content.includes(e.content))) unique.push(item); }
  return unique.slice(0, config.maxUpdatesPerTurn);
}
```

**Step 4: Run test, verify PASS:** `pnpm vitest run agent/src/memory/__tests__/auto-capture.test.ts`

**Step 5: Commit:** `git add agent/src/memory/ && git commit -m "feat: add auto-capture hook for knowledge extraction"`

---

## Final Verification

```bash
pnpm vitest run agent/src/memory/
```

Expected: ALL PASS across all 7 test files (~40 tests).

Write COMPLETION.md and commit:

```bash
git add -A && git commit -m "docs: add completion summary"
```
