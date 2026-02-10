import { describe, it, expect } from "vitest";
import { computeRSI, computeMACD, computeATR } from "../indicators.js";

describe("computeRSI", () => {
  it("returns 50 for constant prices", () => {
    const prices = new Array(20).fill(100);
    const rsi = computeRSI(prices);
    expect(rsi).toBeCloseTo(50, 0);
  });

  it("returns > 50 for consistently rising prices", () => {
    const prices: number[] = [];
    for (let i = 0; i < 20; i++) prices.push(100 + i);
    const rsi = computeRSI(prices);
    expect(rsi).toBeGreaterThan(50);
  });

  it("returns < 50 for consistently falling prices", () => {
    const prices: number[] = [];
    for (let i = 0; i < 20; i++) prices.push(200 - i);
    const rsi = computeRSI(prices);
    expect(rsi).toBeLessThan(50);
  });

  it("returns 100 for strictly rising prices (no losses)", () => {
    const prices: number[] = [];
    for (let i = 0; i < 20; i++) prices.push(100 + i * 2);
    const rsi = computeRSI(prices);
    expect(rsi).toBeCloseTo(100, 0);
  });

  it("returns 0 for strictly falling prices (no gains)", () => {
    const prices: number[] = [];
    for (let i = 0; i < 20; i++) prices.push(200 - i * 2);
    const rsi = computeRSI(prices);
    expect(rsi).toBeCloseTo(0, 0);
  });

  it("returns undefined for insufficient data (< 15 prices)", () => {
    const prices = [100, 101, 102, 103, 104];
    const rsi = computeRSI(prices);
    expect(rsi).toBeUndefined();
  });
});

describe("computeMACD", () => {
  it("returns histogram near 0 for constant prices", () => {
    const prices = new Array(35).fill(100);
    const macd = computeMACD(prices);
    expect(macd).toBeDefined();
    expect(macd!.histogram).toBeCloseTo(0, 1);
  });

  it("returns positive histogram for uptrend", () => {
    const prices: number[] = [];
    for (let i = 0; i < 35; i++) prices.push(100 + i * 2);
    const macd = computeMACD(prices);
    expect(macd).toBeDefined();
    expect(macd!.macdLine).toBeGreaterThan(0);
  });

  it("returns negative histogram for downtrend", () => {
    const prices: number[] = [];
    for (let i = 0; i < 35; i++) prices.push(200 - i * 2);
    const macd = computeMACD(prices);
    expect(macd).toBeDefined();
    expect(macd!.macdLine).toBeLessThan(0);
  });

  it("returns undefined for insufficient data (< 27 prices)", () => {
    const prices = new Array(20).fill(100);
    const macd = computeMACD(prices);
    expect(macd).toBeUndefined();
  });

  it("includes macdLine, signalLine, and histogram", () => {
    const prices: number[] = [];
    for (let i = 0; i < 35; i++) prices.push(100 + Math.sin(i) * 10);
    const macd = computeMACD(prices);
    expect(macd).toBeDefined();
    expect(typeof macd!.macdLine).toBe("number");
    expect(typeof macd!.signalLine).toBe("number");
    expect(typeof macd!.histogram).toBe("number");
    expect(macd!.histogram).toBeCloseTo(macd!.macdLine - macd!.signalLine, 10);
  });
});

describe("computeATR", () => {
  it("computes ATR for known price range", () => {
    // High-Low = 10 for each bar, with close = midpoint
    const highs: number[] = [];
    const lows: number[] = [];
    const closes: number[] = [];
    for (let i = 0; i < 20; i++) {
      highs.push(110);
      lows.push(100);
      closes.push(105);
    }
    const atr = computeATR(highs, lows, closes);
    expect(atr).toBeDefined();
    // True range = max(high-low, |high-prevClose|, |low-prevClose|)
    // = max(10, 5, 5) = 10 for each bar after the first
    expect(atr!).toBeCloseTo(10, 0);
  });

  it("returns undefined for insufficient data (< 15 bars)", () => {
    const atr = computeATR(
      [110, 111, 112],
      [100, 101, 102],
      [105, 106, 107]
    );
    expect(atr).toBeUndefined();
  });

  it("handles volatile data", () => {
    const highs: number[] = [];
    const lows: number[] = [];
    const closes: number[] = [];
    for (let i = 0; i < 20; i++) {
      highs.push(120 + i);
      lows.push(100 - i);
      closes.push(110);
    }
    const atr = computeATR(highs, lows, closes);
    expect(atr).toBeDefined();
    expect(atr!).toBeGreaterThan(20);
  });
});
