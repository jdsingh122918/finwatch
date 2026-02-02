import { describe, it, expect } from "vitest";
import { mergeHybridResults, HybridSearchConfig } from "../hybrid-search.js";
import type { SearchResult } from "@finwatch/shared";

function mr(id: string, score: number, mt: "vector"|"keyword"): SearchResult {
  return { entry: { id, content: `c-${id}`, embedding: [], source: "t", timestamp: 1, tags: [] }, score, matchType: mt };
}
const cfg: HybridSearchConfig = { vectorWeight: 0.7, textWeight: 0.3, maxResults: 6, minScore: 0.35 };

describe("mergeHybridResults", () => {
  it("combines with weighted scores", () => {
    const merged = mergeHybridResults([mr("a",0.9,"vector")], [mr("a",0.8,"keyword")], cfg);
    const a = merged.find(r => r.entry.id === "a")!;
    expect(a.score).toBeCloseTo(0.87); // 0.7*0.9 + 0.3*0.8
    expect(a.matchType).toBe("hybrid");
  });
  it("filters below minScore", () => { expect(mergeHybridResults([mr("a",0.3,"vector")], [], cfg)).toHaveLength(0); });
  it("respects maxResults", () => {
    const v = Array.from({length:10},(_,i) => mr(`v${i}`, 0.9-i*0.05, "vector"));
    expect(mergeHybridResults(v, [], {...cfg, maxResults:3})).toHaveLength(3);
  });
  it("sorts descending", () => {
    const m = mergeHybridResults([mr("a",0.5,"vector"),mr("b",0.9,"vector")], [mr("a",0.9,"keyword")], cfg);
    for (let i=1; i<m.length; i++) expect(m[i-1]!.score).toBeGreaterThanOrEqual(m[i]!.score);
  });
  it("handles empty inputs", () => { expect(mergeHybridResults([], [], cfg)).toHaveLength(0); });
});
