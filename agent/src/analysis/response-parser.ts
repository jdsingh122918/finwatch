import * as crypto from "node:crypto";
import type { Anomaly, Severity } from "@finwatch/shared";

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParseError";
  }
}

const VALID_SEVERITIES: Set<string> = new Set([
  "low",
  "medium",
  "high",
  "critical",
]);

function extractJson(text: string): string {
  // Try to extract from ```json ... ``` fences
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }

  // Try to find a raw JSON array
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch?.[0]) {
    return arrayMatch[0];
  }

  throw new ParseError("No JSON array found in response");
}

type RawAnomaly = {
  severity?: unknown;
  source?: unknown;
  symbol?: unknown;
  description?: unknown;
  metrics?: unknown;
  preScreenScore?: unknown;
};

function isValidEntry(entry: RawAnomaly): boolean {
  if (typeof entry.severity !== "string" || !VALID_SEVERITIES.has(entry.severity)) {
    return false;
  }
  if (typeof entry.source !== "string" || entry.source.length === 0) {
    return false;
  }
  if (typeof entry.description !== "string") {
    return false;
  }
  if (entry.metrics === undefined || entry.metrics === null || typeof entry.metrics !== "object") {
    return false;
  }
  return true;
}

export function parseAnomalies(text: string, sessionId: string): Anomaly[] {
  const jsonStr = extractJson(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new ParseError(`Invalid JSON: ${jsonStr.slice(0, 100)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new ParseError("Expected JSON array, got: " + typeof parsed);
  }

  const anomalies: Anomaly[] = [];

  for (const entry of parsed as RawAnomaly[]) {
    if (!isValidEntry(entry)) continue;

    anomalies.push({
      id: crypto.randomUUID(),
      severity: entry.severity as Severity,
      source: entry.source as string,
      symbol: typeof entry.symbol === "string" ? entry.symbol : undefined,
      timestamp: Date.now(),
      description: entry.description as string,
      metrics: entry.metrics as Record<string, number>,
      preScreenScore:
        typeof entry.preScreenScore === "number" ? entry.preScreenScore : 0,
      sessionId,
    });
  }

  return anomalies;
}
