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
