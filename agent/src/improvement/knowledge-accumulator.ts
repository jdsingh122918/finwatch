import { randomUUID } from "crypto";
import type { DomainKnowledgeStore } from "../memory/domain-knowledge.js";

export type AccumulatorConfig = {
  dedupThreshold: number;
};

function simpleTextSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...wordsA].filter((w) => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size > 0 ? intersection.size / union.size : 0;
}

export class KnowledgeAccumulator {
  private store: DomainKnowledgeStore;
  private config: AccumulatorConfig;

  constructor(store: DomainKnowledgeStore, config: AccumulatorConfig) {
    this.store = store;
    this.config = config;
  }

  accumulatePattern(input: { pattern: string; confidence: number; source: string }): void {
    const existing = this.store.getPatterns();

    for (const p of existing) {
      if (simpleTextSimilarity(p.pattern, input.pattern) >= this.config.dedupThreshold) {
        this.store.upsertPattern({
          ...p,
          confidence: Math.max(p.confidence, input.confidence),
          updatedAt: Date.now(),
        });
        return;
      }
    }

    this.store.upsertPattern({
      id: randomUUID(),
      pattern: input.pattern,
      confidence: input.confidence,
      source: input.source,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  accumulateCorrelation(input: { sourceA: string; sourceB: string; rule: string; confidence: number }): void {
    this.store.upsertCorrelation({
      id: randomUUID(),
      sourceA: input.sourceA,
      sourceB: input.sourceB,
      rule: input.rule,
      confidence: input.confidence,
      createdAt: Date.now(),
    });
  }

  accumulateThreshold(input: { source: string; metric: string; value: number; direction: "above" | "below" }): void {
    const existing = this.store.getThresholds();
    const match = existing.find((t) => t.source === input.source && t.metric === input.metric);

    if (match) {
      this.store.upsertThreshold({ ...match, value: input.value, direction: input.direction, updatedAt: Date.now() });
    } else {
      this.store.upsertThreshold({
        id: randomUUID(), source: input.source, metric: input.metric,
        value: input.value, direction: input.direction, updatedAt: Date.now(),
      });
    }
  }
}
