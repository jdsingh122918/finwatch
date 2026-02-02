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
    expect(p).toHaveLength(1); expect(p[0]!.confidence).toBe(0.9);
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
    expect(s.getThresholds()[0]!.direction).toBe("above");
  });

  it("filters patterns by min confidence", () => {
    const s = setup();
    s.upsertPattern({ id: "p1", pattern: "low", confidence: 0.2, source: "a", createdAt: 1, updatedAt: 1 });
    s.upsertPattern({ id: "p2", pattern: "high", confidence: 0.8, source: "a", createdAt: 1, updatedAt: 1 });
    expect(s.getPatterns(0.5)).toHaveLength(1);
  });
});
