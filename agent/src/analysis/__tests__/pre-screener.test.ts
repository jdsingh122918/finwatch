import { describe, it, expect } from "vitest";
import type { DataTick } from "@finwatch/shared";
import {
  computeZScores,
  preScreenBatch,
  type PreScreenConfig,
  type ScoredTick,
} from "../pre-screener.js";

function makeTick(overrides: Partial<DataTick> = {}): DataTick {
  return {
    sourceId: "test-source",
    timestamp: Date.now(),
    symbol: "AAPL",
    metrics: { close: 100, volume: 50000 },
    metadata: {},
    ...overrides,
  };
}

const defaultConfig: PreScreenConfig = {
  zScoreThreshold: 3.0,
  urgentThreshold: 0.6,
  skipThreshold: 0.2,
};

describe("computeZScores", () => {
  it("returns empty array for empty input", () => {
    expect(computeZScores([])).toEqual([]);
  });

  it("returns zero z-scores for a single tick (no variance)", () => {
    const ticks = [makeTick({ metrics: { close: 100 } })];
    const result = computeZScores(ticks);
    expect(result).toHaveLength(1);
    expect(result[0]!.zScores.close).toBe(0);
  });

  it("computes correct z-scores for a simple distribution", () => {
    // Mean = 100, StdDev = 10
    const ticks = [
      makeTick({ metrics: { close: 80 } }),
      makeTick({ metrics: { close: 90 } }),
      makeTick({ metrics: { close: 100 } }),
      makeTick({ metrics: { close: 110 } }),
      makeTick({ metrics: { close: 120 } }),
    ];
    const result = computeZScores(ticks);

    // z(80) ≈ -1.414, z(100) = 0, z(120) ≈ 1.414
    expect(result[2]!.zScores.close).toBeCloseTo(0, 1);
    expect(result[0]!.zScores.close).toBeLessThan(0);
    expect(result[4]!.zScores.close).toBeGreaterThan(0);
    // Symmetric: |z(80)| ≈ |z(120)|
    expect(Math.abs(result[0]!.zScores.close!)).toBeCloseTo(
      Math.abs(result[4]!.zScores.close!),
      5
    );
  });

  it("handles multiple metrics independently", () => {
    const ticks = [
      makeTick({ metrics: { close: 100, volume: 1000 } }),
      makeTick({ metrics: { close: 100, volume: 5000 } }),
      makeTick({ metrics: { close: 100, volume: 9000 } }),
    ];
    const result = computeZScores(ticks);

    // close has zero variance -> z=0 for all
    expect(result[0]!.zScores.close).toBe(0);
    // volume has variance
    expect(result[0]!.zScores.volume).toBeLessThan(0);
    expect(result[2]!.zScores.volume).toBeGreaterThan(0);
  });

  it("handles ticks with different metric sets gracefully", () => {
    const ticks = [
      makeTick({ metrics: { close: 100 } }),
      makeTick({ metrics: { close: 110, volume: 5000 } }),
    ];
    const result = computeZScores(ticks);
    expect(result).toHaveLength(2);
    // close computed for both
    expect(result[0]!.zScores).toHaveProperty("close");
    expect(result[1]!.zScores).toHaveProperty("close");
  });
});

describe("preScreenBatch", () => {
  it("returns empty array for empty input", () => {
    expect(preScreenBatch([], defaultConfig)).toEqual([]);
  });

  it("classifies moderate-variance ticks as 'normal'", () => {
    // Spread enough to avoid 'skip' (score > 0.2) but not enough for 'urgent' (score < 0.6)
    const ticks = [
      makeTick({ metrics: { close: 80 } }),
      makeTick({ metrics: { close: 90 } }),
      makeTick({ metrics: { close: 100 } }),
      makeTick({ metrics: { close: 110 } }),
      makeTick({ metrics: { close: 120 } }),
    ];
    const result = preScreenBatch(ticks, defaultConfig);
    // The outliers (80, 120) should be "normal" — z ≈ 1.4 which is below threshold 3
    const first = result[0]!;
    const last = result[4]!;
    expect(first.classification).toBe("normal");
    expect(last.classification).toBe("normal");
  });

  it("classifies outlier ticks as 'urgent' when score exceeds urgentThreshold", () => {
    // Create a batch where one tick is far beyond the z-score threshold
    const ticks = [
      makeTick({ metrics: { close: 100 } }),
      makeTick({ metrics: { close: 101 } }),
      makeTick({ metrics: { close: 99 } }),
      makeTick({ metrics: { close: 100 } }),
      makeTick({ metrics: { close: 101 } }),
      makeTick({ metrics: { close: 99 } }),
      makeTick({ metrics: { close: 100 } }),
      makeTick({ metrics: { close: 101 } }),
      makeTick({ metrics: { close: 99 } }),
      makeTick({ metrics: { close: 1000 } }), // extreme outlier — z >> threshold
    ];
    const result = preScreenBatch(ticks, defaultConfig);
    const outlier = result[result.length - 1]!;
    expect(outlier.classification).toBe("urgent");
    expect(outlier.score).toBeGreaterThan(defaultConfig.urgentThreshold);
  });

  it("classifies ticks with low anomaly score as 'skip'", () => {
    // All identical ticks -> z-scores are 0 -> score is 0 -> skip
    const ticks = [
      makeTick({ metrics: { close: 100 } }),
      makeTick({ metrics: { close: 100 } }),
      makeTick({ metrics: { close: 100 } }),
    ];
    const result = preScreenBatch(ticks, defaultConfig);
    for (const scored of result) {
      expect(scored.classification).toBe("skip");
      expect(scored.score).toBeLessThan(defaultConfig.skipThreshold);
    }
  });

  it("preserves the original tick in scored output", () => {
    const tick = makeTick({ symbol: "GOOG", metrics: { close: 150 } });
    const result = preScreenBatch([tick], defaultConfig);
    expect(result[0]!.tick.symbol).toBe("GOOG");
    expect(result[0]!.tick.metrics.close).toBe(150);
  });

  it("score is between 0 and 1", () => {
    const ticks = [
      makeTick({ metrics: { close: 100 } }),
      makeTick({ metrics: { close: 200 } }),
      makeTick({ metrics: { close: 50 } }),
    ];
    const result = preScreenBatch(ticks, defaultConfig);
    for (const scored of result) {
      expect(scored.score).toBeGreaterThanOrEqual(0);
      expect(scored.score).toBeLessThanOrEqual(1);
    }
  });
});
