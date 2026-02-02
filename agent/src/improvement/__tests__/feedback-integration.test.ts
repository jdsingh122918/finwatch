import { describe, it, expect, vi } from "vitest";
import type { LLMProvider, CreateMessageParams, StreamEvent, AnomalyFeedback } from "@finwatch/shared";
import { FeedbackIntegration, type FeedbackIntegrationDeps, type IntegrationResult } from "../feedback-integration.js";

function mockProvider(response: string): LLMProvider {
  return {
    id: "mock",
    name: "Mock",
    async *createMessage(): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", text: response };
      yield { type: "usage", input: 100, output: 50 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi.fn().mockResolvedValue({ providerId: "mock", status: "healthy", latencyMs: 10 }),
    listModels: vi.fn().mockReturnValue(["mock-model"]),
  };
}

const sampleFeedback: AnomalyFeedback[] = [
  { anomalyId: "a1", verdict: "false_positive", note: "Scheduled maintenance", timestamp: Date.now() },
  { anomalyId: "a2", verdict: "confirmed", timestamp: Date.now() },
  { anomalyId: "a3", verdict: "false_positive", timestamp: Date.now() },
];

describe("FeedbackIntegration", () => {
  it("runs an integration turn with feedback batch", async () => {
    const deps: FeedbackIntegrationDeps = {
      provider: mockProvider("Based on the feedback, I recommend increasing the price threshold from 3.0 to 3.5 for source yahoo."),
      model: "mock-model",
    };

    const integration = new FeedbackIntegration(deps);
    const result = await integration.run(sampleFeedback);

    expect(result.response).toContain("threshold");
    expect(result.feedbackCount).toBe(3);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("includes feedback details in the prompt to the LLM", async () => {
    const createMessageSpy = vi.fn<[CreateMessageParams], AsyncIterable<StreamEvent>>();
    createMessageSpy.mockImplementation(async function* () {
      yield { type: "text_delta", text: "Adjustments noted." };
      yield { type: "stop", reason: "end_turn" };
    });

    const provider: LLMProvider = {
      id: "spy",
      name: "Spy",
      createMessage: createMessageSpy,
      healthCheck: vi.fn().mockResolvedValue({ providerId: "spy", status: "healthy", latencyMs: 10 }),
      listModels: vi.fn().mockReturnValue(["spy-model"]),
    };

    const integration = new FeedbackIntegration({ provider, model: "spy-model" });
    await integration.run(sampleFeedback);

    expect(createMessageSpy).toHaveBeenCalledOnce();
    const params = createMessageSpy.mock.calls[0]![0];
    expect(params.system).toContain("feedback");
    expect(params.messages[0]!.content).toContain("false_positive");
    expect(params.messages[0]!.content).toContain("confirmed");
  });

  it("handles empty feedback batch", async () => {
    const integration = new FeedbackIntegration({
      provider: mockProvider("No feedback to process."),
      model: "mock-model",
    });

    const result = await integration.run([]);
    expect(result.feedbackCount).toBe(0);
    expect(result.skipped).toBe(true);
  });

  it("computes verdict summary", async () => {
    const integration = new FeedbackIntegration({
      provider: mockProvider("Processed."),
      model: "mock-model",
    });

    const result = await integration.run(sampleFeedback);
    expect(result.verdictSummary).toEqual({
      confirmed: 1,
      false_positive: 2,
      needs_review: 0,
    });
  });
});
