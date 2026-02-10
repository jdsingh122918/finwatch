import { describe, it, expect } from "vitest";
import type { DataTick, DomainPattern, DomainThreshold } from "@finwatch/shared";
import {
  buildAnalysisPrompt,
  type AnalysisContext,
} from "../prompt-builder.js";
import type { ScoredTick } from "../pre-screener.js";

function makeScoredTick(overrides: Partial<ScoredTick> = {}): ScoredTick {
  const tick: DataTick = {
    sourceId: "yahoo",
    timestamp: 1706745600000,
    symbol: "AAPL",
    metrics: { close: 184.4, volume: 49120300 },
    metadata: {},
  };
  return {
    tick,
    zScores: { close: 0.5, volume: 0.2 },
    score: 0.35,
    classification: "normal",
    ...overrides,
  };
}

function makeContext(overrides: Partial<AnalysisContext> = {}): AnalysisContext {
  return {
    sessionId: "session-123",
    cycleId: "cycle-456",
    patterns: [],
    thresholds: [],
    ...overrides,
  };
}

describe("buildAnalysisPrompt", () => {
  it("returns a system message and a user message", () => {
    const ticks = [makeScoredTick()];
    const result = buildAnalysisPrompt(ticks, makeContext());
    expect(result.system).toBeDefined();
    expect(result.system!.length).toBeGreaterThan(0);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.role).toBe("user");
  });

  it("includes tick data in user message", () => {
    const ticks = [
      makeScoredTick({
        tick: {
          sourceId: "yahoo",
          timestamp: 1706745600000,
          symbol: "GOOG",
          metrics: { close: 142.5 },
          metadata: {},
        },
      }),
    ];
    const result = buildAnalysisPrompt(ticks, makeContext());
    const userMsg = result.messages[0]!.content;
    expect(userMsg).toContain("GOOG");
    expect(userMsg).toContain("142.5");
  });

  it("includes z-scores in user message", () => {
    const ticks = [makeScoredTick({ zScores: { close: 2.5 } })];
    const result = buildAnalysisPrompt(ticks, makeContext());
    const userMsg = result.messages[0]!.content;
    expect(userMsg).toContain("2.5");
  });

  it("includes anomaly score and classification", () => {
    const ticks = [
      makeScoredTick({ score: 0.82, classification: "urgent" }),
    ];
    const result = buildAnalysisPrompt(ticks, makeContext());
    const userMsg = result.messages[0]!.content;
    expect(userMsg).toContain("0.82");
    expect(userMsg.toLowerCase()).toContain("urgent");
  });

  it("includes domain patterns in system prompt when provided", () => {
    const patterns: DomainPattern[] = [
      {
        id: "p1",
        pattern: "Volume spike before earnings",
        confidence: 0.9,
        source: "learned",
        createdAt: 1706745600000,
        updatedAt: 1706745600000,
      },
    ];
    const result = buildAnalysisPrompt(
      [makeScoredTick()],
      makeContext({ patterns })
    );
    expect(result.system).toContain("Volume spike before earnings");
  });

  it("includes domain thresholds in system prompt when provided", () => {
    const thresholds: DomainThreshold[] = [
      {
        id: "t1",
        source: "yahoo",
        metric: "volume",
        value: 100000000,
        direction: "above",
        updatedAt: 1706745600000,
      },
    ];
    const result = buildAnalysisPrompt(
      [makeScoredTick()],
      makeContext({ thresholds })
    );
    expect(result.system).toContain("volume");
    expect(result.system).toContain("above");
  });

  it("handles empty tick array gracefully", () => {
    const result = buildAnalysisPrompt([], makeContext());
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.content).toContain("no ticks");
  });

  it("formats multiple ticks", () => {
    const ticks = [
      makeScoredTick({
        tick: {
          sourceId: "yahoo",
          timestamp: 1706745600000,
          symbol: "AAPL",
          metrics: { close: 184.4 },
          metadata: {},
        },
      }),
      makeScoredTick({
        tick: {
          sourceId: "yahoo",
          timestamp: 1706745600000,
          symbol: "MSFT",
          metrics: { close: 405.2 },
          metadata: {},
        },
      }),
    ];
    const result = buildAnalysisPrompt(ticks, makeContext());
    const userMsg = result.messages[0]!.content;
    expect(userMsg).toContain("AAPL");
    expect(userMsg).toContain("MSFT");
  });

  it("system prompt instructs JSON output format", () => {
    const result = buildAnalysisPrompt([makeScoredTick()], makeContext());
    expect(result.system).toContain("JSON");
  });

  it("includes responseFormat with json_object type", () => {
    const result = buildAnalysisPrompt([makeScoredTick()], makeContext());
    expect(result.responseFormat).toEqual({ type: "json_object" });
  });
});
