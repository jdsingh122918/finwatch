import type Database from "better-sqlite3";
import type { DomainPattern, DomainCorrelation, DomainThreshold } from "@finwatch/shared";

export class DomainKnowledgeStore {
  private db: Database.Database;
  constructor(db: Database.Database) { this.db = db; }

  upsertPattern(p: DomainPattern): void {
    this.db.prepare("INSERT INTO patterns (id,pattern,confidence,source,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET pattern=?,confidence=?,updated_at=?")
      .run(p.id, p.pattern, p.confidence, p.source, p.createdAt, p.updatedAt, p.pattern, p.confidence, p.updatedAt);
  }

  getPatterns(minConfidence = 0): DomainPattern[] {
    return (this.db.prepare("SELECT id,pattern,confidence,source,created_at,updated_at FROM patterns WHERE confidence>=? ORDER BY confidence DESC").all(minConfidence) as { id: string; pattern: string; confidence: number; source: string; created_at: number; updated_at: number }[])
      .map(r => ({ id: r.id, pattern: r.pattern, confidence: r.confidence, source: r.source, createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  upsertCorrelation(c: DomainCorrelation): void {
    this.db.prepare("INSERT INTO correlations (id,source_a,source_b,rule,confidence,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET rule=?,confidence=?")
      .run(c.id, c.sourceA, c.sourceB, c.rule, c.confidence, c.createdAt, c.rule, c.confidence);
  }

  getCorrelations(): DomainCorrelation[] {
    return (this.db.prepare("SELECT id,source_a,source_b,rule,confidence,created_at FROM correlations").all() as { id: string; source_a: string; source_b: string; rule: string; confidence: number; created_at: number }[])
      .map(r => ({ id: r.id, sourceA: r.source_a, sourceB: r.source_b, rule: r.rule, confidence: r.confidence, createdAt: r.created_at }));
  }

  deleteCorrelation(id: string): void { this.db.prepare("DELETE FROM correlations WHERE id=?").run(id); }

  upsertThreshold(t: DomainThreshold): void {
    this.db.prepare("INSERT INTO thresholds (id,source,metric,value,direction,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET value=?,direction=?,updated_at=?")
      .run(t.id, t.source, t.metric, t.value, t.direction, t.updatedAt, t.value, t.direction, t.updatedAt);
  }

  getThresholds(): DomainThreshold[] {
    return (this.db.prepare("SELECT id,source,metric,value,direction,updated_at FROM thresholds").all() as { id: string; source: string; metric: string; value: number; direction: "above" | "below"; updated_at: number }[])
      .map(r => ({ id: r.id, source: r.source, metric: r.metric, value: r.value, direction: r.direction, updatedAt: r.updated_at }));
  }
}
