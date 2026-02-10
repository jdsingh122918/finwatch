import type Database from "better-sqlite3";
import { embeddingToBuffer } from "./vector-search.js";
import type { EmbeddingProvider } from "./semantic-store.js";

type NullEmbeddingRow = {
  id: string;
  content: string;
};

export async function backfillEmbeddings(
  db: Database.Database,
  service: EmbeddingProvider,
): Promise<number> {
  const rows = db.prepare(
    "SELECT id, content FROM entries WHERE embedding IS NULL"
  ).all() as NullEmbeddingRow[];

  let count = 0;

  for (const row of rows) {
    try {
      const embedding = await service.embed(row.content);
      const buf = embeddingToBuffer(embedding);
      db.prepare("UPDATE entries SET embedding = ? WHERE id = ?").run(buf, row.id);
      count++;
    } catch {
      // Skip failed embeddings, continue with next
    }
  }

  return count;
}
