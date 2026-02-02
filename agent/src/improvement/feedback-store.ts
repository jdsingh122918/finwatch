import type Database from "better-sqlite3";
import type { AnomalyFeedback, FeedbackVerdict } from "@finwatch/shared";

export class FeedbackStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS feedback_log (
        anomaly_id TEXT PRIMARY KEY,
        verdict TEXT NOT NULL,
        note TEXT,
        timestamp INTEGER NOT NULL,
        processed INTEGER NOT NULL DEFAULT 0
      )
    `);
  }

  insert(feedback: AnomalyFeedback): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO feedback_log (anomaly_id, verdict, note, timestamp, processed)
       VALUES (?, ?, ?, ?, 0)`
    ).run(feedback.anomalyId, feedback.verdict, feedback.note ?? null, feedback.timestamp);
  }

  getAll(): AnomalyFeedback[] {
    const rows = this.db.prepare("SELECT * FROM feedback_log ORDER BY timestamp").all() as any[];
    return rows.map((r) => ({
      anomalyId: r.anomaly_id,
      verdict: r.verdict as FeedbackVerdict,
      note: r.note ?? undefined,
      timestamp: r.timestamp,
    }));
  }

  getUnprocessed(): AnomalyFeedback[] {
    const rows = this.db.prepare("SELECT * FROM feedback_log WHERE processed = 0 ORDER BY timestamp").all() as any[];
    return rows.map((r) => ({
      anomalyId: r.anomaly_id,
      verdict: r.verdict as FeedbackVerdict,
      note: r.note ?? undefined,
      timestamp: r.timestamp,
    }));
  }

  unprocessedCount(): number {
    const row = this.db.prepare("SELECT COUNT(*) as count FROM feedback_log WHERE processed = 0").get() as any;
    return row.count;
  }

  markProcessed(anomalyIds: string[]): void {
    const stmt = this.db.prepare("UPDATE feedback_log SET processed = 1 WHERE anomaly_id = ?");
    const tx = this.db.transaction(() => {
      for (const id of anomalyIds) stmt.run(id);
    });
    tx();
  }

  getByVerdict(verdict: FeedbackVerdict): AnomalyFeedback[] {
    const rows = this.db.prepare("SELECT * FROM feedback_log WHERE verdict = ? ORDER BY timestamp").all(verdict) as any[];
    return rows.map((r) => ({
      anomalyId: r.anomaly_id,
      verdict: r.verdict as FeedbackVerdict,
      note: r.note ?? undefined,
      timestamp: r.timestamp,
    }));
  }

  falsePositiveRate(windowMs?: number): number {
    let query = "SELECT verdict FROM feedback_log";
    const params: unknown[] = [];

    if (windowMs !== undefined) {
      const since = Date.now() - windowMs;
      query += " WHERE timestamp >= ?";
      params.push(since);
    }

    const rows = this.db.prepare(query).all(...params) as any[];
    if (rows.length === 0) return 0;

    const fpCount = rows.filter((r) => r.verdict === "false_positive").length;
    return fpCount / rows.length;
  }
}
