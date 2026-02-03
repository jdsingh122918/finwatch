import { describe, it, expect, beforeEach } from "vitest";
import { createTradingSlice, type TradingSlice } from "../trading-slice.js";
import type {
  TradeSuggestion,
  PortfolioPosition,
  TradeAuditEntry,
  TradeAction,
} from "@finwatch/shared";

const action: TradeAction = {
  symbol: "AAPL",
  side: "buy",
  qty: 10,
  type: "market",
  rationale: "Anomaly detected",
  confidence: 0.85,
  anomalyId: "a-001",
};

const suggestion: TradeSuggestion = {
  id: "s-001",
  action,
  expiresAt: Date.now() + 300000,
  status: "pending",
};

const position: PortfolioPosition = {
  symbol: "AAPL",
  qty: 100,
  avgEntry: 180.5,
  currentPrice: 185.0,
  unrealizedPnl: 450.0,
};

const auditEntry: TradeAuditEntry = {
  id: "audit-001",
  action,
  anomalyId: "a-001",
  outcome: "profit",
  limitsChecked: ["maxPositionSize"],
  timestamp: Date.now(),
};

describe("tradingSlice", () => {
  let slice: TradingSlice;

  beforeEach(() => {
    slice = createTradingSlice();
  });

  it("starts with empty state and paper mode", () => {
    const state = slice.getState();
    expect(state.suggestions).toHaveLength(0);
    expect(state.positions).toHaveLength(0);
    expect(state.history).toHaveLength(0);
    expect(state.mode).toBe("paper");
    expect(state.killSwitchActive).toBe(false);
  });

  it("adds a suggestion", () => {
    slice.getState().addSuggestion(suggestion);
    expect(slice.getState().suggestions).toHaveLength(1);
    expect(slice.getState().suggestions[0]!.id).toBe("s-001");
  });

  it("updates suggestion status", () => {
    slice.getState().addSuggestion(suggestion);
    slice.getState().updateSuggestionStatus("s-001", "approved");
    expect(slice.getState().suggestions[0]!.status).toBe("approved");
  });

  it("getPendingSuggestions filters to pending only", () => {
    slice.getState().addSuggestion(suggestion);
    slice.getState().addSuggestion({
      ...suggestion,
      id: "s-002",
      status: "approved",
    });

    expect(slice.getState().getPendingSuggestions()).toHaveLength(1);
    expect(slice.getState().getPendingSuggestions()[0]!.id).toBe("s-001");
  });

  it("sets positions", () => {
    slice.getState().setPositions([position]);
    expect(slice.getState().positions).toHaveLength(1);
    expect(slice.getState().positions[0]!.symbol).toBe("AAPL");
  });

  it("replaces positions on subsequent set", () => {
    slice.getState().setPositions([position]);
    slice.getState().setPositions([{ ...position, symbol: "TSLA" }]);
    expect(slice.getState().positions).toHaveLength(1);
    expect(slice.getState().positions[0]!.symbol).toBe("TSLA");
  });

  it("adds trade history entry", () => {
    slice.getState().addHistoryEntry(auditEntry);
    expect(slice.getState().history).toHaveLength(1);
  });

  it("limits history to 500 entries", () => {
    for (let i = 0; i < 600; i++) {
      slice.getState().addHistoryEntry({ ...auditEntry, id: `audit-${i}` });
    }
    expect(slice.getState().history.length).toBeLessThanOrEqual(500);
  });

  it("sets trading mode", () => {
    slice.getState().setMode("live");
    expect(slice.getState().mode).toBe("live");

    slice.getState().setMode("paper");
    expect(slice.getState().mode).toBe("paper");
  });

  it("sets kill switch state", () => {
    slice.getState().setKillSwitch(true);
    expect(slice.getState().killSwitchActive).toBe(true);

    slice.getState().setKillSwitch(false);
    expect(slice.getState().killSwitchActive).toBe(false);
  });

  it("clear resets all state", () => {
    slice.getState().addSuggestion(suggestion);
    slice.getState().setPositions([position]);
    slice.getState().addHistoryEntry(auditEntry);
    slice.getState().setMode("live");

    slice.getState().clear();

    const state = slice.getState();
    expect(state.suggestions).toHaveLength(0);
    expect(state.positions).toHaveLength(0);
    expect(state.history).toHaveLength(0);
    expect(state.mode).toBe("paper");
    expect(state.killSwitchActive).toBe(false);
  });
});
