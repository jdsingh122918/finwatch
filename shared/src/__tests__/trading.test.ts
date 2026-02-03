import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  TradeAction,
  TradeSuggestion,
  PortfolioPosition,
  TradingMode,
  RiskLimits,
  TradeAuditEntry,
  TradeHistoryFilter,
  IpcCommands,
  IpcEvents,
} from "../index.js";
import {
  TradeActionSchema,
  TradeSuggestionSchema,
  PortfolioPositionSchema,
  RiskLimitsSchema,
  TradeAuditEntrySchema,
} from "../trading.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
const validTradeAction = {
  symbol: "AAPL",
  side: "buy" as const,
  qty: 10,
  type: "market" as const,
  rationale: "Price spike anomaly detected",
  confidence: 0.85,
  anomalyId: "anomaly-001",
};

const validRiskLimits = {
  maxPositionSize: 1000,
  maxExposure: 5000,
  maxDailyTrades: 10,
  maxLossPct: 5,
  cooldownMs: 900000,
};

const validTradeSuggestion = {
  id: "suggestion-001",
  action: validTradeAction,
  expiresAt: Date.now() + 300000,
  status: "pending" as const,
};

const validAuditEntry = {
  id: "audit-001",
  action: validTradeAction,
  anomalyId: "anomaly-001",
  outcome: "pending" as const,
  limitsChecked: ["maxPositionSize", "maxExposure"],
  timestamp: Date.now(),
};

// ---------------------------------------------------------------------------
// Type structure tests
// ---------------------------------------------------------------------------
describe("trading types", () => {
  it("TradeAction has required fields", () => {
    expectTypeOf<TradeAction>().toHaveProperty("symbol");
    expectTypeOf<TradeAction>().toHaveProperty("side");
    expectTypeOf<TradeAction>().toHaveProperty("qty");
    expectTypeOf<TradeAction>().toHaveProperty("type");
    expectTypeOf<TradeAction>().toHaveProperty("rationale");
    expectTypeOf<TradeAction>().toHaveProperty("confidence");
    expectTypeOf<TradeAction>().toHaveProperty("anomalyId");
  });

  it("TradeAction.side is buy | sell", () => {
    expectTypeOf<TradeAction["side"]>().toEqualTypeOf<"buy" | "sell">();
  });

  it("TradeAction.type is market | limit", () => {
    expectTypeOf<TradeAction["type"]>().toEqualTypeOf<"market" | "limit">();
  });

  it("TradeSuggestion has required fields", () => {
    expectTypeOf<TradeSuggestion>().toHaveProperty("id");
    expectTypeOf<TradeSuggestion>().toHaveProperty("action");
    expectTypeOf<TradeSuggestion>().toHaveProperty("expiresAt");
    expectTypeOf<TradeSuggestion>().toHaveProperty("status");
  });

  it("TradeSuggestion.status is pending | approved | dismissed | expired", () => {
    expectTypeOf<TradeSuggestion["status"]>().toEqualTypeOf<
      "pending" | "approved" | "dismissed" | "expired"
    >();
  });

  it("PortfolioPosition has required fields", () => {
    expectTypeOf<PortfolioPosition>().toHaveProperty("symbol");
    expectTypeOf<PortfolioPosition>().toHaveProperty("qty");
    expectTypeOf<PortfolioPosition>().toHaveProperty("avgEntry");
    expectTypeOf<PortfolioPosition>().toHaveProperty("currentPrice");
    expectTypeOf<PortfolioPosition>().toHaveProperty("unrealizedPnl");
  });

  it("TradingMode is paper | live", () => {
    expectTypeOf<TradingMode>().toEqualTypeOf<"paper" | "live">();
  });

  it("RiskLimits has required fields", () => {
    expectTypeOf<RiskLimits>().toHaveProperty("maxPositionSize");
    expectTypeOf<RiskLimits>().toHaveProperty("maxExposure");
    expectTypeOf<RiskLimits>().toHaveProperty("maxDailyTrades");
    expectTypeOf<RiskLimits>().toHaveProperty("maxLossPct");
    expectTypeOf<RiskLimits>().toHaveProperty("cooldownMs");
  });

  it("TradeAuditEntry has required fields", () => {
    expectTypeOf<TradeAuditEntry>().toHaveProperty("id");
    expectTypeOf<TradeAuditEntry>().toHaveProperty("action");
    expectTypeOf<TradeAuditEntry>().toHaveProperty("anomalyId");
    expectTypeOf<TradeAuditEntry>().toHaveProperty("outcome");
    expectTypeOf<TradeAuditEntry>().toHaveProperty("limitsChecked");
    expectTypeOf<TradeAuditEntry>().toHaveProperty("timestamp");
  });

  it("TradeAuditEntry.outcome is pending | profit | loss | cancelled", () => {
    expectTypeOf<TradeAuditEntry["outcome"]>().toEqualTypeOf<
      "pending" | "profit" | "loss" | "cancelled"
    >();
  });

  it("TradeHistoryFilter has optional fields", () => {
    expectTypeOf<TradeHistoryFilter>().toHaveProperty("since");
    expectTypeOf<TradeHistoryFilter>().toHaveProperty("limit");
    expectTypeOf<TradeHistoryFilter>().toHaveProperty("symbol");
  });
});

