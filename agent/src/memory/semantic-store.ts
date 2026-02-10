import type Database from "better-sqlite3";
import type { MemoryEntry } from "@finwatch/shared";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { embeddingToBuffer } from "./vector-search.js";

export type EmbeddingProvider = {
  embed(text: string): Promise<number[]>;
};

export class SemanticStore {
  private db: Database.Database;
  private memoryDir: string;
  private embeddingService?: EmbeddingProvider;

  constructor(db: Database.Database, memoryDir: string, embeddingService?: EmbeddingProvider) {
    this.db = db;
    this.memoryDir = memoryDir;
    this.embeddingService = embeddingService;
    fs.mkdirSync(memoryDir, { recursive: true });
  }

  flush(summary: string, tags: string[]): string {
    const id = crypto.randomUUID();
    const dateStr = new Date().toISOString().slice(0, 13).replace("T", "-");
    const filename = `${dateStr}-${id.slice(0, 8)}.md`;
    fs.writeFileSync(path.join(this.memoryDir, filename), `# Memory: ${dateStr}\n\nTags: ${tags.join(", ")}\n\n${summary}\n`, "utf-8");
    this.db.prepare("INSERT INTO entries (id,content,embedding,source,timestamp,tags) VALUES (?,?,NULL,?,?,?)")
      .run(id, summary, `file:${filename}`, Date.now(), JSON.stringify(tags));

    // Fire-and-forget embedding generation
    if (this.embeddingService) {
      this.generateAndStoreEmbedding(id, summary).catch(() => {
        // Silently ignore embedding failures -- entry is still stored with NULL embedding
      });
    }

    return id;
  }

  private async generateAndStoreEmbedding(id: string, text: string): Promise<void> {
    const embedding = await this.embeddingService!.embed(text);
    const buf = embeddingToBuffer(embedding);
    this.db.prepare("UPDATE entries SET embedding = ? WHERE id = ?").run(buf, id);
  }

  listAll(): MemoryEntry[] {
    return (this.db.prepare("SELECT id,content,source,timestamp,tags FROM entries ORDER BY timestamp DESC").all() as { id: string; content: string; source: string; timestamp: number; tags: string }[])
      .map(r => ({ id: r.id, content: r.content, embedding: [], source: r.source, timestamp: r.timestamp, tags: JSON.parse(r.tags) as string[] }));
  }
}
