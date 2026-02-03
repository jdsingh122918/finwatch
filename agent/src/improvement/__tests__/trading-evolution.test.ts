import { describe, it, expect } from "vitest";
import type { TradeAuditEntry, TradeAction } from "@finwatch/shared";
import {
  TradingPerformanceAnalyzer,
  type TradingMetrics,
} from "../trading-evolution.js";

function makeAudit(overrides: Partial<TradeAuditEntry> = {}): TradeAuditEntry {
  const action: TradeAction = {
    symbol: "AAPL",
    side: "buy",
    qty: 10,
    type: "market",
    rationale: "Price spike anomaly",
    confidence: 0.85,
    anomalyId: "anomaly-001",
  };
  return {
    id: "audit-001",
    action,
    anomalyId: "anomaly-001",
    outcome: "profit",
    limitsChecked: ["maxPositionSize", "maxExposure"],
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("TradingPerformanceAnalyzer", () => {
  it("computes win rate from trade history", () => {
    const analyzer = new TradingPerformanceAnalyzer();
    const history: TradeAuditEntry[] = [
      makeAudit({ id: "1", outcome: "profit" }),
      makeAudit({ id: "2", outcome: "profit" }),
      makeAudit({ id: "3", outcome: "loss" }),
      makeAudit({ id: "4", outcome: "profit" }),
    ];

    const metrics = analyzer.analyze(history);
    expect(metrics.winRate).toBeCloseTo(0.75, 2);
  });

  it("counts resolved trades only (ignores pending/cancelled)", () => {
    const analyzer = new TradingPerformanceAnalyzer();
    const history: TradeAuditEntry[] = [
      makeAudit({ id: "1", outcome: "profit" }),
      makeAudit({ id: "2", outcome: "pending" }),
      makeAudit({ id: "3", outcome: "cancelled" }),
      makeAudit({ id: "4", outcome: "loss" }),
    ];

    const metrics = analyzer.analyze(history);
    // Only 2 resolved (profit + loss), 1 win
    expect(metrics.resolvedCount).toBe(2);
    expect(metrics.winRate).toBeCloseTo(0.5, 2);
  });

  it("computes per-symbol breakdown", () => {
    const analyzer = new TradingPerformanceAnalyzer();
    const history: TradeAuditEntry[] = [
      makeAudit({ id: "1", outcome: "profit", action: { ...makeAudit().action, symbol: "AAPL" } }),
      makeAudit({ id: "2", outcome: "loss", action: { ...makeAudit().action, symbol: "AAPL" } }),
      makeAudit({ id: "3", outcome: "profit", action: { ...makeAudit().action, symbol: "TSLA" } }),
    ];

    const metrics = analyzer.analyze(history);
    expect(metrics.bySymbol.get("AAPL")!.winRate).toBeCloseTo(0.5, 2);
    expect(metrics.bySymbol.get("TSLA")!.winRate).toBeCloseTo(1.0, 2);
  });

  it("computes per-severity breakdown from anomaly descriptions", () => {
    const analyzer = new TradingPerformanceAnalyzer();
    const highAction = { ...makeAudit().action, rationale: "Price spike anomaly" };
    const history: TradeAuditEntry[] = [
      makeAudit({ id: "1", outcome: "profit", action: highAction }),
      makeAudit({ id: "2", outcome: "loss", action: highAction }),
    ];

    const metrics = analyzer.analyze(history);
    expect(metrics.totalTrades).toBe(2);
  });

  it("returns zero win rate for empty history", () => {
    const analyzer = new TradingPerformanceAnalyzer();
    const metrics = analyzer.analyze([]);

    expect(metrics.winRate).toBe(0);
    expect(metrics.totalTrades).toBe(0);
    expect(metrics.resolvedCount).toBe(0);
  });

  it("generates performance summary markdown", () => {
    const analyzer = new TradingPerformanceAnalyzer();
    const history: TradeAuditEntry[] = [
      makeAudit({ id: "1", outcome: "profit", action: { ...makeAudit().action, symbol: "AAPL" } }),
      makeAudit({ id: "2", outcome: "loss", action: { ...makeAudit().action, symbol: "TSLA" } }),
      makeAudit({ id: "3", outcome: "profit", action: { ...makeAudit().action, symbol: "AAPL" } }),
    ];

    const md = analyzer.generateReport(history);
    expect(md).toContain("# Trading Performance");
    expect(md).toContain("Win Rate");
    expect(md).toContain("AAPL");
    expect(md).toContain("TSLA");
  });

  it("identifies best and worst performing symbols", () => {
    const analyzer = new TradingPerformanceAnalyzer();
    const history: TradeAuditEntry[] = [
      makeAudit({ id: "1", outcome: "profit", action: { ...makeAudit().action, symbol: "AAPL" } }),
      makeAudit({ id: "2", outcome: "profit", action: { ...makeAudit().action, symbol: "AAPL" } }),
      makeAudit({ id: "3", outcome: "loss", action: { ...makeAudit().action, symbol: "TSLA" } }),
      makeAudit({ id: "4", outcome: "loss", action: { ...makeAudit().action, symbol: "TSLA" } }),
    ];

    const metrics = analyzer.analyze(history);
    expect(metrics.bySymbol.get("AAPL")!.winRate).toBe(1.0);
    expect(metrics.bySymbol.get("TSLA")!.winRate).toBe(0.0);
  });

  it("tracks trade count per side (buy/sell)", () => {
    const analyzer = new TradingPerformanceAnalyzer();
    const history: TradeAuditEntry[] = [
      makeAudit({ id: "1", outcome: "profit", action: { ...makeAudit().action, side: "buy" } }),
      makeAudit({ id: "2", outcome: "profit", action: { ...makeAudit().action, side: "sell" } }),
      makeAudit({ id: "3", outcome: "loss", action: { ...makeAudit().action, side: "sell" } }),
    ];

    const metrics = analyzer.analyze(history);
    expect(metrics.bySide.get("buy")!.count).toBe(1);
    expect(metrics.bySide.get("sell")!.count).toBe(2);
  });
});
