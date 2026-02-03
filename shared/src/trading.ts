import { z } from "zod";

// ---------------------------------------------------------------------------
// Core trading types
// ---------------------------------------------------------------------------

export type TradeSide = "buy" | "sell";
export type OrderType = "market" | "limit";
export type SuggestionStatus = "pending" | "approved" | "dismissed" | "expired";
export type TradeOutcome = "pending" | "profit" | "loss" | "cancelled";
export type TradingMode = "paper" | "live";

export type TradeAction = {
  symbol: string;
  side: TradeSide;
  qty: number;
  type: OrderType;
  rationale: string;
  confidence: number;
  anomalyId: string;
};

export type TradeSuggestion = {
  id: string;
  action: TradeAction;
  expiresAt: number;
  status: SuggestionStatus;
};

export type PortfolioPosition = {
  symbol: string;
  qty: number;
  avgEntry: number;
  currentPrice: number;
  unrealizedPnl: number;
};

export type RiskLimits = {
  maxPositionSize: number;
  maxExposure: number;
  maxDailyTrades: number;
  maxLossPct: number;
  cooldownMs: number;
};

export type TradeAuditEntry = {
  id: string;
  action: TradeAction;
  anomalyId: string;
  outcome: TradeOutcome;
  limitsChecked: string[];
  timestamp: number;
};

export type TradeHistoryFilter = {
  since?: number;
  limit?: number;
  symbol?: string;
};

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const TradeActionSchema = z.object({
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  qty: z.number().positive(),
  type: z.enum(["market", "limit"]),
  rationale: z.string().min(1),
  confidence: z.number().min(0).max(1),
  anomalyId: z.string().min(1),
});

export const TradeSuggestionSchema = z.object({
  id: z.string().min(1),
  action: TradeActionSchema,
  expiresAt: z.number().positive(),
  status: z.enum(["pending", "approved", "dismissed", "expired"]),
});

export const PortfolioPositionSchema = z.object({
  symbol: z.string().min(1),
  qty: z.number(),
  avgEntry: z.number().nonnegative(),
  currentPrice: z.number().nonnegative(),
  unrealizedPnl: z.number(),
});

export const RiskLimitsSchema = z.object({
  maxPositionSize: z.number().nonnegative(),
  maxExposure: z.number().nonnegative(),
  maxDailyTrades: z.number().int().nonnegative(),
  maxLossPct: z.number().nonnegative(),
  cooldownMs: z.number().int().nonnegative(),
});

export const TradeAuditEntrySchema = z.object({
  id: z.string().min(1),
  action: TradeActionSchema,
  anomalyId: z.string().min(1),
  outcome: z.enum(["pending", "profit", "loss", "cancelled"]),
  limitsChecked: z.array(z.string()),
  timestamp: z.number().positive(),
});

export const TradeHistoryFilterSchema = z.object({
  since: z.number().optional(),
  limit: z.number().int().positive().optional(),
  symbol: z.string().optional(),
});
