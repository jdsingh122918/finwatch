import { describe, it, expect } from "vitest";
import { classifyRegime, type Indicators } from "../regime-classifier.js";

describe("classifyRegime", () => {
  it("returns momentum for high RSI and positive MACD histogram", () => {
    const indicators: Indicators = {
      rsi: 72,
      macd: { macdLine: 2.5, signalLine: 1.0, histogram: 1.5 },
    };
    expect(classifyRegime(indicators)).toBe("momentum");
  });

  it("returns momentum for low RSI (oversold momentum)", () => {
    const indicators: Indicators = {
      rsi: 25,
      macd: { macdLine: -2.0, signalLine: -1.0, histogram: -1.0 },
    };
    expect(classifyRegime(indicators)).toBe("momentum");
  });

  it("returns mean-reversion for RSI near 50 and small MACD histogram", () => {
    const indicators: Indicators = {
      rsi: 48,
      macd: { macdLine: 0.1, signalLine: 0.05, histogram: 0.05 },
    };
    expect(classifyRegime(indicators)).toBe("mean-reversion");
  });

  it("returns neutral for moderate RSI with significant MACD", () => {
    const indicators: Indicators = {
      rsi: 55,
      macd: { macdLine: 1.0, signalLine: 0.5, histogram: 0.5 },
    };
    expect(classifyRegime(indicators)).toBe("neutral");
  });

  it("returns unknown when RSI is undefined", () => {
    const indicators: Indicators = {
      macd: { macdLine: 1.0, signalLine: 0.5, histogram: 0.5 },
    };
    expect(classifyRegime(indicators)).toBe("unknown");
  });

  it("returns unknown when MACD is undefined", () => {
    const indicators: Indicators = {
      rsi: 60,
    };
    expect(classifyRegime(indicators)).toBe("unknown");
  });

  it("returns unknown when both are undefined", () => {
    const indicators: Indicators = {};
    expect(classifyRegime(indicators)).toBe("unknown");
  });
});
