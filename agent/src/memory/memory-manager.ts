import type Database from "better-sqlite3";
import type { MemoryEntry, SearchResult } from "@finwatch/shared";
import { SemanticStore, type EmbeddingProvider } from "./semantic-store.js";
import { VectorStore } from "./vector-search.js";
import { KeywordStore } from "./keyword-search.js";
import { mergeHybridResults, type HybridSearchConfig } from "./hybrid-search.js";
import { backfillEmbeddings } from "./backfill-embeddings.js";

const DEFAULT_HYBRID_CONFIG: HybridSearchConfig = {
  vectorWeight: 0.7,
  textWeight: 0.3,
  maxResults: 5,
  minScore: 0.1,
};

export class MemoryManager {
  private readonly semanticStore: SemanticStore;
  private readonly vectorStore: VectorStore;
  private readonly keywordStore: KeywordStore;
  private readonly embeddingService?: EmbeddingProvider;
  private readonly db: Database.Database;
  private readonly hybridConfig: HybridSearchConfig;

  constructor(
    db: Database.Database,
    memoryDir: string,
    embeddingService?: EmbeddingProvider,
    hybridConfig?: HybridSearchConfig,
  ) {
    this.db = db;
    this.embeddingService = embeddingService;
    this.semanticStore = new SemanticStore(db, memoryDir, embeddingService);
    this.vectorStore = new VectorStore(db);
    this.keywordStore = new KeywordStore(db);
    this.hybridConfig = hybridConfig ?? DEFAULT_HYBRID_CONFIG;
  }

  store(summary: string, tags: string[]): string {
    return this.semanticStore.flush(summary, tags);
  }

  listAll(): MemoryEntry[] {
    return this.semanticStore.listAll();
  }

  syncSearch(): void {
    this.keywordStore.syncFts();
  }

  searchKeyword(query: string, topK: number): SearchResult[] {
    return this.keywordStore.search(query, topK);
  }

  searchVector(queryEmbedding: number[], topK: number): SearchResult[] {
    return this.vectorStore.search(queryEmbedding, topK);
  }

  searchHybrid(query: string, queryEmbedding: number[], topK: number): SearchResult[] {
    const vectorResults = this.vectorStore.search(queryEmbedding, topK);
    const keywordResults = this.keywordStore.search(query, topK);
    return mergeHybridResults(vectorResults, keywordResults, this.hybridConfig);
  }

  buildContext(query: string): string {
    const keywordResults = this.keywordStore.search(query, 5);
    const sections: string[] = [];
    if (keywordResults.length > 0) {
      sections.push(
        "## Relevant Memories\n" +
          keywordResults
            .map((m) => `- [${m.score.toFixed(2)}] ${m.entry.content}`)
            .join("\n"),
      );
    }
    return `<relevant-context>\n${sections.length > 0 ? sections.join("\n\n") : "No prior context found."}\n</relevant-context>`;
  }

  async backfill(): Promise<number> {
    if (!this.embeddingService) return 0;
    return backfillEmbeddings(this.db, this.embeddingService);
  }
}
