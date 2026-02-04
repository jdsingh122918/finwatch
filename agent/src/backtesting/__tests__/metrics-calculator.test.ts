import { describe, it, expect } from "vitest";
import type { BacktestTrade } from "@finwatch/shared";
import { calculateMetrics } from "../metrics-calculator.js";

function makeTrade(overrides: Partial<BacktestTrade>): BacktestTrade {
  return {
    id: "btt-1",
    backtestId: "bt-001",
    symbol: "AAPL",
    side: "sell",
    qty: 10,
    fillPrice: 110,
    timestamp: 2000,
    anomalyId: "a-1",
    rationale: "Test",
    realizedPnl: 100,
    ...overrides,
  };
}

describe("calculateMetrics", () => {
  it("returns zero metrics for empty trades", () => {
    const metrics = calculateMetrics([], [], 100000);
    expect(metrics.totalTrades).toBe(0);
    expect(metrics.totalReturn).toBe(0);
    expect(metrics.winRate).toBe(0);
    expect(metrics.sharpeRatio).toBe(0);
  });

  it("calculates total return correctly", () => {
    const trades = [
      makeTrade({ id: "t1", realizedPnl: 500, timestamp: 1000 }),
      makeTrade({ id: "t2", realizedPnl: -200, timestamp: 2000 }),
      makeTrade({ id: "t3", realizedPnl: 300, timestamp: 3000 }),
    ];
    const curve = [
      { date: "2024-01-01", value: 100000 },
      { date: "2024-01-02", value: 100500 },
      { date: "2024-01-03", value: 100300 },
      { date: "2024-01-04", value: 100600 },
    ];
    const metrics = calculateMetrics(trades, curve, 100000);
    expect(metrics.totalReturn).toBe(600);
    expect(metrics.totalReturnPct).toBeCloseTo(0.6);
  });

  it("calculates win rate from sell trades only", () => {
    const trades = [
      makeTrade({ id: "t1", side: "buy", realizedPnl: null }),
      makeTrade({ id: "t2", side: "sell", realizedPnl: 100 }),
      makeTrade({ id: "t3", side: "sell", realizedPnl: -50 }),
      makeTrade({ id: "t4", side: "sell", realizedPnl: 200 }),
    ];
    const metrics = calculateMetrics(trades, [], 100000);
    // 2 winning sells out of 3 total sells
    expect(metrics.winRate).toBeCloseTo(2 / 3);
    expect(metrics.totalTrades).toBe(3); // only counts sells
  });

  it("calculates max drawdown from equity curve", () => {
    const curve = [
      { date: "2024-01-01", value: 100000 },
      { date: "2024-01-02", value: 105000 },
      { date: "2024-01-03", value: 95000 },  // 9.52% from peak
      { date: "2024-01-04", value: 98000 },
    ];
    const metrics = calculateMetrics([], curve, 100000);
    // Max drawdown: (105000 - 95000) / 105000 = 9.52%
    expect(metrics.maxDrawdownPct).toBeCloseTo(9.52, 1);
  });

  it("calculates profit factor", () => {
    const trades = [
      makeTrade({ id: "t1", realizedPnl: 500 }),
      makeTrade({ id: "t2", realizedPnl: -200 }),
      makeTrade({ id: "t3", realizedPnl: 300 }),
    ];
    const metrics = calculateMetrics(trades, [], 100000);
    // Profit factor: gross profit / gross loss = 800 / 200 = 4.0
    expect(metrics.profitFactor).toBeCloseTo(4.0);
  });

  it("calculates max consecutive wins and losses", () => {
    const trades = [
      makeTrade({ id: "t1", realizedPnl: 100, timestamp: 1000 }),
      makeTrade({ id: "t2", realizedPnl: 200, timestamp: 2000 }),
      makeTrade({ id: "t3", realizedPnl: 50, timestamp: 3000 }),
      makeTrade({ id: "t4", realizedPnl: -100, timestamp: 4000 }),
      makeTrade({ id: "t5", realizedPnl: -50, timestamp: 5000 }),
    ];
    const metrics = calculateMetrics(trades, [], 100000);
    expect(metrics.maxConsecutiveWins).toBe(3);
    expect(metrics.maxConsecutiveLosses).toBe(2);
  });

  it("calculates per-symbol breakdown", () => {
    const trades = [
      makeTrade({ id: "t1", symbol: "AAPL", realizedPnl: 100, timestamp: 1000 }),
      makeTrade({ id: "t2", symbol: "TSLA", realizedPnl: -50, timestamp: 2000 }),
      makeTrade({ id: "t3", symbol: "AAPL", realizedPnl: 200, timestamp: 3000 }),
    ];
    const metrics = calculateMetrics(trades, [], 100000);
    expect(metrics.perSymbol["AAPL"]).toBeDefined();
    expect(metrics.perSymbol["AAPL"].totalReturn).toBe(300);
    expect(metrics.perSymbol["TSLA"].totalReturn).toBe(-50);
  });

  it("calculates monthly returns", () => {
    const curve = [
      { date: "2024-01-01", value: 100000 },
      { date: "2024-01-31", value: 102000 },
      { date: "2024-02-01", value: 102000 },
      { date: "2024-02-28", value: 101000 },
    ];
    const metrics = calculateMetrics([], curve, 100000);
    expect(metrics.monthlyReturns.length).toBe(2);
    // Jan: 100000 -> 102000 = 2%
    expect(metrics.monthlyReturns[0].return).toBeCloseTo(2.0, 1);
    // Feb: 102000 -> 101000 = -0.98%
    expect(metrics.monthlyReturns[1].return).toBeCloseTo(-0.98, 1);
  });

  it("calculates sharpe ratio from daily returns", () => {
    // Construct a curve with known daily returns
    const curve = [
      { date: "2024-01-01", value: 100000 },
      { date: "2024-01-02", value: 101000 }, // +1%
      { date: "2024-01-03", value: 100500 }, // -0.495%
      { date: "2024-01-04", value: 102000 }, // +1.49%
      { date: "2024-01-05", value: 101500 }, // -0.49%
    ];
    const metrics = calculateMetrics([], curve, 100000);
    // Daily returns: [0.01, -0.004950495, 0.014925373, -0.004901961]
    // mean = 0.003768, stddev = 0.009388, sharpe = (mean/std)*sqrt(252) ~ 6.37
    expect(metrics.sharpeRatio).toBeCloseTo(6.37, 0);
  });

  it("caps profitFactor to 9999.99 when all trades are winners", () => {
    const trades = [
      makeTrade({ id: "t1", realizedPnl: 500 }),
      makeTrade({ id: "t2", realizedPnl: 300 }),
      makeTrade({ id: "t3", realizedPnl: 200 }),
    ];
    const metrics = calculateMetrics(trades, [], 100000);
    expect(metrics.profitFactor).toBe(9999.99);
  });

  it("caps avgWinLossRatio to 9999.99 when no losses", () => {
    const trades = [
      makeTrade({ id: "t1", realizedPnl: 500 }),
      makeTrade({ id: "t2", realizedPnl: 300 }),
    ];
    const metrics = calculateMetrics(trades, [], 100000);
    expect(metrics.avgWinLossRatio).toBe(9999.99);
  });

  it("calculates sortino ratio with negative returns", () => {
    // Curve with both positive and negative returns
    const curve = [
      { date: "2024-01-01", value: 100000 },
      { date: "2024-01-02", value: 102000 },  // +2%
      { date: "2024-01-03", value: 99000 },   // -2.94%
      { date: "2024-01-04", value: 101000 },  // +2.02%
      { date: "2024-01-05", value: 98000 },   // -2.97%
      { date: "2024-01-06", value: 100000 },  // +2.04%
    ];
    const metrics = calculateMetrics([], curve, 100000);
    // Daily returns: [0.02, -0.02941, 0.02020, -0.02970, 0.02041]
    // mean = 0.000300, downside returns: [-0.02941, -0.02970]
    // downsideVariance = (0.02941^2 + 0.02970^2) / 2 = 0.000876
    // downsideStd = 0.02960
    // sortino = (0.000300 / 0.02960) * sqrt(252) ~ 0.161
    expect(metrics.sortinoRatio).toBeCloseTo(0.161, 0);
  });

  it("calculates monthly returns with specific values", () => {
    const curve = [
      { date: "2024-01-01", value: 100000 },
      { date: "2024-01-31", value: 102000 },
      { date: "2024-02-01", value: 102000 },
      { date: "2024-02-28", value: 101000 },
    ];
    const metrics = calculateMetrics([], curve, 100000);
    expect(metrics.monthlyReturns.length).toBe(2);
    // Jan: 100000 -> 102000 = 2%
    expect(metrics.monthlyReturns[0].return).toBeCloseTo(2.0, 1);
    // Feb: 102000 -> 101000 = -0.98%
    expect(metrics.monthlyReturns[1].return).toBeCloseTo(-0.98, 1);
  });
});
