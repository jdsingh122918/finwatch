import * as crypto from "node:crypto";
import type {
  Anomaly,
  LLMProvider,
  StreamEvent,
} from "@finwatch/shared";

export type SpawnerDeps = {
  provider: LLMProvider;
  model: string;
  maxTokens: number;
  temperature: number;
};

export type InvestigationResult = {
  anomalyId: string;
  sessionId: string;
  analysis: string;
  startedAt: number;
  completedAt: number;
  tokensUsed: { input: number; output: number };
};

function buildInvestigationPrompt(anomaly: Anomaly): {
  system: string;
  userContent: string;
} {
  const system = [
    `You are a financial investigation subagent. You receive an anomaly detected by the monitor agent and perform a deep-dive analysis.`,
    ``,
    `Provide a structured investigation covering:`,
    `1. Root cause analysis - what likely caused this anomaly`,
    `2. Historical context - similar past events`,
    `3. Risk assessment - potential impact and severity validation`,
    `4. Recommendations - suggested actions or monitoring adjustments`,
  ].join("\n");

  const metricsStr = Object.entries(anomaly.metrics)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  const userContent = [
    `## Anomaly to Investigate`,
    ``,
    `- **ID**: ${anomaly.id}`,
    `- **Severity**: ${anomaly.severity}`,
    `- **Source**: ${anomaly.source}`,
    `- **Symbol**: ${anomaly.symbol ?? "N/A"}`,
    `- **Description**: ${anomaly.description}`,
    `- **Metrics**: ${metricsStr}`,
    `- **Pre-screen score**: ${anomaly.preScreenScore}`,
    `- **Detected at**: ${new Date(anomaly.timestamp).toISOString()}`,
    ``,
    `Provide your investigation analysis.`,
  ].join("\n");

  return { system, userContent };
}

export class SubagentSpawner {
  private readonly deps: SpawnerDeps;

  constructor(deps: SpawnerDeps) {
    this.deps = deps;
  }

  async investigate(anomaly: Anomaly): Promise<InvestigationResult> {
    const sessionId = `subagent-${crypto.randomUUID()}`;
    const startedAt = Date.now();

    const { system, userContent } = buildInvestigationPrompt(anomaly);

    const events: StreamEvent[] = [];
    for await (const event of this.deps.provider.createMessage({
      model: this.deps.model,
      system,
      messages: [{ role: "user", content: userContent }],
      maxTokens: this.deps.maxTokens,
      temperature: this.deps.temperature,
    })) {
      events.push(event);
    }

    let analysis = "";
    let tokensInput = 0;
    let tokensOutput = 0;

    for (const event of events) {
      if (event.type === "text_delta") {
        analysis += event.text;
      } else if (event.type === "usage") {
        tokensInput += event.input;
        tokensOutput += event.output;
      }
    }

    return {
      anomalyId: anomaly.id,
      sessionId,
      analysis,
      startedAt,
      completedAt: Date.now(),
      tokensUsed: { input: tokensInput, output: tokensOutput },
    };
  }
}
