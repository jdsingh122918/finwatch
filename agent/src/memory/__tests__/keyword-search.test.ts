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
