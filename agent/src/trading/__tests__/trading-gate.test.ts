import { describe, it, expect, vi, beforeEach } from "vitest";
import { TradingGate } from "../trading-gate.js";
import type { TradingMode } from "@finwatch/shared";

describe("TradingGate", () => {
  it("starts in paper mode", () => {
    const gate = new TradingGate();
    expect(gate.mode).toBe("paper");
  });

  it("rejects live mode when paper trading has insufficient history", () => {
    const gate = new TradingGate();
    const result = gate.canGoLive({
      paperTradeDays: 3,
      paperTradeCount: 10,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("Requires 7+ days of paper trading (current: 3)");
  });

  it("rejects live mode when paper trade count is too low", () => {
    const gate = new TradingGate();
    const result = gate.canGoLive({
      paperTradeDays: 10,
      paperTradeCount: 15,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("Requires 20+ paper trades (current: 15)");
  });

  it("allows live mode when both thresholds met", () => {
    const gate = new TradingGate();
    const result = gate.canGoLive({
      paperTradeDays: 7,
      paperTradeCount: 20,
    });

    expect(result.allowed).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it("allows live mode with exceeded thresholds", () => {
    const gate = new TradingGate();
    const result = gate.canGoLive({
      paperTradeDays: 30,
      paperTradeCount: 100,
    });

    expect(result.allowed).toBe(true);
  });

  it("collects multiple rejection reasons", () => {
    const gate = new TradingGate();
    const result = gate.canGoLive({
      paperTradeDays: 2,
      paperTradeCount: 5,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toHaveLength(2);
  });

  it("setMode switches to live only when gate allows", () => {
    const gate = new TradingGate();

    // Should fail — no paper history
    const result1 = gate.setMode("live", {
      paperTradeDays: 1,
      paperTradeCount: 2,
    });
    expect(result1.success).toBe(false);
    expect(gate.mode).toBe("paper");

    // Should succeed
    const result2 = gate.setMode("live", {
      paperTradeDays: 10,
      paperTradeCount: 25,
    });
    expect(result2.success).toBe(true);
    expect(gate.mode).toBe("live");
  });

  it("setMode to paper always succeeds", () => {
    const gate = new TradingGate();

    // First get to live
    gate.setMode("live", { paperTradeDays: 10, paperTradeCount: 25 });
    expect(gate.mode).toBe("live");

    // Switch back to paper — no gate required
    const result = gate.setMode("paper", { paperTradeDays: 0, paperTradeCount: 0 });
    expect(result.success).toBe(true);
    expect(gate.mode).toBe("paper");
  });

  it("kill switch sets mode to paper and emits onKill", () => {
    const gate = new TradingGate();
    const callback = vi.fn();
    gate.onKill = callback;

    gate.setMode("live", { paperTradeDays: 10, paperTradeCount: 25 });
    expect(gate.mode).toBe("live");

    gate.killSwitch();
    expect(gate.mode).toBe("paper");
    expect(gate.killed).toBe(true);
    expect(callback).toHaveBeenCalledOnce();
  });

  it("kill switch is idempotent", () => {
    const gate = new TradingGate();
    const callback = vi.fn();
    gate.onKill = callback;

    gate.killSwitch();
    gate.killSwitch();
    expect(callback).toHaveBeenCalledTimes(2);
    expect(gate.killed).toBe(true);
  });

  it("reset clears kill state", () => {
    const gate = new TradingGate();
    gate.killSwitch();
    expect(gate.killed).toBe(true);

    gate.reset();
    expect(gate.killed).toBe(false);
    expect(gate.mode).toBe("paper");
  });

  it("cannot go live while killed", () => {
    const gate = new TradingGate();
    gate.killSwitch();

    const result = gate.setMode("live", { paperTradeDays: 30, paperTradeCount: 100 });
    expect(result.success).toBe(false);
    expect(result.reasons).toContain("Kill switch active — reset required");
  });

  it("uses configurable thresholds", () => {
    const gate = new TradingGate({ minPaperDays: 14, minPaperTrades: 50 });
    const result = gate.canGoLive({ paperTradeDays: 10, paperTradeCount: 30 });

    expect(result.allowed).toBe(false);
    expect(result.reasons).toContain("Requires 14+ days of paper trading (current: 10)");
    expect(result.reasons).toContain("Requires 50+ paper trades (current: 30)");
  });
});
