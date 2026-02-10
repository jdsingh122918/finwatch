import { describe, it, expect } from "vitest";
import {
  BacktestConfigSchema,
  BacktestProgressSchema,
  BacktestTradeSchema,
  BacktestMetricsSchema,
  BacktestResultSchema,
} from "../backtest.js";

describe("BacktestConfig schema", () => {
  const validConfig = {
    id: "bt-001",
    symbols: ["AAPL", "TSLA"],
    startDate: "2024-01-01",
    endDate: "2024-12-31",
    timeframe: "1Day" as const,
    initialCapital: 100000,
    riskLimits: {
      maxPositionSize: 10000,
      maxExposure: 50000,
      maxDailyTrades: 5,
      maxLossPct: 2,
      cooldownMs: 60000,
    },
    severityThreshold: "high" as const,
    confidenceThreshold: 0.7,
    preScreenerSensitivity: 0.5,
    tradeSizingStrategy: "pct_of_capital" as const,
    modelId: "claude-haiku-4-5-20251001",
  };

  it("validates a valid config", () => {
    const result = BacktestConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it("rejects invalid timeframe", () => {
    const result = BacktestConfigSchema.safeParse({
      ...validConfig,
      timeframe: "5Min",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty symbols array", () => {
    const result = BacktestConfigSchema.safeParse({
      ...validConfig,
      symbols: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects initialCapital of zero", () => {
    const result = BacktestConfigSchema.safeParse({ ...validConfig, initialCapital: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects negative initialCapital", () => {
    const result = BacktestConfigSchema.safeParse({ ...validConfig, initialCapital: -1000 });
    expect(result.success).toBe(false);
  });

  it("rejects startDate after endDate", () => {
    const result = BacktestConfigSchema.safeParse({
      ...validConfig,
      startDate: "2024-12-31",
      endDate: "2024-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid date format", () => {
    const result = BacktestConfigSchema.safeParse({
      ...validConfig,
      startDate: "Jan 1, 2024",
    });
    expect(result.success).toBe(false);
  });
});

describe("BacktestProgress schema", () => {
  it("validates progress payload", () => {
    const progress = {
      backtestId: "bt-001",
      ticksProcessed: 50,
      totalTicks: 200,
      anomaliesFound: 3,
      tradesExecuted: 1,
      currentDate: "2024-03-15",
    };
    const result = BacktestProgressSchema.safeParse(progress);
    expect(result.success).toBe(true);
  });
});

describe("BacktestTrade schema", () => {
  it("validates a buy trade with null realizedPnl", () => {
    const trade = {
      id: "btt-001",
      backtestId: "bt-001",
      symbol: "AAPL",
      side: "buy",
      qty: 10,
      fillPrice: 185.50,
      timestamp: 1706800000,
      anomalyId: "anom-001",
      rationale: "Volume spike detected",
      realizedPnl: null,
    };
    const result = BacktestTradeSchema.safeParse(trade);
    expect(result.success).toBe(true);
  });

  it("validates a sell trade with realizedPnl", () => {
    const trade = {
      id: "btt-002",
      backtestId: "bt-001",
      symbol: "AAPL",
      side: "sell",
      qty: 10,
      fillPrice: 195.00,
      timestamp: 1706900000,
      anomalyId: "anom-002",
      rationale: "Price spike reversal",
      realizedPnl: 95.0,
    };
    const result = BacktestTradeSchema.safeParse(trade);
    expect(result.success).toBe(true);
  });
});

describe("BacktestMetrics schema", () => {
  const validMetrics = {
    totalReturn: 5000,
    totalReturnPct: 5.0,
    sharpeRatio: 1.5,
    sortinoRatio: 2.0,
    maxDrawdownPct: 8.5,
    maxDrawdownDuration: 15,
    recoveryFactor: 0.59,
    winRate: 0.65,
    totalTrades: 20,
    profitFactor: 1.8,
    avgWinLossRatio: 1.5,
    maxConsecutiveWins: 5,
    maxConsecutiveLosses: 3,
    largestWin: 2000,
    largestLoss: -1000,
    avgTradeDuration: 48,
    monthlyReturns: [{ month: "2024-01", return: 2.5 }],
    perSymbol: {},
  };

  it("validates full metrics object", () => {
    const result = BacktestMetricsSchema.safeParse(validMetrics);
    expect(result.success).toBe(true);
  });

  it("rejects Infinity in profitFactor", () => {
    const result = BacktestMetricsSchema.safeParse({
      ...validMetrics,
      profitFactor: Infinity,
    });
    expect(result.success).toBe(false);
  });

  it("rejects Infinity in avgWinLossRatio", () => {
    const result = BacktestMetricsSchema.safeParse({
      ...validMetrics,
      avgWinLossRatio: Infinity,
    });
    expect(result.success).toBe(false);
  });
});

describe("BacktestResult schema", () => {
  it("validates a completed result", () => {
    const result = BacktestResultSchema.safeParse({
      id: "bt-001",
      config: {
        id: "bt-001",
        symbols: ["AAPL"],
        startDate: "2024-01-01",
        endDate: "2024-12-31",
        timeframe: "1Day",
        initialCapital: 100000,
        riskLimits: {
          maxPositionSize: 10000,
          maxExposure: 50000,
          maxDailyTrades: 5,
          maxLossPct: 2,
          cooldownMs: 60000,
        },
        severityThreshold: "high",
        confidenceThreshold: 0.7,
        preScreenerSensitivity: 0.5,
        tradeSizingStrategy: "pct_of_capital",
        modelId: "test-model",
      },
      status: "completed",
      metrics: null,
      trades: [],
      equityCurve: [],
      createdAt: Date.now(),
      completedAt: Date.now(),
      error: null,
    });
    expect(result.success).toBe(true);
  });
});
