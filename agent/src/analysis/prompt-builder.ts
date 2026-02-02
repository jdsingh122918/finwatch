import type {
  LLMMessage,
  DomainPattern,
  DomainThreshold,
} from "@finwatch/shared";
import type { ScoredTick } from "./pre-screener.js";

export type AnalysisContext = {
  sessionId: string;
  cycleId: string;
  patterns: DomainPattern[];
  thresholds: DomainThreshold[];
};

export type AnalysisPrompt = {
  system: string;
  messages: LLMMessage[];
};

function buildSystemPrompt(ctx: AnalysisContext): string {
  const parts: string[] = [
    `You are a financial anomaly detection agent. Analyze the provided market data ticks and identify any anomalies.`,
    ``,
    `Session: ${ctx.sessionId} | Cycle: ${ctx.cycleId}`,
    ``,
    `For each anomaly you detect, output a JSON array of objects with these fields:`,
    `- severity: "low" | "medium" | "high" | "critical"`,
    `- source: the data source ID`,
    `- symbol: the ticker symbol (if applicable)`,
    `- description: a brief explanation of the anomaly`,
    `- metrics: an object of relevant metric values`,
    ``,
    `If no anomalies are detected, output an empty JSON array: []`,
    ``,
    `IMPORTANT: Your response must contain a valid JSON array. Wrap it in \`\`\`json code fences.`,
  ];

  if (ctx.patterns.length > 0) {
    parts.push(``);
    parts.push(`## Known Patterns`);
    for (const p of ctx.patterns) {
      parts.push(`- ${p.pattern} (confidence: ${p.confidence})`);
    }
  }

  if (ctx.thresholds.length > 0) {
    parts.push(``);
    parts.push(`## Active Thresholds`);
    for (const t of ctx.thresholds) {
      parts.push(
        `- ${t.source}/${t.metric}: ${t.direction} ${t.value}`
      );
    }
  }

  return parts.join("\n");
}

function formatTick(scored: ScoredTick): string {
  const { tick, zScores, score, classification } = scored;
  const lines: string[] = [];

  lines.push(
    `[${classification.toUpperCase()}] score=${score} symbol=${tick.symbol ?? "N/A"} source=${tick.sourceId} ts=${tick.timestamp}`
  );

  const metricParts: string[] = [];
  for (const [key, val] of Object.entries(tick.metrics)) {
    const z = zScores[key];
    metricParts.push(
      z !== undefined ? `${key}=${val} (z=${z})` : `${key}=${val}`
    );
  }
  lines.push(`  metrics: ${metricParts.join(", ")}`);

  return lines.join("\n");
}

export function buildAnalysisPrompt(
  ticks: ScoredTick[],
  ctx: AnalysisContext,
): AnalysisPrompt {
  const system = buildSystemPrompt(ctx);

  let userContent: string;
  if (ticks.length === 0) {
    userContent = `This batch contains no ticks to analyze. Return an empty JSON array.`;
  } else {
    const tickLines = ticks.map(formatTick).join("\n\n");
    userContent = `Analyze the following ${ticks.length} data tick(s) for anomalies:\n\n${tickLines}`;
  }

  return {
    system,
    messages: [{ role: "user", content: userContent }],
  };
}
