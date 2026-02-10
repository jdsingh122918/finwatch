import { describe, it, expect } from "vitest";
import {
  detectRegime,
  type IndicatorSnapshot,
  type RegimeContext,
} from "../regime-detector.js";

function makeIndicators(overrides: Partial<IndicatorSnapshot> = {}): IndicatorSnapshot {
  return {
    rsi: 50,
    macdHistogram: 0,
    macdLine: 0,
    macdSignal: 0,
    bollingerPercentB: 0.5,
    bollingerWidth: 0.04,
    atr: 1.0,
    atrAvg20: 1.0,
    ...overrides,
  };
}

describe("detectRegime", () => {
  describe("volatile regime", () => {
    it("detects volatile when ATR is >1.5x its 20-day average", () => {
      const result = detectRegime(
        makeIndicators({ atr: 2.0, atrAvg20: 1.0 })
      );
      expect(result.regime).toBe("volatile");
      expect(result.atrMultiple).toBe(2.0);
    });

    it("overrides other signals when ATR is high", () => {
      // Strong trending-up signals, but ATR is very high
      const result = detectRegime(
        makeIndicators({
          rsi: 75,
          macdHistogram: 0.5,
          macdLine: 0.3,
          macdSignal: 0.1,
          bollingerPercentB: 0.95,
          atr: 2.0,
          atrAvg20: 1.0,
        })
      );
      expect(result.regime).toBe("volatile");
    });

    it("computes volatile confidence based on atrMultiple", () => {
      const result = detectRegime(
        makeIndicators({ atr: 2.0, atrAvg20: 1.0 })
      );
      // confidence = 0.5 + (2.0 - 1.5) * 0.2 = 0.6
      expect(result.confidence).toBeCloseTo(0.6, 2);
    });

    it("clamps volatile confidence to max 1.0", () => {
      const result = detectRegime(
        makeIndicators({ atr: 5.0, atrAvg20: 1.0 })
      );
      // confidence = 0.5 + (5.0 - 1.5) * 0.2 = 1.2 → clamped to 1.0
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe("trending_up regime", () => {
    it("detects trending_up with strong bullish signals", () => {
      const result = detectRegime(
        makeIndicators({
          rsi: 72,
          macdHistogram: 0.5,
          macdLine: 0.3,
          macdSignal: 0.1,
          bollingerPercentB: 0.95,
          atr: 1.0,
          atrAvg20: 1.0,
        })
      );
      expect(result.regime).toBe("trending_up");
    });

    it("has high confidence when all signals agree", () => {
      const result = detectRegime(
        makeIndicators({
          rsi: 72,
          macdHistogram: 0.5,
          macdLine: 0.3,
          macdSignal: 0.1,
          bollingerPercentB: 0.95,
          atr: 1.0,
          atrAvg20: 1.0,
        })
      );
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it("detects trending_up when percentB exceeds 1.0", () => {
      const result = detectRegime(
        makeIndicators({
          rsi: 65,
          macdHistogram: 0.3,
          macdLine: 0.2,
          macdSignal: 0.1,
          bollingerPercentB: 1.1,
          atr: 1.0,
          atrAvg20: 1.0,
        })
      );
      expect(result.regime).toBe("trending_up");
    });
  });

  describe("trending_down regime", () => {
    it("detects trending_down with strong bearish signals", () => {
      const result = detectRegime(
        makeIndicators({
          rsi: 28,
          macdHistogram: -0.5,
          macdLine: -0.3,
          macdSignal: -0.1,
          bollingerPercentB: 0.05,
          atr: 1.0,
          atrAvg20: 1.0,
        })
      );
      expect(result.regime).toBe("trending_down");
    });

    it("has high confidence when all bearish signals agree", () => {
      const result = detectRegime(
        makeIndicators({
          rsi: 28,
          macdHistogram: -0.5,
          macdLine: -0.3,
          macdSignal: -0.1,
          bollingerPercentB: 0.05,
          atr: 1.0,
          atrAvg20: 1.0,
        })
      );
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it("detects trending_down when percentB is below 0", () => {
      const result = detectRegime(
        makeIndicators({
          rsi: 35,
          macdHistogram: -0.3,
          macdLine: -0.2,
          macdSignal: -0.1,
          bollingerPercentB: -0.1,
          atr: 1.0,
          atrAvg20: 1.0,
        })
      );
      expect(result.regime).toBe("trending_down");
    });
  });

  describe("mean_reverting regime", () => {
    it("detects mean_reverting with neutral signals", () => {
      const result = detectRegime(
        makeIndicators({
          rsi: 50,
          macdHistogram: 0.01,
          macdLine: 0.01,
          macdSignal: 0.01,
          bollingerPercentB: 0.5,
          atr: 1.0,
          atrAvg20: 1.0,
        })
      );
      expect(result.regime).toBe("mean_reverting");
    });

    it("has high confidence when signals are clearly neutral", () => {
      const result = detectRegime(
        makeIndicators({
          rsi: 50,
          macdHistogram: 0,
          macdLine: 0,
          macdSignal: 0,
          bollingerPercentB: 0.5,
          atr: 1.0,
          atrAvg20: 1.0,
        })
      );
      expect(result.confidence).toBeGreaterThanOrEqual(0.6);
    });
  });

  describe("conflict resolution", () => {
    it("falls back to volatile when indicators disagree", () => {
      // RSI says overbought, MACD says bearish, Bollinger neutral
      const result = detectRegime(
        makeIndicators({
          rsi: 75,
          macdHistogram: -0.3,
          macdLine: -0.2,
          macdSignal: -0.1,
          bollingerPercentB: 0.5,
          atr: 1.0,
          atrAvg20: 1.0,
        })
      );
      expect(result.regime).toBe("volatile");
      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
      expect(result.confidence).toBeLessThanOrEqual(0.5);
    });

    it("falls back to volatile when RSI bearish but MACD bullish", () => {
      const result = detectRegime(
        makeIndicators({
          rsi: 25,
          macdHistogram: 0.5,
          macdLine: 0.3,
          macdSignal: 0.1,
          bollingerPercentB: 0.5,
          atr: 1.0,
          atrAvg20: 1.0,
        })
      );
      expect(result.regime).toBe("volatile");
      expect(result.confidence).toBeGreaterThanOrEqual(0.3);
      expect(result.confidence).toBeLessThanOrEqual(0.5);
    });
  });

  describe("RSI zone classification", () => {
    it("classifies RSI > 70 as overbought", () => {
      const result = detectRegime(
        makeIndicators({
          rsi: 75,
          macdHistogram: 0.3,
          macdLine: 0.2,
          macdSignal: 0.1,
          bollingerPercentB: 0.9,
          atr: 1.0,
          atrAvg20: 1.0,
        })
      );
      expect(result.rsiZone).toBe("overbought");
    });

    it("classifies RSI < 30 as oversold", () => {
      const result = detectRegime(
        makeIndicators({
          rsi: 25,
          macdHistogram: -0.3,
          macdLine: -0.2,
          macdSignal: -0.1,
          bollingerPercentB: 0.1,
          atr: 1.0,
          atrAvg20: 1.0,
        })
      );
      expect(result.rsiZone).toBe("oversold");
    });

    it("classifies RSI 30-70 as neutral", () => {
      const result = detectRegime(makeIndicators({ rsi: 50 }));
      expect(result.rsiZone).toBe("neutral");
    });

    it("classifies RSI exactly 70 as neutral", () => {
      const result = detectRegime(makeIndicators({ rsi: 70 }));
      expect(result.rsiZone).toBe("neutral");
    });

    it("classifies RSI exactly 30 as neutral", () => {
      const result = detectRegime(makeIndicators({ rsi: 30 }));
      expect(result.rsiZone).toBe("neutral");
    });
  });

  describe("confidence bounds", () => {
    it("never returns confidence below 0", () => {
      const inputs: IndicatorSnapshot[] = [
        makeIndicators({ atr: 0.5, atrAvg20: 1.0 }),
        makeIndicators({ rsi: 50 }),
        makeIndicators({ rsi: 75, macdHistogram: -0.5, macdLine: -0.3, macdSignal: -0.1 }),
      ];
      for (const snap of inputs) {
        const result = detectRegime(snap);
        expect(result.confidence).toBeGreaterThanOrEqual(0);
      }
    });

    it("never returns confidence above 1", () => {
      const inputs: IndicatorSnapshot[] = [
        makeIndicators({ atr: 10.0, atrAvg20: 1.0 }),
        makeIndicators({
          rsi: 90,
          macdHistogram: 2.0,
          macdLine: 1.5,
          macdSignal: 0.5,
          bollingerPercentB: 1.5,
        }),
      ];
      for (const snap of inputs) {
        const result = detectRegime(snap);
        expect(result.confidence).toBeLessThanOrEqual(1);
      }
    });
  });

  describe("atrMultiple computation", () => {
    it("computes atrMultiple as atr / atrAvg20", () => {
      const result = detectRegime(
        makeIndicators({ atr: 1.5, atrAvg20: 1.0 })
      );
      expect(result.atrMultiple).toBeCloseTo(1.5, 5);
    });

    it("handles atrAvg20 near zero gracefully", () => {
      const result = detectRegime(
        makeIndicators({ atr: 1.0, atrAvg20: 0.001 })
      );
      expect(result.atrMultiple).toBeGreaterThan(0);
      expect(Number.isFinite(result.atrMultiple)).toBe(true);
    });
  });
});
