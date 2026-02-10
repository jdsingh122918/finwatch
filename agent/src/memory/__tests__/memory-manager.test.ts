import { describe, it, expect, vi, afterEach } from "vitest";
import { MemoryManager } from "../memory-manager.js";
import { createMemoryDb } from "../db.js";
import { bufferToEmbedding, embeddingToBuffer } from "../vector-search.js";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let db: Database.Database;
let tmpDir: string;
afterEach(() => {
  db?.close();
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

function setup(embeddingService?: { embed: ReturnType<typeof vi.fn> }) {
  db = createMemoryDb(":memory:");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fw-mgr-"));
  return new MemoryManager(db, tmpDir, embeddingService);
}

describe("MemoryManager", () => {
  it("stores a memory entry and retrieves it", () => {
    const mgr = setup();
    mgr.store("AAPL volume spike detected", ["AAPL", "volume"]);
    const all = mgr.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.content).toBe("AAPL volume spike detected");
  });

  it("generates embeddings when service is provided", async () => {
    const mockService = {
      embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    };
    const mgr = setup(mockService);
    const id = mgr.store("Test embedding generation", ["test"]);

    await vi.waitFor(() => {
      expect(mockService.embed).toHaveBeenCalledWith("Test embedding generation");
    });

    await vi.waitFor(() => {
      const row = db.prepare("SELECT embedding FROM entries WHERE id = ?").get(id) as { embedding: Buffer | null };
      expect(row.embedding).not.toBeNull();
    });

    const row = db.prepare("SELECT embedding FROM entries WHERE id = ?").get(id) as { embedding: Buffer };
    const stored = bufferToEmbedding(row.embedding);
    expect(stored[0]).toBeCloseTo(0.1, 5);
  });

  it("performs keyword search", () => {
    const mgr = setup();
    mgr.store("AAPL had a massive volume spike", ["AAPL"]);
    mgr.store("GOOG earnings beat expectations", ["GOOG"]);
    mgr.syncSearch();

    const results = mgr.searchKeyword("volume spike", 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]!.entry.content).toContain("volume spike");
  });

  it("performs vector search when embeddings exist", () => {
    const mgr = setup();
    db.prepare("INSERT INTO entries (id,content,embedding,source,timestamp,tags) VALUES (?,?,?,?,?,?)")
      .run("v1", "tech rally", embeddingToBuffer([1, 0, 0]), "test", Date.now(), '["tech"]');
    db.prepare("INSERT INTO entries (id,content,embedding,source,timestamp,tags) VALUES (?,?,?,?,?,?)")
      .run("v2", "crypto crash", embeddingToBuffer([0, 1, 0]), "test", Date.now(), '["crypto"]');

    const results = mgr.searchVector([1, 0, 0], 2);
    expect(results).toHaveLength(2);
    expect(results[0]!.entry.id).toBe("v1");
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
  });

  it("performs hybrid search combining vector and keyword results", () => {
    const mgr = setup();
    db.prepare("INSERT INTO entries (id,content,embedding,source,timestamp,tags) VALUES (?,?,?,?,?,?)")
      .run("h1", "massive volume spike in tech stocks", embeddingToBuffer([0.9, 0.1, 0]), "test", Date.now(), '["tech"]');
    db.prepare("INSERT INTO entries (id,content,embedding,source,timestamp,tags) VALUES (?,?,?,?,?,?)")
      .run("h2", "crypto market is crashing", embeddingToBuffer([0, 0.9, 0.1]), "test", Date.now(), '["crypto"]');
    mgr.syncSearch();

    const results = mgr.searchHybrid("volume spike", [0.9, 0.1, 0], 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("builds context string for cycle runner", () => {
    const mgr = setup();
    mgr.store("Previous AAPL anomaly detected at high volume", ["AAPL"]);
    mgr.syncSearch();

    const context = mgr.buildContext("AAPL volume");
    expect(context).toContain("relevant-context");
  });

  it("runs backfill when embedding service is available", async () => {
    const mockService = {
      embed: vi.fn().mockResolvedValue([0.5, 0.6]),
    };
    const mgr = setup(mockService);

    db.prepare("INSERT INTO entries (id,content,embedding,source,timestamp,tags) VALUES (?,?,NULL,?,?,?)")
      .run("bf1", "Backfill this entry", "test", Date.now(), '[]');

    const count = await mgr.backfill();
    expect(count).toBe(1);
    expect(mockService.embed).toHaveBeenCalledWith("Backfill this entry");

    const row = db.prepare("SELECT embedding FROM entries WHERE id = ?").get("bf1") as { embedding: Buffer | null };
    expect(row.embedding).not.toBeNull();
  });

  it("backfill returns 0 when no embedding service", async () => {
    const mgr = setup();
    db.prepare("INSERT INTO entries (id,content,embedding,source,timestamp,tags) VALUES (?,?,NULL,?,?,?)")
      .run("bf1", "No service", "test", Date.now(), '[]');

    const count = await mgr.backfill();
    expect(count).toBe(0);
  });
});
