// agent/src/__tests__/integration/v7-rule-evolution.test.ts
import { describe, it, expect, vi } from "vitest";
import type { LLMProvider, StreamEvent } from "@finwatch/shared";
import { RuleEvolution } from "../../improvement/rule-evolution.js";
import { AutoRevert } from "../../improvement/auto-revert.js";

function mockEvolutionProvider(): LLMProvider {
  return {
    id: "mock-evo",
    name: "Mock Evolution",
    async *createMessage(): AsyncIterable<StreamEvent> {
      yield {
        type: "text_delta",
        text: JSON.stringify([
          {
            id: "r1",
            name: "High price (adjusted)",
            condition: {
              type: "threshold",
              metric: "price",
              operator: ">",
              value: 210,
            },
            severity: "high",
            confidence: 0.92,
          },
          {
            id: "r2",
            name: "Volume spike",
            condition: {
              type: "threshold",
              metric: "volume",
              operator: ">",
              value: 5000000,
            },
            severity: "medium",
            confidence: 0.8,
          },
        ]),
      };
      yield { type: "usage", input: 100, output: 50 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi
      .fn()
      .mockResolvedValue({
        providerId: "mock-evo",
        status: "healthy",
        latencyMs: 10,
      }),
    listModels: vi.fn().mockReturnValue(["mock-model"]),
  };
}

describe("V7: Rule Evolution Integration", () => {
  it("triggers daily evolution, creates versioned rules, logs evolution", async () => {
    const files: Record<string, string> = {};
    const writeFile = vi.fn((path: string, content: string) => {
      files[path] = content;
    });
    const appendFile = vi.fn((path: string, content: string) => {
      files[path] = (files[path] || "") + content;
    });

    const evolution = new RuleEvolution({
      provider: mockEvolutionProvider(),
      model: "mock-model",
      rulesDir: "/tmp/rules",
      writeFile,
      appendFile,
      readFile: vi.fn().mockReturnValue("[]"),
      listFiles: vi
        .fn()
        .mockReturnValue(["rules_active.json", "rules_v001.json"]),
    });

    const currentRules = [
      {
        id: "r1",
        name: "High price",
        condition: {
          type: "threshold",
          metric: "price",
          operator: ">",
          value: 200,
        },
        severity: "high",
        confidence: 0.9,
      },
    ];

    const result = await evolution.run(currentRules, {
      truePositives: 15,
      falsePositives: 5,
      falseNegatives: 2,
      totalPredictions: 22,
    });

    // Should create v002
    expect(result.newVersion).toBe(2);
    expect(result.rulesCount).toBe(2);

    // Versioned file written
    expect(writeFile).toHaveBeenCalledWith(
      "/tmp/rules/rules_v002.json",
      expect.any(String),
    );
    // Active file updated
    expect(writeFile).toHaveBeenCalledWith(
      "/tmp/rules/rules_active.json",
      expect.any(String),
    );
    // Evolution logged
    expect(appendFile).toHaveBeenCalledWith(
      "/tmp/rules/evolution_log.jsonl",
      expect.stringContaining("version"),
    );
  });

  it("auto-revert fires when FP rate degrades", () => {
    let reverted = false;
    let notification = "";

    const revert = new AutoRevert({
      fpRateThreshold: 0.5,
      revert: () => {
        reverted = true;
      },
      notify: (msg) => {
        notification = msg;
      },
      getPreviousVersion: vi.fn().mockReturnValue("rules_v001.json"),
      readFile: vi.fn().mockReturnValue('[{"id":"r1","name":"safe rule"}]'),
    });

    const result = revert.check(0.6, 20); // 60% FP rate with 20 feedbacks
    expect(result.reverted).toBe(true);
    expect(reverted).toBe(true);
    expect(notification).toContain("Auto-revert");
    expect(notification).toContain("60.0%");
  });
});
