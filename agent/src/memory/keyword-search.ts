import type Database from "better-sqlite3";
import type { SearchResult } from "@finwatch/shared";

export class KeywordStore {
  private db: Database.Database;
  constructor(db: Database.Database) { this.db = db; }

  syncFts(): void {
    this.db.exec("DELETE FROM entries_fts");
    const rows = this.db.prepare("SELECT rowid, content, source, tags FROM entries").all() as { rowid: number; content: string; source: string; tags: string }[];
    const insert = this.db.prepare("INSERT INTO entries_fts(rowid, content, source, tags) VALUES (?,?,?,?)");
    this.db.transaction(() => { for (const row of rows) insert.run(row.rowid, row.content, row.source, row.tags); })();
  }

  search(query: string, topK: number): SearchResult[] {
    return (this.db.prepare(`
      SELECT e.id, e.content, e.source, e.timestamp, e.tags, rank * -1 as score
      FROM entries_fts fts JOIN entries e ON e.rowid = fts.rowid
      WHERE entries_fts MATCH ? ORDER BY rank LIMIT ?
    `).all(query, topK) as { id: string; content: string; source: string; timestamp: number; tags: string; score: number }[])
      .map(row => ({ entry: { id: row.id, content: row.content, embedding: [], source: row.source, timestamp: row.timestamp, tags: JSON.parse(row.tags) as string[] }, score: row.score, matchType: "keyword" as const }));
  }
}
