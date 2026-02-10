import type {
  LLMMessage,
  DomainPattern,
  DomainThreshold,
  ResponseFormat,
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
  responseFormat: ResponseFormat;
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
    `- preScreenScore: a confidence score from 0.0 to 1.0 indicating how confident you are this is a real anomaly`,
    ``,
    `Focus on unusual price movements, volume spikes, and significant deviations from recent history.`,
    `A z-score above 2.0 or below -2.0 indicates a statistically significant deviation.`,
    `Look for: large daily moves (>3%), volume >2x average, gap opens, trend reversals.`,
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

function formatTick(scored: ScoredTick, isLatest = false): string {
  const { tick, zScores, score, classification, regime } = scored;
  const lines: string[] = [];

  const dateStr = new Date(tick.timestamp).toISOString().slice(0, 10);
  const regimeStr = regime && regime !== "unknown" ? ` regime=${regime}` : "";
  const latestTag = isLatest ? " ** LATEST **" : "";
  lines.push(
    `[${classification.toUpperCase()}] score=${score.toFixed(3)} symbol=${tick.symbol ?? "N/A"} date=${dateStr} source=${tick.sourceId}${regimeStr}${latestTag}`
  );

  const metricParts: string[] = [];
  for (const [key, val] of Object.entries(tick.metrics)) {
    const z = zScores[key];
    metricParts.push(
      z !== undefined ? `${key}=${val} (z=${z.toFixed(2)})` : `${key}=${val}`
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
  } else if (ticks.length === 1) {
    userContent = `Analyze the following data tick for anomalies:\n\n${formatTick(ticks[0]!, true)}`;
  } else {
    // Mark the latest tick (highest timestamp) — this is the "current" data point.
    // Earlier ticks provide historical context for z-score comparison.
    const contextTicks = ticks.slice(0, -1);
    const latestTick = ticks[ticks.length - 1]!;
    const contextLines = contextTicks.map(t => formatTick(t, false)).join("\n\n");
    const latestLine = formatTick(latestTick, true);
    userContent = [
      `Analyze the LATEST tick below for anomalies, using the ${contextTicks.length} prior ticks as historical context:`,
      ``,
      `--- HISTORICAL CONTEXT (${contextTicks.length} prior bars) ---`,
      contextLines,
      ``,
      `--- CURRENT BAR (analyze this for anomalies) ---`,
      latestLine,
    ].join("\n");
  }

  return {
    system,
    messages: [{ role: "user", content: userContent }],
    responseFormat: { type: "json_object" },
  };
}
