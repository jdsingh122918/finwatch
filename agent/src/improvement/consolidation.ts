import type { LLMProvider, DomainPattern, DomainCorrelation, DomainThreshold } from "@finwatch/shared";

export type ConsolidationDeps = {
  provider: LLMProvider;
  model: string;
  knowledgeFilePath: string;
  writeFile: (path: string, content: string) => void;
};

export type ConsolidationResult = {
  content: string;
  patternsProcessed: number;
  correlationsProcessed: number;
  thresholdsProcessed: number;
  durationMs: number;
  skipped: boolean;
};

export class WeeklyConsolidation {
  private deps: ConsolidationDeps;

  constructor(deps: ConsolidationDeps) { this.deps = deps; }

  async run(patterns: DomainPattern[], correlations: DomainCorrelation[], thresholds: DomainThreshold[]): Promise<ConsolidationResult> {
    const startTime = Date.now();

    if (patterns.length === 0 && correlations.length === 0 && thresholds.length === 0) {
      return { content: "", patternsProcessed: 0, correlationsProcessed: 0, thresholdsProcessed: 0, durationMs: Date.now() - startTime, skipped: true };
    }

    let text = "## Patterns\n";
    for (const p of patterns) text += `- ${p.pattern} (confidence: ${p.confidence}, source: ${p.source})\n`;
    text += "\n## Correlations\n";
    for (const c of correlations) text += `- ${c.sourceA} <-> ${c.sourceB}: ${c.rule} (confidence: ${c.confidence})\n`;
    text += "\n## Thresholds\n";
    for (const t of thresholds) text += `- ${t.source}/${t.metric}: ${t.direction} ${t.value}\n`;

    let content = "";
    const stream = this.deps.provider.createMessage({
      model: this.deps.model,
      system: "You are a knowledge consolidation assistant. Merge, deduplicate, and prune the provided domain knowledge. Remove contradictions. Output a clean KNOWLEDGE.md file in markdown format.",
      messages: [{ role: "user", content: `Please consolidate this domain knowledge:\n\n${text}` }],
      maxTokens: 4096,
      temperature: 0.2,
    });

    for await (const event of stream) {
      if (event.type === "text_delta") content += event.text;
    }

    this.deps.writeFile(this.deps.knowledgeFilePath, content);

    return { content, patternsProcessed: patterns.length, correlationsProcessed: correlations.length, thresholdsProcessed: thresholds.length, durationMs: Date.now() - startTime, skipped: false };
  }
}
