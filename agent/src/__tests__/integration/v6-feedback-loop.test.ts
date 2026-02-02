// agent/src/__tests__/integration/v6-feedback-loop.test.ts
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import Database from "better-sqlite3";
import type {
  LLMProvider,
  StreamEvent,
  AnomalyFeedback,
} from "@finwatch/shared";
import { FeedbackStore } from "../../improvement/feedback-store.js";
import { FeedbackTrigger } from "../../improvement/feedback-trigger.js";
import { FeedbackIntegration } from "../../improvement/feedback-integration.js";

function mockIntegrationProvider(): LLMProvider {
  return {
    id: "mock-integration",
    name: "Mock Integration",
    async *createMessage(): AsyncIterable<StreamEvent> {
      yield {
        type: "text_delta",
        text: "Based on 10 false positive feedbacks, I recommend increasing the price z-score threshold from 3.0 to 3.5 for the yahoo source.",
      };
      yield { type: "usage", input: 200, output: 100 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi
      .fn()
      .mockResolvedValue({
        providerId: "mock",
        status: "healthy",
        latencyMs: 10,
      }),
    listModels: vi.fn().mockReturnValue(["mock-model"]),
  };
}

describe("V6: Feedback Loop Integration", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  it("submits 10 false positives, trigger fires, integration adjusts thresholds", async () => {
    const store = new FeedbackStore(db);
    const integration = new FeedbackIntegration({
      provider: mockIntegrationProvider(),
      model: "mock-model",
    });

    let triggerFired = false;
    const trigger = new FeedbackTrigger({
      countThreshold: 10,
      timeoutMs: 7200000,
      onTrigger: () => {
        triggerFired = true;
      },
    });

    // Submit 10 false positive feedbacks
    for (let i = 0; i < 10; i++) {
      const feedback: AnomalyFeedback = {
        anomalyId: `anomaly-${i}`,
        verdict: "false_positive",
        note: "Not a real anomaly",
        timestamp: Date.now(),
      };
      store.insert(feedback);
      trigger.recordFeedback();
    }

    expect(triggerFired).toBe(true);
    expect(store.unprocessedCount()).toBe(10);

    // Run integration turn
    const unprocessed = store.getUnprocessed();
    const result = await integration.run(unprocessed);

    expect(result.feedbackCount).toBe(10);
    expect(result.verdictSummary.false_positive).toBe(10);
    expect(result.response).toContain("threshold");

    // Mark as processed
    store.markProcessed(unprocessed.map((f) => f.anomalyId));
    expect(store.unprocessedCount()).toBe(0);

    // FP rate should reflect the feedback
    expect(store.falsePositiveRate()).toBe(1.0);

    // Cleanup
    trigger.stop();
  });
});
