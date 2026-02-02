import type Database from "better-sqlite3";
import type { MemoryEntry, SearchResult } from "@finwatch/shared";

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; magA += a[i]! * a[i]!; magB += b[i]! * b[i]!; }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

export function embeddingToBuffer(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

export function bufferToEmbedding(buf: Buffer): number[] {
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
}

export class VectorStore {
  private db: Database.Database;
  constructor(db: Database.Database) { this.db = db; }

  insert(entry: MemoryEntry): void {
    const embBuf = entry.embedding.length > 0 ? embeddingToBuffer(entry.embedding) : null;
    this.db.prepare("INSERT OR REPLACE INTO entries (id,content,embedding,source,timestamp,tags) VALUES (?,?,?,?,?,?)")
      .run(entry.id, entry.content, embBuf, entry.source, entry.timestamp, JSON.stringify(entry.tags));
  }

  search(queryEmbedding: number[], topK: number): SearchResult[] {
    const rows = this.db.prepare("SELECT id,content,embedding,source,timestamp,tags FROM entries WHERE embedding IS NOT NULL")
      .all() as { id: string; content: string; embedding: Buffer; source: string; timestamp: number; tags: string }[];
    return rows.map(row => {
      const embedding = bufferToEmbedding(row.embedding);
      return { entry: { id: row.id, content: row.content, embedding, source: row.source, timestamp: row.timestamp, tags: JSON.parse(row.tags) as string[] }, score: cosineSimilarity(queryEmbedding, embedding), matchType: "vector" as const };
    }).sort((a, b) => b.score - a.score).slice(0, topK);
  }
}
