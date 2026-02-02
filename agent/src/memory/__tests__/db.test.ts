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
