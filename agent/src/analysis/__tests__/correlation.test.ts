import { describe, it, expect } from "vitest";
import {
  pearsonCorrelation,
  computeReturns,
  CorrelationDetector,
  type CorrelationPair,
} from "../correlation.js";

describe("pearsonCorrelation", () => {
  it("returns 1 for perfectly positively correlated data", () => {
    const x = [1, 2, 3, 4, 5];
    const y = [2, 4, 6, 8, 10];
    expect(pearsonCorrelation(x, y)).toBeCloseTo(1.0, 5);
  });

  it("returns -1 for perfectly negatively correlated data", () => {
    const x = [1, 2, 3, 4, 5];
    const y = [10, 8, 6, 4, 2];
    expect(pearsonCorrelation(x, y)).toBeCloseTo(-1.0, 5);
  });

  it("returns 0 for uncorrelated data", () => {
    // Perfectly uncorrelated: one series is constant
    const x = [1, 2, 3, 4, 5];
    const y = [5, 5, 5, 5, 5];
    expect(pearsonCorrelation(x, y)).toBeCloseTo(0, 5);
  });

  it("returns NaN for single-element arrays", () => {
    const result = pearsonCorrelation([1], [2]);
    expect(Number.isNaN(result)).toBe(true);
  });

  it("returns NaN for empty arrays", () => {
    const result = pearsonCorrelation([], []);
    expect(Number.isNaN(result)).toBe(true);
  });

  it("handles partial correlation", () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const y = [1, 3, 2, 5, 4, 7, 6, 9, 8, 10];
    const corr = pearsonCorrelation(x, y);
    expect(corr).toBeGreaterThan(0.8);
    expect(corr).toBeLessThan(1.0);
  });
});

describe("computeReturns", () => {
  it("computes percentage returns from prices", () => {
    const prices = [100, 110, 105, 115];
    const returns = computeReturns(prices);
    expect(returns).toHaveLength(3);
    expect(returns[0]).toBeCloseTo(0.1, 5); // 10%
    expect(returns[1]).toBeCloseTo(-0.04545, 4); // -4.5%
    expect(returns[2]).toBeCloseTo(0.09524, 4); // 9.5%
  });

  it("returns empty array for single price", () => {
    expect(computeReturns([100])).toEqual([]);
  });

  it("returns empty array for empty prices", () => {
    expect(computeReturns([])).toEqual([]);
  });
});

describe("CorrelationDetector", () => {
  it("computes pairwise correlations for symbol groups", () => {
    const detector = new CorrelationDetector();

    // Generate correlated price data
    const ticksA: Array<{ symbol: string; close: number }> = [];
    const ticksB: Array<{ symbol: string; close: number }> = [];
    for (let i = 0; i < 15; i++) {
      ticksA.push({ symbol: "AAPL", close: 100 + i * 2 });
      ticksB.push({ symbol: "MSFT", close: 200 + i * 3 });
    }

    const priceHistory = new Map<string, number[]>();
    priceHistory.set("AAPL", ticksA.map(t => t.close));
    priceHistory.set("MSFT", ticksB.map(t => t.close));

    const pairs = detector.computeCorrelations(priceHistory);

    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.symbolA).toBe("AAPL");
    expect(pairs[0]!.symbolB).toBe("MSFT");
    expect(pairs[0]!.correlation).toBeCloseTo(1.0, 1);
  });

  it("returns empty when fewer than 2 symbols", () => {
    const detector = new CorrelationDetector();
    const priceHistory = new Map<string, number[]>();
    priceHistory.set("AAPL", [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110]);

    const pairs = detector.computeCorrelations(priceHistory);
    expect(pairs).toEqual([]);
  });

  it("skips pairs with insufficient overlapping data", () => {
    const detector = new CorrelationDetector();
    const priceHistory = new Map<string, number[]>();
    priceHistory.set("AAPL", [100, 101, 102]); // Only 3 prices -> 2 returns
    priceHistory.set("MSFT", [200, 201, 202]);

    const pairs = detector.computeCorrelations(priceHistory);
    expect(pairs).toEqual([]);
  });

  it("detectBreakdowns filters high-deviation pairs", () => {
    const detector = new CorrelationDetector();

    const pairs: CorrelationPair[] = [
      { symbolA: "AAPL", symbolB: "MSFT", correlation: 0.95, historicalCorrelation: 0.95, deviation: 0 },
      { symbolA: "AAPL", symbolB: "GOOG", correlation: 0.2, historicalCorrelation: 0.85, deviation: 0.65 },
      { symbolA: "MSFT", symbolB: "GOOG", correlation: -0.3, historicalCorrelation: 0.5, deviation: 0.8 },
    ];

    const breakdowns = detector.detectBreakdowns(pairs, 0.3);
    expect(breakdowns).toHaveLength(2);
    expect(breakdowns[0]!.symbolA).toBe("MSFT"); // Higher deviation first
    expect(breakdowns[1]!.symbolA).toBe("AAPL");
  });

  it("updates historical correlation with EMA", () => {
    const detector = new CorrelationDetector();

    // Set initial historical value
    detector.updateHistorical("AAPL", "MSFT", 0.8);

    // Update with new value
    detector.updateHistorical("AAPL", "MSFT", 0.6);

    // EMA: 0.95 * 0.8 + 0.05 * 0.6 = 0.79
    const historical = detector.getHistorical("AAPL", "MSFT");
    expect(historical).toBeCloseTo(0.79, 2);
  });
});
