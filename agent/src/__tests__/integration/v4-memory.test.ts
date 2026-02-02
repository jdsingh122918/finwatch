// agent/src/__tests__/integration/v4-memory.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { createMemoryDb } from "../../memory/db.js";
import { VectorStore } from "../../memory/vector-search.js";
import { KeywordStore } from "../../memory/keyword-search.js";
import { mergeHybridResults } from "../../memory/hybrid-search.js";
import { buildRecallContext } from "../../memory/auto-recall.js";
import type {
  MemoryEntry,
  DomainPattern,
  DomainThreshold,
  SearchResult,
} from "@finwatch/shared";

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
      {
        id: "m1",
        content: "AAPL had a 10% price spike on 2024-01-15 during earnings",
        embedding: fakeEmbedding(1),
        source: "analysis",
        timestamp: Date.now(),
        tags: ["AAPL", "earnings"],
      },
      {
        id: "m2",
        content: "GOOGL dropped 5% after antitrust ruling",
        embedding: fakeEmbedding(2),
        source: "analysis",
        timestamp: Date.now(),
        tags: ["GOOGL", "antitrust"],
      },
      {
        id: "m3",
        content:
          "Market-wide volume spike correlates with Fed announcements",
        embedding: fakeEmbedding(3),
        source: "analysis",
        timestamp: Date.now(),
        tags: ["macro", "volume"],
      },
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
      {
        id: "p1",
        pattern: "AAPL spikes on earnings",
        confidence: 0.85,
        source: "learning",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ];
    const thresholds: DomainThreshold[] = [
      {
        id: "t1",
        source: "yahoo",
        metric: "price",
        value: 3.0,
        direction: "above",
        updatedAt: Date.now(),
      },
    ];

    const context = buildRecallContext(
      "AAPL earnings",
      {
        search: (q: string): SearchResult[] => keywordStore.search(q, 3),
        getPatterns: () => patterns,
        getThresholds: () => thresholds,
      },
      { maxMemoryResults: 3, maxPatterns: 5, maxThresholds: 5 },
    );

    expect(context).toContain("AAPL");
    expect(context).toContain("earnings");
    expect(context).toContain("3"); // threshold value
  });
});
