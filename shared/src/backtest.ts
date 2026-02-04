// Shared type modifications approved as part of backtesting feature PR review fixes
import { z } from "zod";
import { RiskLimitsSchema } from "./trading.js";

// ---------------------------------------------------------------------------
// Backtest types
// ---------------------------------------------------------------------------

export type BacktestTimeframe = "1Day" | "1Hour";
export type BacktestStatus = "running" | "completed" | "failed" | "cancelled";
export type TradeSizingStrategy = "fixed_qty" | "pct_of_capital" | "kelly";

export type BacktestConfig = {
  id: string;
  symbols: string[];
  startDate: string;
  endDate: string;
  timeframe: BacktestTimeframe;
  initialCapital: number;
  riskLimits: import("./trading.js").RiskLimits;
  severityThreshold: import("./anomaly.js").Severity;
  confidenceThreshold: number;
  preScreenerSensitivity: number;
  tradeSizingStrategy: TradeSizingStrategy;
  modelId: string;
};

export type BacktestProgress = {
  backtestId: string;
  ticksProcessed: number;
  totalTicks: number;
  anomaliesFound: number;
  tradesExecuted: number;
  currentDate: string;
};

export type BacktestTrade = {
  id: string;
  backtestId: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  fillPrice: number;
  timestamp: number;
  anomalyId: string;
  rationale: string;
  /** realizedPnl is null for buy trades, number for sell trades */
  realizedPnl: number | null;
};

export type BacktestMetrics = {
  totalReturn: number;
  totalReturnPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdownPct: number;
  maxDrawdownDuration: number;
  recoveryFactor: number;
  winRate: number;
  totalTrades: number;
  profitFactor: number;
  avgWinLossRatio: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  largestWin: number;
  largestLoss: number;
  avgTradeDuration: number;
  monthlyReturns: { month: string; return: number }[];
  perSymbol: Record<string, Omit<BacktestMetrics, "perSymbol">>;
};

/**
 * BacktestResult has status-dependent nullability:
 * - status "running": metrics=null, completedAt=null, error=null
 * - status "completed": metrics=BacktestMetrics, completedAt=number, error=null
 * - status "failed": metrics=null, completedAt=number, error=string
 * - status "cancelled": metrics=null, completedAt=number, error=null
 * Full discriminated union migration deferred to follow-up PR.
 */
export type BacktestResult = {
  id: string;
  config: BacktestConfig;
  status: BacktestStatus;
  metrics: BacktestMetrics | null;
  trades: BacktestTrade[];
  equityCurve: { date: string; value: number }[];
  createdAt: number;
  completedAt: number | null;
  error: string | null;
};

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const BacktestConfigSchema = z.object({
  id: z.string().min(1),
  symbols: z.array(z.string().min(1)).min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  timeframe: z.enum(["1Day", "1Hour"]),
  initialCapital: z.number().positive(),
  riskLimits: RiskLimitsSchema,
  severityThreshold: z.enum(["low", "medium", "high", "critical"]),
  confidenceThreshold: z.number().min(0).max(1),
  preScreenerSensitivity: z.number().min(0).max(1),
  tradeSizingStrategy: z.enum(["fixed_qty", "pct_of_capital", "kelly"]),
  modelId: z.string().min(1),
}).refine(
  (data) => new Date(data.startDate) < new Date(data.endDate),
  { message: "startDate must be before endDate", path: ["endDate"] }
);

export const BacktestProgressSchema = z.object({
  backtestId: z.string().min(1),
  ticksProcessed: z.number().int().nonnegative(),
  totalTicks: z.number().int().nonnegative(),
  anomaliesFound: z.number().int().nonnegative(),
  tradesExecuted: z.number().int().nonnegative(),
  currentDate: z.string().min(1),
});

export const BacktestTradeSchema = z.object({
  id: z.string().min(1),
  backtestId: z.string().min(1),
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  qty: z.number().positive(),
  fillPrice: z.number().nonnegative(),
  timestamp: z.number().positive(),
  anomalyId: z.string().min(1),
  rationale: z.string().min(1),
  realizedPnl: z.number().nullable(),
});

const BacktestMetricsBaseSchema = z.object({
  totalReturn: z.number(),
  totalReturnPct: z.number(),
  sharpeRatio: z.number(),
  sortinoRatio: z.number(),
  maxDrawdownPct: z.number().nonnegative(),
  maxDrawdownDuration: z.number().nonnegative(),
  recoveryFactor: z.number(),
  winRate: z.number().min(0).max(1),
  totalTrades: z.number().int().nonnegative(),
  profitFactor: z.number().finite(),
  avgWinLossRatio: z.number().finite(),
  maxConsecutiveWins: z.number().int().nonnegative(),
  maxConsecutiveLosses: z.number().int().nonnegative(),
  largestWin: z.number(),
  largestLoss: z.number(),
  avgTradeDuration: z.number().nonnegative(),
  monthlyReturns: z.array(z.object({ month: z.string(), return: z.number() })),
});

export const BacktestMetricsSchema = BacktestMetricsBaseSchema.extend({
  perSymbol: z.record(z.string(), BacktestMetricsBaseSchema),
});

export const BacktestResultSchema = z.object({
  id: z.string().min(1),
  config: BacktestConfigSchema,
  status: z.enum(["running", "completed", "failed", "cancelled"]),
  metrics: BacktestMetricsSchema.nullable(),
  trades: z.array(BacktestTradeSchema),
  equityCurve: z.array(z.object({ date: z.string(), value: z.number() })),
  createdAt: z.number().positive(),
  completedAt: z.number().positive().nullable(),
  error: z.string().nullable(),
});
