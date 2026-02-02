import Database from "better-sqlite3";

export function createMemoryDb(path: string): Database.Database {
  const db = new Database(path);
  if (path !== ":memory:") db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id TEXT PRIMARY KEY, content TEXT NOT NULL, embedding BLOB,
      source TEXT NOT NULL, timestamp INTEGER NOT NULL,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_entries_timestamp ON entries(timestamp);
    CREATE INDEX IF NOT EXISTS idx_entries_source ON entries(source);
    CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(content, source, tags, content_rowid='rowid');
  `);
  return db;
}

export function createDomainDb(path: string): Database.Database {
  const db = new Database(path);
  if (path !== ":memory:") db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS patterns (
      id TEXT PRIMARY KEY, pattern TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0.5,
      source TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS correlations (
      id TEXT PRIMARY KEY, source_a TEXT NOT NULL, source_b TEXT NOT NULL,
      rule TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0.5, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS thresholds (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, metric TEXT NOT NULL, value REAL NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('above','below')), updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS seasonal (
      id TEXT PRIMARY KEY, pattern TEXT NOT NULL, period TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS feedback_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, anomaly_id TEXT NOT NULL, verdict TEXT NOT NULL,
      note TEXT, timestamp INTEGER NOT NULL, processed INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}
