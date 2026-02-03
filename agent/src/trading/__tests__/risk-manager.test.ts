import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TradeAction, RiskLimits, TradeAuditEntry } from "@finwatch/shared";
import { RiskManager } from "../risk-manager.js";
import type { RiskCheckResult } from "../risk-manager.js";

function makeAction(overrides: Partial<TradeAction> = {}): TradeAction {
  return {
    symbol: "AAPL",
    side: "buy",
    qty: 5,
    type: "market",
    rationale: "Test",
    confidence: 0.8,
    anomalyId: "a-001",
    ...overrides,
  };
}

const defaultLimits: RiskLimits = {
  maxPositionSize: 1000,
  maxExposure: 5000,
  maxDailyTrades: 10,
  maxLossPct: 5,
  cooldownMs: 900000, // 15 min
};

describe("RiskManager", () => {
  let rm: RiskManager;

  beforeEach(() => {
    rm = new RiskManager(defaultLimits);
  });

  it("approves a trade within all limits", () => {
    const result = rm.check(makeAction({ qty: 5 }), {
      currentPrice: 150,
      currentExposure: 0,
      dailyTradeCount: 0,
      lastTradeTimestamp: undefined,
    });

    expect(result.approved).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.limitsChecked.length).toBeGreaterThan(0);
  });

  it("rejects trade exceeding maxPositionSize", () => {
    const result = rm.check(makeAction({ qty: 10 }), {
      currentPrice: 200, // 10 * 200 = 2000 > 1000
      currentExposure: 0,
      dailyTradeCount: 0,
      lastTradeTimestamp: undefined,
    });

    expect(result.approved).toBe(false);
    expect(result.violations).toContain("maxPositionSize");
  });

  it("rejects trade exceeding maxExposure", () => {
    const result = rm.check(makeAction({ qty: 3 }), {
      currentPrice: 150, // existing 4800 + 3*150 = 5250 > 5000
      currentExposure: 4800,
      dailyTradeCount: 0,
      lastTradeTimestamp: undefined,
    });

    expect(result.approved).toBe(false);
    expect(result.violations).toContain("maxExposure");
  });

  it("rejects trade exceeding maxDailyTrades", () => {
    const result = rm.check(makeAction(), {
      currentPrice: 150,
      currentExposure: 0,
      dailyTradeCount: 10, // at limit
      lastTradeTimestamp: undefined,
    });

    expect(result.approved).toBe(false);
    expect(result.violations).toContain("maxDailyTrades");
  });

  it("rejects trade within cooldown period", () => {
    const result = rm.check(makeAction({ symbol: "AAPL" }), {
      currentPrice: 150,
      currentExposure: 0,
      dailyTradeCount: 0,
      lastTradeTimestamp: Date.now() - 60000, // 1 min ago, cooldown is 15 min
      lastTradeSymbol: "AAPL",
    });

    expect(result.approved).toBe(false);
    expect(result.violations).toContain("cooldown");
  });

  it("approves trade after cooldown expired", () => {
    const result = rm.check(makeAction({ symbol: "AAPL" }), {
      currentPrice: 150,
      currentExposure: 0,
      dailyTradeCount: 0,
      lastTradeTimestamp: Date.now() - 1000000, // well past cooldown
      lastTradeSymbol: "AAPL",
    });

    expect(result.approved).toBe(true);
  });

  it("cooldown only applies to same symbol", () => {
    const result = rm.check(makeAction({ symbol: "TSLA" }), {
      currentPrice: 150,
      currentExposure: 0,
      dailyTradeCount: 0,
      lastTradeTimestamp: Date.now() - 60000, // 1 min ago
      lastTradeSymbol: "AAPL", // different symbol
    });

    expect(result.approved).toBe(true);
  });

  it("collects multiple violations", () => {
    const result = rm.check(makeAction({ qty: 100 }), {
      currentPrice: 200, // 100 * 200 = 20000 > maxPositionSize AND > maxExposure
      currentExposure: 4500,
      dailyTradeCount: 10,
      lastTradeTimestamp: undefined,
    });

    expect(result.approved).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
    expect(result.violations).toContain("maxPositionSize");
    expect(result.violations).toContain("maxDailyTrades");
  });

  it("always sells are allowed (no position size check on sell)", () => {
    const result = rm.check(makeAction({ side: "sell", qty: 100 }), {
      currentPrice: 200,
      currentExposure: 0,
      dailyTradeCount: 0,
      lastTradeTimestamp: undefined,
    });

    // Sells reduce exposure — maxPositionSize and maxExposure don't apply
    expect(result.approved).toBe(true);
  });

  it("records all limits checked in result", () => {
    const result = rm.check(makeAction(), {
      currentPrice: 100,
      currentExposure: 0,
      dailyTradeCount: 0,
      lastTradeTimestamp: undefined,
    });

    expect(result.limitsChecked).toContain("maxPositionSize");
    expect(result.limitsChecked).toContain("maxExposure");
    expect(result.limitsChecked).toContain("maxDailyTrades");
    expect(result.limitsChecked).toContain("cooldown");
  });

  it("uses paper limits when mode is paper", () => {
    const paperLimits: RiskLimits = {
      maxPositionSize: 10000,
      maxExposure: 50000,
      maxDailyTrades: 999,
      maxLossPct: 5,
      cooldownMs: 0,
    };
    const paperRm = new RiskManager(paperLimits);

    const result = paperRm.check(makeAction({ qty: 50 }), {
      currentPrice: 180, // 50 * 180 = 9000, under paper limit
      currentExposure: 0,
      dailyTradeCount: 0,
      lastTradeTimestamp: undefined,
    });

    expect(result.approved).toBe(true);
  });
});
