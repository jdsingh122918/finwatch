import type { LLMProvider, AnomalyFeedback, FeedbackVerdict } from "@finwatch/shared";

export type FeedbackIntegrationDeps = {
  provider: LLMProvider;
  model: string;
};

export type IntegrationResult = {
  response: string;
  feedbackCount: number;
  verdictSummary: Record<FeedbackVerdict, number>;
  durationMs: number;
  skipped: boolean;
};

export class FeedbackIntegration {
  private deps: FeedbackIntegrationDeps;

  constructor(deps: FeedbackIntegrationDeps) {
    this.deps = deps;
  }

  async run(feedbackBatch: AnomalyFeedback[]): Promise<IntegrationResult> {
    const startTime = Date.now();

    const verdictSummary: Record<FeedbackVerdict, number> = {
      confirmed: 0,
      false_positive: 0,
      needs_review: 0,
    };

    for (const f of feedbackBatch) {
      verdictSummary[f.verdict]++;
    }

    if (feedbackBatch.length === 0) {
      return {
        response: "",
        feedbackCount: 0,
        verdictSummary,
        durationMs: Date.now() - startTime,
        skipped: true,
      };
    }

    const feedbackText = feedbackBatch
      .map((f) => `- Anomaly ${f.anomalyId}: ${f.verdict}${f.note ? ` (${f.note})` : ""}`)
      .join("\n");

    const summaryText = `Summary: ${verdictSummary.confirmed} confirmed, ${verdictSummary.false_positive} false positives, ${verdictSummary.needs_review} needs review`;

    let response = "";
    const stream = this.deps.provider.createMessage({
      model: this.deps.model,
      system: "You are a feedback integration assistant. Analyze user feedback on anomaly detections and recommend adjustments to detection thresholds, rule confidence scores, and pattern recognition. Be specific about which parameters to change and by how much.",
      messages: [
        {
          role: "user",
          content: `Please analyze this feedback batch and recommend threshold/rule adjustments:\n\n${feedbackText}\n\n${summaryText}`,
        },
      ],
      maxTokens: 2048,
      temperature: 0.3,
    });

    for await (const event of stream) {
      if (event.type === "text_delta") {
        response += event.text;
      }
    }

    return {
      response,
      feedbackCount: feedbackBatch.length,
      verdictSummary,
      durationMs: Date.now() - startTime,
      skipped: false,
    };
  }
}
