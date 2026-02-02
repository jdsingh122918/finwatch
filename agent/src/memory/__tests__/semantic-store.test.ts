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
});
