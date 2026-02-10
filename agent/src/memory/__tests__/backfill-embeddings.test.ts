import { describe, it, expect, vi, afterEach } from "vitest";
import { backfillEmbeddings } from "../backfill-embeddings.js";
import { createMemoryDb } from "../db.js";
import { bufferToEmbedding, embeddingToBuffer } from "../vector-search.js";
import Database from "better-sqlite3";

let db: Database.Database;
afterEach(() => { db?.close(); });

describe("backfillEmbeddings", () => {
  function setup() {
    db = createMemoryDb(":memory:");
    return db;
  }

  it("updates rows with NULL embeddings", async () => {
    const db = setup();

    // Insert entries with NULL embeddings
    db.prepare("INSERT INTO entries (id,content,embedding,source,timestamp,tags) VALUES (?,?,NULL,?,?,?)")
      .run("e1", "AAPL volume spike", "test", Date.now(), '["AAPL"]');
    db.prepare("INSERT INTO entries (id,content,embedding,source,timestamp,tags) VALUES (?,?,NULL,?,?,?)")
      .run("e2", "GOOG price drop", "test", Date.now(), '["GOOG"]');

    const mockService = {
      embed: vi.fn()
        .mockResolvedValueOnce([0.1, 0.2])
        .mockResolvedValueOnce([0.3, 0.4]),
      embedBatch: vi.fn(),
    };

    const count = await backfillEmbeddings(db, mockService);

    expect(count).toBe(2);
    expect(mockService.embed).toHaveBeenCalledTimes(2);

    const row1 = db.prepare("SELECT embedding FROM entries WHERE id = ?").get("e1") as { embedding: Buffer };
    const emb1 = bufferToEmbedding(row1.embedding);
    expect(emb1).toHaveLength(2);
    expect(emb1[0]).toBeCloseTo(0.1, 5);
    expect(emb1[1]).toBeCloseTo(0.2, 5);

    const row2 = db.prepare("SELECT embedding FROM entries WHERE id = ?").get("e2") as { embedding: Buffer };
    const emb2 = bufferToEmbedding(row2.embedding);
    expect(emb2).toHaveLength(2);
    expect(emb2[0]).toBeCloseTo(0.3, 5);
    expect(emb2[1]).toBeCloseTo(0.4, 5);
  });

  it("skips rows that already have embeddings", async () => {
    const db = setup();

    // Insert one with embedding, one without
    db.prepare("INSERT INTO entries (id,content,embedding,source,timestamp,tags) VALUES (?,?,?,?,?,?)")
      .run("e1", "Has embedding", embeddingToBuffer([0.5, 0.6]), "test", Date.now(), '[]');
    db.prepare("INSERT INTO entries (id,content,embedding,source,timestamp,tags) VALUES (?,?,NULL,?,?,?)")
      .run("e2", "Needs embedding", "test", Date.now(), '[]');

    const mockService = {
      embed: vi.fn().mockResolvedValue([0.7, 0.8]),
      embedBatch: vi.fn(),
    };

    const count = await backfillEmbeddings(db, mockService);

    expect(count).toBe(1);
    expect(mockService.embed).toHaveBeenCalledTimes(1);
    expect(mockService.embed).toHaveBeenCalledWith("Needs embedding");
  });

  it("returns 0 when no NULL embeddings exist", async () => {
    const db = setup();

    db.prepare("INSERT INTO entries (id,content,embedding,source,timestamp,tags) VALUES (?,?,?,?,?,?)")
      .run("e1", "Has embedding", embeddingToBuffer([0.1]), "test", Date.now(), '[]');

    const mockService = {
      embed: vi.fn(),
      embedBatch: vi.fn(),
    };

    const count = await backfillEmbeddings(db, mockService);

    expect(count).toBe(0);
    expect(mockService.embed).not.toHaveBeenCalled();
  });

  it("continues on individual embedding failures", async () => {
    const db = setup();

    db.prepare("INSERT INTO entries (id,content,embedding,source,timestamp,tags) VALUES (?,?,NULL,?,?,?)")
      .run("e1", "Will fail", "test", Date.now(), '[]');
    db.prepare("INSERT INTO entries (id,content,embedding,source,timestamp,tags) VALUES (?,?,NULL,?,?,?)")
      .run("e2", "Will succeed", "test", Date.now(), '[]');

    const mockService = {
      embed: vi.fn()
        .mockRejectedValueOnce(new Error("API error"))
        .mockResolvedValueOnce([0.9, 1.0]),
      embedBatch: vi.fn(),
    };

    const count = await backfillEmbeddings(db, mockService);

    // Only the successful one counts
    expect(count).toBe(1);

    const row1 = db.prepare("SELECT embedding FROM entries WHERE id = ?").get("e1") as { embedding: Buffer | null };
    expect(row1.embedding).toBeNull();

    const row2 = db.prepare("SELECT embedding FROM entries WHERE id = ?").get("e2") as { embedding: Buffer };
    const emb = bufferToEmbedding(row2.embedding);
    expect(emb).toHaveLength(2);
    expect(emb[0]).toBeCloseTo(0.9, 5);
    expect(emb[1]).toBeCloseTo(1.0, 5);
  });
});
