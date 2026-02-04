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
    expect(metrics.monthlyReturns.length).toBeGreaterThanOrEqual(1);
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
    // Should be a positive number since net positive
    expect(metrics.sharpeRatio).toBeGreaterThan(0);
  });
});
