import type { SearchResult, DomainPattern, DomainThreshold } from "@finwatch/shared";

export type AutoRecallConfig = { maxMemoryResults: number; maxPatterns: number; maxThresholds: number };
export type RecallSources = { search: (q: string) => SearchResult[]; getPatterns: () => DomainPattern[]; getThresholds: () => DomainThreshold[] };

export function buildRecallContext(query: string, sources: RecallSources, config: AutoRecallConfig): string {
  const memories = sources.search(query).slice(0, config.maxMemoryResults);
  const patterns = sources.getPatterns().slice(0, config.maxPatterns);
  const thresholds = sources.getThresholds().slice(0, config.maxThresholds);
  const sections: string[] = [];
  if (memories.length > 0) sections.push("## Relevant Memories\n" + memories.map(m => `- [${m.score.toFixed(2)}] ${m.entry.content}`).join("\n"));
  if (patterns.length > 0) sections.push("## Known Patterns\n" + patterns.map(p => `- [${p.confidence.toFixed(2)}] ${p.pattern}`).join("\n"));
  if (thresholds.length > 0) sections.push("## Active Thresholds\n" + thresholds.map(t => `- ${t.source}/${t.metric}: ${t.direction} ${t.value}`).join("\n"));
  return `<relevant-context>\n${sections.length > 0 ? sections.join("\n\n") : "No prior context found."}\n</relevant-context>`;
}
