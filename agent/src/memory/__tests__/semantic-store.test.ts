import { describe, it, expect, vi, afterEach } from "vitest";
import { SemanticStore } from "../semantic-store.js";
import { createMemoryDb } from "../db.js";
import { bufferToEmbedding } from "../vector-search.js";
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
    expect(fs.readFileSync(path.join(tmpDir, files[0]!), "utf-8")).toContain("AAPL volume spike");
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
    expect(all[0]!.timestamp).toBeGreaterThanOrEqual(all[1]!.timestamp);
  });

  it("stores embedding=NULL when no EmbeddingService provided", () => {
    const store = setup();
    store.flush("No embeddings", ["test"]);
    const row = db.prepare("SELECT embedding FROM entries LIMIT 1").get() as { embedding: Buffer | null };
    expect(row.embedding).toBeNull();
  });

  it("fires async embedding generation when EmbeddingService provided", async () => {
    const localDb = createMemoryDb(":memory:");
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "fw-emb-"));
    try {
      const fakeEmbedding = [0.1, 0.2, 0.3];
      const mockService = {
        embed: vi.fn().mockResolvedValue(fakeEmbedding),
        embedBatch: vi.fn(),
      };

      const store = new SemanticStore(localDb, localDir, mockService);
      const id = store.flush("Generate embedding for this", ["test"]);

      // Wait for the fire-and-forget to complete
      await vi.waitFor(() => {
        expect(mockService.embed).toHaveBeenCalledWith("Generate embedding for this");
      });

      // Wait for DB update
      await vi.waitFor(() => {
        const row = localDb.prepare("SELECT embedding FROM entries WHERE id = ?").get(id) as { embedding: Buffer | null };
        expect(row.embedding).not.toBeNull();
      });

      const row = localDb.prepare("SELECT embedding FROM entries WHERE id = ?").get(id) as { embedding: Buffer };
      const stored = bufferToEmbedding(row.embedding);
      expect(stored).toHaveLength(fakeEmbedding.length);
      for (let i = 0; i < fakeEmbedding.length; i++) {
        expect(stored[i]).toBeCloseTo(fakeEmbedding[i]!, 5);
      }
    } finally {
      localDb.close();
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });

  it("does not block flush when embedding generation fails", async () => {
    const localDb = createMemoryDb(":memory:");
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), "fw-emb-"));
    try {
      const mockService = {
        embed: vi.fn().mockRejectedValue(new Error("API down")),
        embedBatch: vi.fn(),
      };

      const store = new SemanticStore(localDb, localDir, mockService);
      const id = store.flush("Should not block", ["test"]);

      // flush() returned synchronously with an id
      expect(id).toBeDefined();
      expect(id.length).toBeGreaterThan(0);

      // Wait for the fire-and-forget to complete (even though it fails)
      await vi.waitFor(() => {
        expect(mockService.embed).toHaveBeenCalled();
      });

      // Small delay for the catch handler to run
      await new Promise(r => setTimeout(r, 10));

      // Embedding should still be NULL since it failed
      const row = localDb.prepare("SELECT embedding FROM entries WHERE id = ?").get(id) as { embedding: Buffer | null };
      expect(row.embedding).toBeNull();
    } finally {
      localDb.close();
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });
});
