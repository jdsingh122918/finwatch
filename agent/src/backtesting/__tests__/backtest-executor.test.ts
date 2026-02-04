import { describe, it, expect, beforeEach } from "vitest";
import { BacktestExecutor } from "../backtest-executor.js";

describe("BacktestExecutor", () => {
  let executor: BacktestExecutor;

  beforeEach(() => {
    executor = new BacktestExecutor("bt-001", 100000);
  });

  it("starts with initial capital and no positions", () => {
    expect(executor.cash).toBe(100000);
    expect(executor.getPositions()).toEqual({});
    expect(executor.getTradeLog()).toEqual([]);
  });

  it("executes a buy order — deducts cash, creates position", () => {
    executor.execute(
      { symbol: "AAPL", side: "buy", qty: 10, type: "market", rationale: "Test buy", confidence: 0.8, anomalyId: "a-1" },
      185.50,
      1706800000,
    );

    expect(executor.cash).toBe(100000 - 10 * 185.50);
    const pos = executor.getPositions();
    expect(pos["AAPL"]).toBeDefined();
    expect(pos["AAPL"].qty).toBe(10);
    expect(pos["AAPL"].avgEntry).toBe(185.50);
    expect(executor.getTradeLog()).toHaveLength(1);
    expect(executor.getTradeLog()[0].realizedPnl).toBeNull();
  });

  it("executes a sell order — adds cash, removes position, computes realized PnL", () => {
    executor.execute(
      { symbol: "AAPL", side: "buy", qty: 10, type: "market", rationale: "Buy", confidence: 0.8, anomalyId: "a-1" },
      100,
      1000,
    );
    executor.execute(
      { symbol: "AAPL", side: "sell", qty: 10, type: "market", rationale: "Sell", confidence: 0.8, anomalyId: "a-2" },
      110,
      2000,
    );

    expect(executor.cash).toBe(100000 + 10 * (110 - 100)); // profit
    const pos = executor.getPositions();
    expect(pos["AAPL"]).toBeUndefined(); // fully closed
    const log = executor.getTradeLog();
    expect(log).toHaveLength(2);
    expect(log[1].realizedPnl).toBe(100); // (110-100)*10
  });

  it("handles partial sell with FIFO lots", () => {
    executor.execute(
      { symbol: "AAPL", side: "buy", qty: 10, type: "market", rationale: "Lot 1", confidence: 0.8, anomalyId: "a-1" },
      100,
      1000,
    );
    executor.execute(
      { symbol: "AAPL", side: "buy", qty: 5, type: "market", rationale: "Lot 2", confidence: 0.8, anomalyId: "a-2" },
      120,
      2000,
    );
    executor.execute(
      { symbol: "AAPL", side: "sell", qty: 12, type: "market", rationale: "Partial sell", confidence: 0.8, anomalyId: "a-3" },
      130,
      3000,
    );

    // FIFO: sold 10@100 + 2@120 at 130
    // PnL = 10*(130-100) + 2*(130-120) = 300 + 20 = 320
    const log = executor.getTradeLog();
    expect(log[2].realizedPnl).toBe(320);

    const pos = executor.getPositions();
    expect(pos["AAPL"].qty).toBe(3); // 15 - 12 remaining
    expect(pos["AAPL"].avgEntry).toBe(120); // remaining lot
  });

  it("rejects sell when no position exists", () => {
    const trade = executor.execute(
      { symbol: "AAPL", side: "sell", qty: 10, type: "market", rationale: "No position", confidence: 0.8, anomalyId: "a-1" },
      100,
      1000,
    );
    expect(trade).toBeNull();
    expect(executor.getTradeLog()).toHaveLength(0);
  });

  it("rejects buy when insufficient cash", () => {
    const trade = executor.execute(
      { symbol: "AAPL", side: "buy", qty: 1000, type: "market", rationale: "Too expensive", confidence: 0.8, anomalyId: "a-1" },
      200,
      1000,
    );
    expect(trade).toBeNull();
  });

  it("snapshots portfolio value correctly", () => {
    executor.execute(
      { symbol: "AAPL", side: "buy", qty: 10, type: "market", rationale: "Buy", confidence: 0.8, anomalyId: "a-1" },
      100,
      1000,
    );

    const prices = { AAPL: 110 };
    const value = executor.portfolioValue(prices);
    // cash: 100000 - 1000 = 99000, positions: 10 * 110 = 1100
    expect(value).toBe(99000 + 1100);
  });

  it("tracks equity snapshots", () => {
    executor.snapshot("2024-01-01", { AAPL: 100 });
    executor.execute(
      { symbol: "AAPL", side: "buy", qty: 10, type: "market", rationale: "Buy", confidence: 0.8, anomalyId: "a-1" },
      100,
      1000,
    );
    executor.snapshot("2024-01-02", { AAPL: 110 });

    const curve = executor.getEquityCurve();
    expect(curve).toHaveLength(2);
    expect(curve[0].value).toBe(100000);
    expect(curve[1].value).toBe(99000 + 1100);
  });

  it("clamps sell qty to held position", () => {
    // Buy 5 shares of AAPL
    executor.execute(
      { symbol: "AAPL", side: "buy", qty: 5, type: "market", rationale: "Buy 5", confidence: 0.8, anomalyId: "a-1" },
      100,
      1000,
    );

    // Try to sell 10 shares (more than held)
    const trade = executor.execute(
      { symbol: "AAPL", side: "sell", qty: 10, type: "market", rationale: "Sell 10", confidence: 0.8, anomalyId: "a-2" },
      120,
      2000,
    );

    expect(trade).not.toBeNull();
    // Should only sell 5 (clamped to position size)
    expect(trade!.qty).toBe(5);
    // Realized PnL based on 5 shares: 5 * (120 - 100) = 100
    expect(trade!.realizedPnl).toBe(100);
    // Position should be fully closed
    const pos = executor.getPositions();
    expect(pos["AAPL"]).toBeUndefined();
    // Cash should reflect selling 5 shares at 120
    // Started: 100000, bought 5@100 = -500, sold 5@120 = +600 => 100000 - 500 + 600 = 100100
    expect(executor.cash).toBe(100100);
  });
});