// ---------------------------------------------------------------------------
// Schema validation tests
// ---------------------------------------------------------------------------
describe("TradeActionSchema", () => {
  it("parses a valid trade action", () => {
    const result = TradeActionSchema.safeParse(validTradeAction);
    expect(result.success).toBe(true);
  });

  it("rejects invalid side", () => {
    const bad = { ...validTradeAction, side: "short" };
    const result = TradeActionSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects negative qty", () => {
    const bad = { ...validTradeAction, qty: -5 };
    const result = TradeActionSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects confidence outside 0-1", () => {
    const tooHigh = { ...validTradeAction, confidence: 1.5 };
    expect(TradeActionSchema.safeParse(tooHigh).success).toBe(false);

    const tooLow = { ...validTradeAction, confidence: -0.1 };
    expect(TradeActionSchema.safeParse(tooLow).success).toBe(false);
  });
});

describe("RiskLimitsSchema", () => {
  it("parses valid limits", () => {
    const result = RiskLimitsSchema.safeParse(validRiskLimits);
    expect(result.success).toBe(true);
  });

  it("rejects negative values", () => {
    expect(
      RiskLimitsSchema.safeParse({ ...validRiskLimits, maxPositionSize: -1 }).success,
    ).toBe(false);
    expect(
      RiskLimitsSchema.safeParse({ ...validRiskLimits, maxExposure: -100 }).success,
    ).toBe(false);
    expect(
      RiskLimitsSchema.safeParse({ ...validRiskLimits, maxDailyTrades: -1 }).success,
    ).toBe(false);
    expect(
      RiskLimitsSchema.safeParse({ ...validRiskLimits, cooldownMs: -1 }).success,
    ).toBe(false);
  });
});

describe("TradeSuggestionSchema", () => {
  it("parses a valid suggestion", () => {
    const result = TradeSuggestionSchema.safeParse(validTradeSuggestion);
    expect(result.success).toBe(true);
  });
});

describe("TradeAuditEntrySchema", () => {
  it("parses a valid audit entry", () => {
    const result = TradeAuditEntrySchema.safeParse(validAuditEntry);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// IPC extension tests
// ---------------------------------------------------------------------------
describe("IPC trading extensions", () => {
  it("IpcCommands has trading commands", () => {
    expectTypeOf<IpcCommands>().toHaveProperty("trading:suggest");
    expectTypeOf<IpcCommands>().toHaveProperty("trading:approve");
    expectTypeOf<IpcCommands>().toHaveProperty("trading:dismiss");
    expectTypeOf<IpcCommands>().toHaveProperty("trading:history");
    expectTypeOf<IpcCommands>().toHaveProperty("trading:positions");
    expectTypeOf<IpcCommands>().toHaveProperty("trading:mode");
  });

  it("IpcEvents has trading events", () => {
    expectTypeOf<IpcEvents>().toHaveProperty("trade:suggestion");
    expectTypeOf<IpcEvents>().toHaveProperty("trade:executed");
    expectTypeOf<IpcEvents>().toHaveProperty("trade:expired");
    expectTypeOf<IpcEvents>().toHaveProperty("portfolio:update");
  });
});
