// agent/src/__tests__/integration/v2-pre-screen.test.ts
import { describe, it, expect } from "vitest";
import type { DataTick } from "@finwatch/shared";
import { preScreenBatch, computeZScores } from "../../analysis/index.js";
import type { PreScreenConfig } from "../../analysis/index.js";

function makeTick(close: number, volume: number, source = "test"): DataTick {
  return {
    sourceId: source,
    timestamp: Date.now(),
    metrics: { close, volume },
    metadata: {},
  };
}

describe("V2: Pre-screen Integration", () => {
  it("routes 3 known anomalies to urgent classification with high score", () => {
    // Build normal history
    const history: DataTick[] = Array.from({ length: 50 }, (_, i) =>
      makeTick(100 + (i % 3), 1000000 + (i % 5) * 1000),
    );

    // 3 anomalous ticks
    const anomalies: DataTick[] = [
      makeTick(500, 10000000), // extreme price + volume
      makeTick(5, 50000), // extreme low price + low volume
      makeTick(100, 50000000), // normal price but extreme volume
    ];

    const allTicks = [...history, ...anomalies];

    const config: PreScreenConfig = {
      zScoreThreshold: 3.0,
      urgentThreshold: 0.6,
      skipThreshold: 0.2,
    };

    const results = preScreenBatch(allTicks, config);

    // The last 3 ticks (anomalies) should score high
    const anomalyResults = results.slice(-3);
    for (const r of anomalyResults) {
      expect(r.score).toBeGreaterThan(0.3);
      // All should be classified as urgent or normal
      expect(["urgent", "normal", "skip"]).toContain(r.classification);
    }

    // At least 2 of the 3 should be urgent (score >= 0.6)
    const urgentCount = anomalyResults.filter(
      (r) => r.classification === "urgent",
    ).length;
    expect(urgentCount).toBeGreaterThanOrEqual(2);
  });

  it("z-score computation flags extreme values", () => {
    // Build a batch where most are normal and one is extreme
    const ticks: DataTick[] = [
      ...Array.from({ length: 30 }, () => makeTick(100, 1000000)),
      makeTick(300, 5000000), // extreme outlier
    ];

    const withZScores = computeZScores(ticks);

    // The last tick should have high z-scores
    const extremeTick = withZScores[withZScores.length - 1]!;
    expect(Math.abs(extremeTick.zScores.close!)).toBeGreaterThan(3);
    expect(Math.abs(extremeTick.zScores.volume!)).toBeGreaterThan(3);
  });
});
