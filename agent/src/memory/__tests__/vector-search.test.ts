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
