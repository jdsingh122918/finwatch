import type { SearchResult } from "@finwatch/shared";

export type HybridSearchConfig = { vectorWeight: number; textWeight: number; maxResults: number; minScore: number };

export function mergeHybridResults(vectorResults: SearchResult[], keywordResults: SearchResult[], config: HybridSearchConfig): SearchResult[] {
  const merged = new Map<string, { entry: SearchResult["entry"]; vs: number; ks: number }>();
  for (const r of vectorResults) merged.set(r.entry.id, { entry: r.entry, vs: r.score, ks: 0 });
  for (const r of keywordResults) {
    const e = merged.get(r.entry.id);
    if (e) e.ks = r.score; else merged.set(r.entry.id, { entry: r.entry, vs: 0, ks: r.score });
  }
  const results: SearchResult[] = [];
  for (const [, { entry, vs, ks }] of merged) {
    const score = config.vectorWeight * vs + config.textWeight * ks;
    if (score >= config.minScore) results.push({ entry, score, matchType: vs > 0 && ks > 0 ? "hybrid" : vs > 0 ? "vector" : "keyword" });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, config.maxResults);
}
