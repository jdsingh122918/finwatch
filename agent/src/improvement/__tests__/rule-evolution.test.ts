import { describe, it, expect, vi } from "vitest";
import type { LLMProvider, CreateMessageParams, StreamEvent } from "@finwatch/shared";
import { RuleEvolution, type RuleEvolutionDeps, type EvolutionResult } from "../rule-evolution.js";

function mockProvider(response: string): LLMProvider {
  return {
    id: "mock", name: "Mock",
    async *createMessage(): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", text: response };
      yield { type: "usage", input: 100, output: 50 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi.fn().mockResolvedValue({ providerId: "mock", status: "healthy", latencyMs: 10 }),
    listModels: vi.fn().mockReturnValue(["mock-model"]),
  };
}

const sampleRules = [{ id: "r1", name: "High price", condition: { type: "threshold", metric: "price", operator: ">", value: 200 }, severity: "high", confidence: 0.9 }];
const sampleMetrics = { truePositives: 8, falsePositives: 2, falseNegatives: 1, totalPredictions: 11 };

describe("RuleEvolution", () => {
  it("produces a versioned rule file", async () => {
    const writeFile = vi.fn();
    const evolution = new RuleEvolution({
      provider: mockProvider(JSON.stringify([{ id: "r1", name: "High price (adjusted)" }])),
      model: "mock-model", rulesDir: "/tmp/rules",
      writeFile, appendFile: vi.fn(),
      readFile: vi.fn().mockReturnValue(JSON.stringify(sampleRules)),
      listFiles: vi.fn().mockReturnValue(["rules_active.json"]),
    });

    const result = await evolution.run(sampleRules, sampleMetrics);
    expect(result.newVersion).toBeGreaterThan(0);
    expect(writeFile.mock.calls.some((c: any) => c[0].includes("rules_v"))).toBe(true);
  });

  it("sends rules + metrics to LLM", async () => {
    const spy = vi.fn<[CreateMessageParams], AsyncIterable<StreamEvent>>();
    spy.mockImplementation(async function* () {
      yield { type: "text_delta", text: "[]" };
      yield { type: "stop", reason: "end_turn" };
    });

    const evolution = new RuleEvolution({
      provider: { id: "spy", name: "Spy", createMessage: spy, healthCheck: vi.fn().mockResolvedValue({ providerId: "spy", status: "healthy", latencyMs: 10 }), listModels: vi.fn().mockReturnValue(["spy"]) },
      model: "spy", rulesDir: "/tmp/rules",
      writeFile: vi.fn(), appendFile: vi.fn(), readFile: vi.fn().mockReturnValue("[]"), listFiles: vi.fn().mockReturnValue([]),
    });

    await evolution.run(sampleRules, sampleMetrics);
    expect(spy.mock.calls[0]![0].messages[0]!.content).toContain("High price");
  });

  it("determines version from existing files", async () => {
    const evolution = new RuleEvolution({
      provider: mockProvider("[]"), model: "mock-model", rulesDir: "/tmp/rules",
      writeFile: vi.fn(), appendFile: vi.fn(), readFile: vi.fn().mockReturnValue("[]"),
      listFiles: vi.fn().mockReturnValue(["rules_active.json", "rules_v001.json", "rules_v002.json"]),
    });

    const result = await evolution.run(sampleRules, sampleMetrics);
    expect(result.newVersion).toBe(3);
  });

  it("logs to evolution_log.jsonl", async () => {
    const appendFile = vi.fn();
    const evolution = new RuleEvolution({
      provider: mockProvider("[]"), model: "mock-model", rulesDir: "/tmp/rules",
      writeFile: vi.fn(), appendFile, readFile: vi.fn().mockReturnValue("[]"), listFiles: vi.fn().mockReturnValue([]),
    });

    await evolution.run(sampleRules, sampleMetrics);
    expect(appendFile).toHaveBeenCalledWith(expect.stringContaining("evolution_log.jsonl"), expect.any(String));
  });
});
