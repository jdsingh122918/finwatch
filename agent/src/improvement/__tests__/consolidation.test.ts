import { describe, it, expect, vi } from "vitest";
import type { LLMProvider, CreateMessageParams, StreamEvent, DomainPattern, DomainCorrelation, DomainThreshold } from "@finwatch/shared";
import { WeeklyConsolidation, type ConsolidationDeps, type ConsolidationResult } from "../consolidation.js";

function mockProvider(response: string): LLMProvider {
  return {
    id: "mock", name: "Mock",
    async *createMessage(): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", text: response };
      yield { type: "usage", input: 200, output: 100 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi.fn().mockResolvedValue({ providerId: "mock", status: "healthy", latencyMs: 10 }),
    listModels: vi.fn().mockReturnValue(["mock-model"]),
  };
}

const samplePatterns: DomainPattern[] = [
  { id: "p1", pattern: "AAPL spikes on earnings", confidence: 0.8, source: "turn-1", createdAt: Date.now(), updatedAt: Date.now() },
  { id: "p2", pattern: "GOOGL drops on antitrust news", confidence: 0.9, source: "turn-3", createdAt: Date.now(), updatedAt: Date.now() },
];
const sampleCorrelations: DomainCorrelation[] = [
  { id: "c1", sourceA: "yahoo", sourceB: "csv", rule: "Volume correlation", confidence: 0.7, createdAt: Date.now() },
];
const sampleThresholds: DomainThreshold[] = [
  { id: "t1", source: "yahoo", metric: "price", value: 3.0, direction: "above", updatedAt: Date.now() },
];

describe("WeeklyConsolidation", () => {
  it("runs consolidation and writes KNOWLEDGE.md", async () => {
    const writeFile = vi.fn();
    const consolidation = new WeeklyConsolidation({
      provider: mockProvider("# Consolidated Knowledge\n\n## Patterns\n- AAPL spikes on earnings"),
      model: "mock-model",
      knowledgeFilePath: "/tmp/KNOWLEDGE.md",
      writeFile,
    });

    const result = await consolidation.run(samplePatterns, sampleCorrelations, sampleThresholds);
    expect(result.content).toContain("Consolidated Knowledge");
    expect(result.patternsProcessed).toBe(2);
    expect(writeFile).toHaveBeenCalledWith("/tmp/KNOWLEDGE.md", expect.stringContaining("Consolidated"));
  });

  it("sends all knowledge to LLM", async () => {
    const spy = vi.fn<[CreateMessageParams], AsyncIterable<StreamEvent>>();
    spy.mockImplementation(async function* () {
      yield { type: "text_delta", text: "Consolidated." };
      yield { type: "stop", reason: "end_turn" };
    });

    const consolidation = new WeeklyConsolidation({
      provider: { id: "spy", name: "Spy", createMessage: spy, healthCheck: vi.fn().mockResolvedValue({ providerId: "spy", status: "healthy", latencyMs: 10 }), listModels: vi.fn().mockReturnValue(["spy"]) },
      model: "spy", knowledgeFilePath: "/tmp/KNOWLEDGE.md", writeFile: vi.fn(),
    });

    await consolidation.run(samplePatterns, sampleCorrelations, sampleThresholds);
    expect(spy.mock.calls[0]![0].messages[0]!.content).toContain("AAPL spikes on earnings");
  });

  it("skips when no knowledge exists", async () => {
    const writeFile = vi.fn();
    const consolidation = new WeeklyConsolidation({
      provider: mockProvider("Nothing."), model: "mock-model",
      knowledgeFilePath: "/tmp/KNOWLEDGE.md", writeFile,
    });

    const result = await consolidation.run([], [], []);
    expect(result.skipped).toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });
});
