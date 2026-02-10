import { describe, it, expect } from "vitest";
import type { Anomaly } from "@finwatch/shared";
import { scoreConfluence } from "../confluence-scorer.js";
import type { SignalScore } from "../confluence-scorer.js";
import type { RegimeContext, IndicatorSnapshot } from "../regime-detector.js";

function makeAnomaly(overrides: Partial<Anomaly> = {}): Anomaly {
  return {
    id: "anomaly-001",
    severity: "high",
    source: "alpaca-stream",
    symbol: "AAPL",
    timestamp: Date.now(),
    description: "Price spike detected",
    metrics: { close: 200, priceChange: 0.05 },
    preScreenScore: 0.85,
    sessionId: "session-001",
    ...overrides,
  };
}

function makeIndicators(overrides: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot {
  return {
    rsi: 50,
    macdHistogram: 0,
    macdLine: 0,
    macdSignal: 0,
    bollingerPercentB: 0.5,
    bollingerWidth: 0.02,
    atr: 2.0,
    atrAvg20: 1.8,
    ...overrides,
  };
}

function makeRegime(overrides: Partial<RegimeContext> = {}): RegimeContext {
  return {
    regime: "volatile",
    confidence: 0.7,
    atrMultiple: 1.1,
    rsiZone: "neutral",
    ...overrides,
  };
}

describe("scoreConfluence", () => {
  describe("return shape", () => {
    it("returns a valid SignalScore with all required fields", () => {
      const score = scoreConfluence(makeAnomaly(), makeIndicators(), makeRegime());
      expect(score).toHaveProperty("total");
      expect(score).toHaveProperty("components");
      expect(score).toHaveProperty("direction");
      expect(score).toHaveProperty("regime");
      expect(score.components).toHaveProperty("anomaly");
      expect(score.components).toHaveProperty("trend");
      expect(score.components).toHaveProperty("momentum");
      expect(score.components).toHaveProperty("volume");
    });

    it("total is always between 0 and 100", () => {
      const score = scoreConfluence(makeAnomaly(), makeIndicators(), makeRegime());
      expect(score.total).toBeGreaterThanOrEqual(0);
      expect(score.total).toBeLessThanOrEqual(100);
    });
  });

  describe("direction determination", () => {
    it("price_spike defaults to short", () => {
      const anomaly = makeAnomaly({
        description: "Price spike detected",
        metrics: { priceChange: 0.05 },
      });
      const score = scoreConfluence(anomaly, makeIndicators(), makeRegime());
      expect(score.direction).toBe("short");
    });

    it("price_drop defaults to long", () => {
      const anomaly = makeAnomaly({
        description: "Price drop detected",
        metrics: { priceChange: -0.05 },
      });
      const score = scoreConfluence(anomaly, makeIndicators(), makeRegime());
      expect(score.direction).toBe("long");
    });

    it("volume_spike defaults to long", () => {
      const anomaly = makeAnomaly({
        description: "Volume spike detected",
        metrics: { volumeChange: 0.8 },
      });
      const score = scoreConfluence(anomaly, makeIndicators(), makeRegime());
      expect(score.direction).toBe("long");
    });

    it("volume_drop defaults to long", () => {
      const anomaly = makeAnomaly({
        description: "Volume drop detected",
        metrics: { volumeChange: -0.3 },
      });
      const score = scoreConfluence(anomaly, makeIndicators(), makeRegime());
      expect(score.direction).toBe("long");
    });

    it("unknown signal uses regime: trending_up -> long", () => {
      const anomaly = makeAnomaly({
        description: "Unusual activity",
        metrics: {},
      });
      const regime = makeRegime({ regime: "trending_up" });
      const score = scoreConfluence(anomaly, makeIndicators(), regime);
      expect(score.direction).toBe("long");
    });

    it("unknown signal uses regime: trending_down -> short", () => {
      const anomaly = makeAnomaly({
        description: "Unusual activity",
        metrics: {},
      });
      const regime = makeRegime({ regime: "trending_down" });
      const score = scoreConfluence(anomaly, makeIndicators(), regime);
      expect(score.direction).toBe("short");
    });

    it("unknown signal defaults to long for non-trending regimes", () => {
      const anomaly = makeAnomaly({
        description: "Unusual activity",
        metrics: {},
      });
      const regime = makeRegime({ regime: "mean_reverting" });
      const score = scoreConfluence(anomaly, makeIndicators(), regime);
      expect(score.direction).toBe("long");
    });
  });

  describe("regime overrides on direction", () => {
    it("trending_up + price_drop -> long (buy the dip)", () => {
      const anomaly = makeAnomaly({
        description: "Price drop detected",
        metrics: { priceChange: -0.05 },
      });
      const regime = makeRegime({ regime: "trending_up" });
      const score = scoreConfluence(anomaly, makeIndicators(), regime);
      expect(score.direction).toBe("long");
    });

    it("trending_up + price_spike -> long (follow momentum, not short)", () => {
      const anomaly = makeAnomaly({
        description: "Price spike detected",
        metrics: { priceChange: 0.05 },
      });
      const regime = makeRegime({ regime: "trending_up" });
      const score = scoreConfluence(anomaly, makeIndicators(), regime);
      expect(score.direction).toBe("long");
    });

    it("mean_reverting + price_spike -> short (fade the extreme)", () => {
      const anomaly = makeAnomaly({
        description: "Price spike detected",
        metrics: { priceChange: 0.05 },
      });
      const regime = makeRegime({ regime: "mean_reverting" });
      const score = scoreConfluence(anomaly, makeIndicators(), regime);
      expect(score.direction).toBe("short");
    });

    it("mean_reverting + price_drop -> long (fade the extreme)", () => {
      const anomaly = makeAnomaly({
        description: "Price drop detected",
        metrics: { priceChange: -0.05 },
      });
      const regime = makeRegime({ regime: "mean_reverting" });
      const score = scoreConfluence(anomaly, makeIndicators(), regime);
      expect(score.direction).toBe("long");
    });
  });

  describe("anomaly component scoring (0-40)", () => {
    it("critical severity + high confidence -> near max", () => {
      const anomaly = makeAnomaly({ severity: "critical", preScreenScore: 1.0 });
      const score = scoreConfluence(anomaly, makeIndicators(), makeRegime());
      // critical=15 + confidence 1.0*25=25 → 40
      expect(score.components.anomaly).toBe(40);
    });

    it("high severity + good confidence", () => {
      const anomaly = makeAnomaly({ severity: "high", preScreenScore: 0.8 });
      const score = scoreConfluence(anomaly, makeIndicators(), makeRegime());
      // high=10 + confidence 0.8*25=20 → 30
      expect(score.components.anomaly).toBe(30);
    });

    it("medium severity + moderate confidence", () => {
      const anomaly = makeAnomaly({ severity: "medium", preScreenScore: 0.6 });
      const score = scoreConfluence(anomaly, makeIndicators(), makeRegime());
      // medium=5 + confidence 0.6*25=15 → 20
      expect(score.components.anomaly).toBe(20);
    });

    it("low severity gives 0 severity points", () => {
      const anomaly = makeAnomaly({ severity: "low", preScreenScore: 0.5 });
      const score = scoreConfluence(anomaly, makeIndicators(), makeRegime());
      // low=0 + confidence 0.5*25=12.5 → 12.5
      expect(score.components.anomaly).toBeCloseTo(12.5, 1);
    });

    it("capped at 40", () => {
      const anomaly = makeAnomaly({ severity: "critical", preScreenScore: 1.5 });
      const score = scoreConfluence(anomaly, makeIndicators(), makeRegime());
      expect(score.components.anomaly).toBeLessThanOrEqual(40);
    });
  });

  describe("trend component scoring (0-20)", () => {
    it("LONG: oversold RSI + MACD crossing up -> max", () => {
      const indicators = makeIndicators({ rsi: 30, macdHistogram: 0.5 });
      const anomaly = makeAnomaly({
        description: "Price drop detected",
        metrics: { priceChange: -0.05 },
      });
      const score = scoreConfluence(anomaly, indicators, makeRegime());
      expect(score.direction).toBe("long");
      expect(score.components.trend).toBe(20);
    });

    it("LONG: overbought RSI -> 0 RSI points", () => {
      const indicators = makeIndicators({ rsi: 75, macdHistogram: 0.5 });
      const anomaly = makeAnomaly({
        description: "Price drop detected",
        metrics: { priceChange: -0.05 },
      });
      const score = scoreConfluence(anomaly, indicators, makeRegime());
      // RSI=75 (>70) → 0 for RSI, MACD up → 10 for MACD
      expect(score.components.trend).toBe(10);
    });

    it("LONG: neutral RSI interpolates between thresholds", () => {
      // RSI=55 is between 40 and 70 — should interpolate: (70-55)/(70-40)*10 = 5
      const indicators = makeIndicators({ rsi: 55, macdHistogram: 0 });
      const anomaly = makeAnomaly({
        description: "Price drop detected",
        metrics: { priceChange: -0.05 },
      });
      const score = scoreConfluence(anomaly, indicators, makeRegime());
      expect(score.components.trend).toBe(5);
    });

    it("SHORT: high RSI + MACD crossing down -> max", () => {
      const indicators = makeIndicators({ rsi: 70, macdHistogram: -0.5 });
      const anomaly = makeAnomaly({
        description: "Price spike detected",
        metrics: { priceChange: 0.05 },
      });
      const regime = makeRegime({ regime: "mean_reverting" });
      const score = scoreConfluence(anomaly, indicators, regime);
      expect(score.direction).toBe("short");
      expect(score.components.trend).toBe(20);
    });

    it("SHORT: low RSI -> 0 RSI points", () => {
      const indicators = makeIndicators({ rsi: 35, macdHistogram: -0.5 });
      const anomaly = makeAnomaly({
        description: "Price spike detected",
        metrics: { priceChange: 0.05 },
      });
      const regime = makeRegime({ regime: "mean_reverting" });
      const score = scoreConfluence(anomaly, indicators, regime);
      // RSI=35 (<40) → 0 RSI, MACD down → 10
      expect(score.components.trend).toBe(10);
    });
  });

  describe("momentum component scoring (0-20)", () => {
    it("LONG: price near lower Bollinger band -> max", () => {
      const indicators = makeIndicators({ bollingerPercentB: 0.1 });
      const anomaly = makeAnomaly({
        description: "Price drop detected",
        metrics: { priceChange: -0.05 },
      });
      const score = scoreConfluence(anomaly, indicators, makeRegime());
      expect(score.direction).toBe("long");
      expect(score.components.momentum).toBe(20);
    });

    it("LONG: price near upper Bollinger band -> 0", () => {
      const indicators = makeIndicators({ bollingerPercentB: 0.9 });
      const anomaly = makeAnomaly({
        description: "Price drop detected",
        metrics: { priceChange: -0.05 },
      });
      const score = scoreConfluence(anomaly, indicators, makeRegime());
      expect(score.components.momentum).toBe(0);
    });

    it("LONG: percentB at midpoint -> interpolated", () => {
      const indicators = makeIndicators({ bollingerPercentB: 0.5 });
      const anomaly = makeAnomaly({
        description: "Price drop detected",
        metrics: { priceChange: -0.05 },
      });
      const score = scoreConfluence(anomaly, indicators, makeRegime());
      expect(score.components.momentum).toBeCloseTo(10, 5);
    });

    it("SHORT: price near upper Bollinger band -> max", () => {
      const indicators = makeIndicators({ bollingerPercentB: 0.9 });
      const anomaly = makeAnomaly({
        description: "Price spike detected",
        metrics: { priceChange: 0.05 },
      });
      const regime = makeRegime({ regime: "mean_reverting" });
      const score = scoreConfluence(anomaly, indicators, regime);
      expect(score.direction).toBe("short");
      expect(score.components.momentum).toBe(20);
    });

    it("SHORT: price near lower Bollinger band -> 0", () => {
      const indicators = makeIndicators({ bollingerPercentB: 0.1 });
      const anomaly = makeAnomaly({
        description: "Price spike detected",
        metrics: { priceChange: 0.05 },
      });
      const regime = makeRegime({ regime: "mean_reverting" });
      const score = scoreConfluence(anomaly, indicators, regime);
      expect(score.components.momentum).toBe(0);
    });
  });

  describe("volume component scoring (0-20)", () => {
    it("volume spike on long signal -> 20", () => {
      const anomaly = makeAnomaly({
        description: "Price drop detected with volume surge",
        metrics: { priceChange: -0.05, volumeChange: 0.8 },
      });
      const score = scoreConfluence(anomaly, makeIndicators(), makeRegime());
      expect(score.direction).toBe("long");
      expect(score.components.volume).toBe(20);
    });

    it("volume declining on long signal -> 0", () => {
      const anomaly = makeAnomaly({
        description: "Price drop detected",
        metrics: { priceChange: -0.05, volumeChange: -0.3 },
      });
      const score = scoreConfluence(anomaly, makeIndicators(), makeRegime());
      expect(score.components.volume).toBe(0);
    });

    it("no volume data -> 10 (neutral)", () => {
      const anomaly = makeAnomaly({
        description: "Price drop detected",
        metrics: { priceChange: -0.05 },
      });
      const score = scoreConfluence(anomaly, makeIndicators(), makeRegime());
      expect(score.components.volume).toBe(10);
    });

    it("volume spike on short signal -> 20", () => {
      const anomaly = makeAnomaly({
        description: "Abnormal price movement detected",
        metrics: { priceChange: 0.05, volumeChange: 0.8 },
      });
      const regime = makeRegime({ regime: "mean_reverting" });
      const score = scoreConfluence(anomaly, makeIndicators(), regime);
      expect(score.direction).toBe("short");
      expect(score.components.volume).toBe(20);
    });
  });

  describe("composite scoring scenarios", () => {
    it("max score: critical anomaly, strong alignment, full confirmation -> > 80", () => {
      const anomaly = makeAnomaly({
        severity: "critical",
        preScreenScore: 1.0,
        description: "Price drop detected with volume surge",
        metrics: { priceChange: -0.05, volumeChange: 0.8 },
      });
      // For LONG: RSI oversold, MACD crossing up, near lower Bollinger band
      const indicators = makeIndicators({
        rsi: 25,
        macdHistogram: 0.5,
        bollingerPercentB: 0.05,
      });
      const score = scoreConfluence(anomaly, indicators, makeRegime());
      expect(score.direction).toBe("long");
      // anomaly: 15+25=40, trend: 10+10=20, momentum: 20, volume: 20 → 100
      expect(score.total).toBeGreaterThan(80);
    });

    it("minimum actionable: high anomaly, weak alignment -> 40-60", () => {
      const anomaly = makeAnomaly({
        severity: "high",
        preScreenScore: 0.7,
        description: "Price drop detected",
        metrics: { priceChange: -0.04 },
      });
      // Neutral indicators
      const indicators = makeIndicators({
        rsi: 50,
        macdHistogram: 0,
        bollingerPercentB: 0.5,
      });
      const score = scoreConfluence(anomaly, indicators, makeRegime());
      // anomaly: 10+17.5=27.5, trend: ~6.7+0=6.7, momentum: 10, volume: 10 → ~54
      expect(score.total).toBeGreaterThanOrEqual(40);
      expect(score.total).toBeLessThanOrEqual(60);
    });

    it("below threshold: low severity, conflicting indicators -> < 40", () => {
      const anomaly = makeAnomaly({
        severity: "low",
        preScreenScore: 0.3,
        description: "Price drop detected",
        metrics: { priceChange: -0.04, volumeChange: -0.5 },
      });
      // Conflicting: for LONG, RSI overbought, MACD down, near upper band
      const indicators = makeIndicators({
        rsi: 80,
        macdHistogram: -0.5,
        bollingerPercentB: 0.95,
      });
      const score = scoreConfluence(anomaly, indicators, makeRegime());
      // anomaly: 0+7.5=7.5, trend: 0+0=0, momentum: 0, volume: 0 → 7.5
      expect(score.total).toBeLessThan(40);
    });

    it("total equals sum of components", () => {
      const score = scoreConfluence(makeAnomaly(), makeIndicators(), makeRegime());
      const sum =
        score.components.anomaly +
        score.components.trend +
        score.components.momentum +
        score.components.volume;
      expect(score.total).toBeCloseTo(sum, 5);
    });

    it("regime is passed through to result", () => {
      const regime = makeRegime({ regime: "trending_up", confidence: 0.9 });
      const score = scoreConfluence(makeAnomaly(), makeIndicators(), regime);
      expect(score.regime).toEqual(regime);
    });
  });
});
