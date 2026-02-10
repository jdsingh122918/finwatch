# Backtesting Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a complete backtesting system that replays historical Alpaca data through the LLM anomaly detection pipeline, simulates trade execution, computes performance metrics, and displays results in a full dashboard with side-by-side comparison.

**Architecture:** Three-layer implementation mirroring the existing system: shared types define the contract, agent layer runs the backtest engine (data fetch → pre-screen → LLM → trade generation → simulated execution → metrics), Rust layer persists results in SQLite, frontend provides config forms and results dashboard with equity curves and comparison views.

**Tech Stack:** TypeScript (shared types + agent), Rust/Tauri (backend), React 19 + Zustand + Tailwind v4 (frontend), Vitest (testing), SQLite (persistence)

**Design Doc:** `docs/plans/2026-02-03-backtesting-design.md`

---

## Task 1: Shared Types — BacktestConfig, BacktestResult, BacktestTrade

**Files:**
- Create: `shared/src/backtest.ts`
- Modify: `shared/src/index.ts`
- Modify: `shared/src/ipc.ts`
- Test: `shared/src/__tests__/backtest.test.ts`

**Context:** All shared types use Zod schemas for validation. See `shared/src/trading.ts` for the pattern. Types are re-exported from `shared/src/index.ts`. IPC commands/events are defined in `shared/src/ipc.ts` as typed maps.

**Step 1: Write the failing test**

Create `shared/src/__tests__/backtest.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  BacktestConfigSchema,
  BacktestProgressSchema,
  BacktestTradeSchema,
  BacktestMetricsSchema,
  BacktestResultSchema,
} from "../backtest.js";

describe("BacktestConfig schema", () => {
  it("validates a valid config", () => {
    const config = {
      id: "bt-001",
      symbols: ["AAPL", "TSLA"],
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
      modelId: "claude-3-5-haiku-20241022",
    };
    const result = BacktestConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it("rejects invalid timeframe", () => {
    const config = {
      id: "bt-001",
      symbols: ["AAPL"],
      startDate: "2024-01-01",
      endDate: "2024-12-31",
      timeframe: "5Min",
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
    };
    const result = BacktestConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it("rejects empty symbols array", () => {
    const config = {
      id: "bt-001",
      symbols: [],
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
    };
    const result = BacktestConfigSchema.safeParse(config);
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
  it("validates full metrics object", () => {
    const metrics = {
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
    const result = BacktestMetricsSchema.safeParse(metrics);
    expect(result.success).toBe(true);
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
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && pnpm vitest run shared/src/__tests__/backtest.test.ts`
Expected: FAIL — cannot find module `../backtest.js`

**Step 3: Write implementation**

Create `shared/src/backtest.ts`:

```typescript
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
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  timeframe: z.enum(["1Day", "1Hour"]),
  initialCapital: z.number().positive(),
  riskLimits: RiskLimitsSchema,
  severityThreshold: z.enum(["low", "medium", "high", "critical"]),
  confidenceThreshold: z.number().min(0).max(1),
  preScreenerSensitivity: z.number().min(0).max(1),
  tradeSizingStrategy: z.enum(["fixed_qty", "pct_of_capital", "kelly"]),
  modelId: z.string().min(1),
});

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
  profitFactor: z.number(),
  avgWinLossRatio: z.number(),
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
```

Then update `shared/src/index.ts` — add after the trading exports:

```typescript
export type {
  BacktestTimeframe,
  BacktestStatus,
  TradeSizingStrategy,
  BacktestConfig,
  BacktestProgress,
  BacktestTrade,
  BacktestMetrics,
  BacktestResult,
} from "./backtest.js";

export {
  BacktestConfigSchema,
  BacktestProgressSchema,
  BacktestTradeSchema,
  BacktestMetricsSchema,
  BacktestResultSchema,
} from "./backtest.js";
```

Then update `shared/src/ipc.ts` — add the import and new commands/events:

```typescript
// Add to imports:
import type { BacktestConfig, BacktestResult, BacktestProgress } from "./backtest.js";

// Add to IpcCommands:
  "backtest:start": (config: BacktestConfig) => { backtestId: string };
  "backtest:cancel": (backtestId: string) => void;
  "backtest:list": () => BacktestResult[];
  "backtest:get": (backtestId: string) => BacktestResult;
  "backtest:delete": (backtestId: string) => void;
  "backtest:export": (backtestId: string, format: "json" | "csv") => string;

// Add to IpcEvents:
  "backtest:progress": BacktestProgress;
  "backtest:complete": { backtestId: string; status: BacktestStatus };
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && pnpm vitest run shared/src/__tests__/backtest.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add shared/src/backtest.ts shared/src/__tests__/backtest.test.ts shared/src/index.ts shared/src/ipc.ts
git commit -m "feat(shared): add backtest types, schemas, and IPC contract"
```

---

## Task 2: Agent — BacktestExecutor (simulated trade execution)

**Depends on:** Task 1 (shared types)

**Files:**
- Create: `agent/src/backtesting/backtest-executor.ts`
- Test: `agent/src/backtesting/__tests__/backtest-executor.test.ts`

**Context:** This is a simulated order executor — no Alpaca API calls. It tracks cash, positions (FIFO lots), and logs every trade. See `agent/src/trading/paper-executor.ts` for the real executor pattern. See `agent/src/trading/risk-manager.ts` for how `TradeAction` is consumed.

**Step 1: Write the failing test**

Create `agent/src/backtesting/__tests__/backtest-executor.test.ts`:

```typescript
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
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && pnpm vitest run agent/src/backtesting/__tests__/backtest-executor.test.ts`
Expected: FAIL — cannot find module

**Step 3: Write implementation**

Create `agent/src/backtesting/backtest-executor.ts`:

```typescript
import type { TradeAction, BacktestTrade } from "@finwatch/shared";

type Lot = { qty: number; price: number; timestamp: number };

type Position = {
  qty: number;
  avgEntry: number;
  lots: Lot[];
};

export class BacktestExecutor {
  private backtestId: string;
  private _cash: number;
  private positions = new Map<string, Position>();
  private tradeLog: BacktestTrade[] = [];
  private equityCurve: { date: string; value: number }[] = [];
  private tradeSeq = 0;

  constructor(backtestId: string, initialCapital: number) {
    this.backtestId = backtestId;
    this._cash = initialCapital;
  }

  get cash(): number {
    return this._cash;
  }

  execute(
    action: TradeAction,
    fillPrice: number,
    timestamp: number,
  ): BacktestTrade | null {
    if (action.side === "buy") {
      return this.executeBuy(action, fillPrice, timestamp);
    }
    return this.executeSell(action, fillPrice, timestamp);
  }

  private executeBuy(
    action: TradeAction,
    fillPrice: number,
    timestamp: number,
  ): BacktestTrade | null {
    const cost = action.qty * fillPrice;
    if (cost > this._cash) return null;

    this._cash -= cost;

    const existing = this.positions.get(action.symbol);
    if (existing) {
      const totalQty = existing.qty + action.qty;
      const totalCost = existing.avgEntry * existing.qty + fillPrice * action.qty;
      existing.qty = totalQty;
      existing.avgEntry = totalCost / totalQty;
      existing.lots.push({ qty: action.qty, price: fillPrice, timestamp });
    } else {
      this.positions.set(action.symbol, {
        qty: action.qty,
        avgEntry: fillPrice,
        lots: [{ qty: action.qty, price: fillPrice, timestamp }],
      });
    }

    const trade: BacktestTrade = {
      id: `btt-${++this.tradeSeq}`,
      backtestId: this.backtestId,
      symbol: action.symbol,
      side: "buy",
      qty: action.qty,
      fillPrice,
      timestamp,
      anomalyId: action.anomalyId,
      rationale: action.rationale,
      realizedPnl: null,
    };
    this.tradeLog.push(trade);
    return trade;
  }

  private executeSell(
    action: TradeAction,
    fillPrice: number,
    timestamp: number,
  ): BacktestTrade | null {
    const pos = this.positions.get(action.symbol);
    if (!pos || pos.qty <= 0) return null;

    const sellQty = Math.min(action.qty, pos.qty);
    let realizedPnl = 0;
    let remaining = sellQty;

    // FIFO lot matching
    while (remaining > 0 && pos.lots.length > 0) {
      const lot = pos.lots[0];
      const fromLot = Math.min(remaining, lot.qty);
      realizedPnl += fromLot * (fillPrice - lot.price);
      lot.qty -= fromLot;
      remaining -= fromLot;
      if (lot.qty <= 0) pos.lots.shift();
    }

    this._cash += sellQty * fillPrice;
    pos.qty -= sellQty;

    if (pos.qty <= 0) {
      this.positions.delete(action.symbol);
    } else {
      // Recalculate avgEntry from remaining lots
      const totalCost = pos.lots.reduce((s, l) => s + l.qty * l.price, 0);
      pos.avgEntry = totalCost / pos.qty;
    }

    const trade: BacktestTrade = {
      id: `btt-${++this.tradeSeq}`,
      backtestId: this.backtestId,
      symbol: action.symbol,
      side: "sell",
      qty: sellQty,
      fillPrice,
      timestamp,
      anomalyId: action.anomalyId,
      rationale: action.rationale,
      realizedPnl,
    };
    this.tradeLog.push(trade);
    return trade;
  }

  portfolioValue(currentPrices: Record<string, number>): number {
    let posValue = 0;
    for (const [symbol, pos] of this.positions) {
      const price = currentPrices[symbol] ?? pos.avgEntry;
      posValue += pos.qty * price;
    }
    return this._cash + posValue;
  }

  snapshot(date: string, currentPrices: Record<string, number>): void {
    this.equityCurve.push({ date, value: this.portfolioValue(currentPrices) });
  }

  getPositions(): Record<string, { qty: number; avgEntry: number }> {
    const result: Record<string, { qty: number; avgEntry: number }> = {};
    for (const [symbol, pos] of this.positions) {
      result[symbol] = { qty: pos.qty, avgEntry: pos.avgEntry };
    }
    return result;
  }

  getTradeLog(): BacktestTrade[] {
    return this.tradeLog;
  }

  getEquityCurve(): { date: string; value: number }[] {
    return this.equityCurve;
  }

  hasPosition(symbol: string): boolean {
    return this.positions.has(symbol);
  }

  getQty(symbol: string): number {
    return this.positions.get(symbol)?.qty ?? 0;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && pnpm vitest run agent/src/backtesting/__tests__/backtest-executor.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add agent/src/backtesting/backtest-executor.ts agent/src/backtesting/__tests__/backtest-executor.test.ts
git commit -m "feat(agent): add BacktestExecutor with FIFO lot tracking"
```

---

## Task 3: Agent — MetricsCalculator

**Depends on:** Task 1 (shared types)

**Files:**
- Create: `agent/src/backtesting/metrics-calculator.ts`
- Test: `agent/src/backtesting/__tests__/metrics-calculator.test.ts`

**Context:** Pure computation — takes trade log + equity curve, returns `BacktestMetrics`. No external dependencies.

**Step 1: Write the failing test**

Create `agent/src/backtesting/__tests__/metrics-calculator.test.ts`:

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && pnpm vitest run agent/src/backtesting/__tests__/metrics-calculator.test.ts`
Expected: FAIL

**Step 3: Write implementation**

Create `agent/src/backtesting/metrics-calculator.ts`:

```typescript
import type { BacktestTrade, BacktestMetrics } from "@finwatch/shared";

type EquityPoint = { date: string; value: number };

function emptyBaseMetrics(): Omit<BacktestMetrics, "perSymbol"> {
  return {
    totalReturn: 0,
    totalReturnPct: 0,
    sharpeRatio: 0,
    sortinoRatio: 0,
    maxDrawdownPct: 0,
    maxDrawdownDuration: 0,
    recoveryFactor: 0,
    winRate: 0,
    totalTrades: 0,
    profitFactor: 0,
    avgWinLossRatio: 0,
    maxConsecutiveWins: 0,
    maxConsecutiveLosses: 0,
    largestWin: 0,
    largestLoss: 0,
    avgTradeDuration: 0,
    monthlyReturns: [],
  };
}

function computeBaseMetrics(
  trades: BacktestTrade[],
  curve: EquityPoint[],
  initialCapital: number,
): Omit<BacktestMetrics, "perSymbol"> {
  // Only sell trades count as "completed trades" for win/loss metrics
  const sellTrades = trades.filter((t) => t.side === "sell" && t.realizedPnl !== null);

  if (sellTrades.length === 0 && curve.length === 0) {
    return emptyBaseMetrics();
  }

  // Total return from equity curve or trade PnLs
  const lastValue = curve.length > 0 ? curve[curve.length - 1].value : initialCapital;
  const totalReturn = lastValue - initialCapital;
  const totalReturnPct = initialCapital > 0 ? (totalReturn / initialCapital) * 100 : 0;

  // Win rate
  const wins = sellTrades.filter((t) => (t.realizedPnl ?? 0) > 0);
  const losses = sellTrades.filter((t) => (t.realizedPnl ?? 0) < 0);
  const winRate = sellTrades.length > 0 ? wins.length / sellTrades.length : 0;

  // Profit factor
  const grossProfit = wins.reduce((s, t) => s + (t.realizedPnl ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.realizedPnl ?? 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Avg win/loss ratio
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const avgWinLossRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? Infinity : 0;

  // Largest win/loss
  const pnls = sellTrades.map((t) => t.realizedPnl ?? 0);
  const largestWin = pnls.length > 0 ? Math.max(...pnls, 0) : 0;
  const largestLoss = pnls.length > 0 ? Math.min(...pnls, 0) : 0;

  // Max consecutive wins/losses
  let maxConsWins = 0, maxConsLosses = 0, consWins = 0, consLosses = 0;
  for (const t of sellTrades) {
    if ((t.realizedPnl ?? 0) > 0) {
      consWins++;
      consLosses = 0;
    } else if ((t.realizedPnl ?? 0) < 0) {
      consLosses++;
      consWins = 0;
    }
    maxConsWins = Math.max(maxConsWins, consWins);
    maxConsLosses = Math.max(maxConsLosses, consLosses);
  }

  // Drawdown from equity curve
  let maxDDPct = 0;
  let maxDDDuration = 0;
  if (curve.length > 1) {
    let peak = curve[0].value;
    let ddStart = 0;
    for (let i = 1; i < curve.length; i++) {
      if (curve[i].value > peak) {
        peak = curve[i].value;
        ddStart = i;
      }
      const dd = ((peak - curve[i].value) / peak) * 100;
      if (dd > maxDDPct) {
        maxDDPct = dd;
        maxDDDuration = i - ddStart;
      }
    }
  }

  const recoveryFactor = maxDDPct > 0 ? totalReturnPct / maxDDPct : 0;

  // Daily returns for Sharpe/Sortino
  const dailyReturns: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    if (curve[i - 1].value > 0) {
      dailyReturns.push((curve[i].value - curve[i - 1].value) / curve[i - 1].value);
    }
  }

  let sharpeRatio = 0;
  let sortinoRatio = 0;
  if (dailyReturns.length > 1) {
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyReturns.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev > 0) {
      sharpeRatio = (mean / stdDev) * Math.sqrt(252);
    }

    const downside = dailyReturns.filter((r) => r < 0);
    if (downside.length > 0) {
      const downsideVariance = downside.reduce((s, r) => s + r ** 2, 0) / downside.length;
      const downsideStd = Math.sqrt(downsideVariance);
      if (downsideStd > 0) {
        sortinoRatio = (mean / downsideStd) * Math.sqrt(252);
      }
    }
  }

  // Avg trade duration (hours between buy and sell for same symbol — approximate)
  let totalDuration = 0;
  let durationCount = 0;
  const openTimestamps = new Map<string, number[]>();
  for (const t of trades) {
    if (t.side === "buy") {
      const arr = openTimestamps.get(t.symbol) ?? [];
      arr.push(t.timestamp);
      openTimestamps.set(t.symbol, arr);
    } else if (t.side === "sell") {
      const arr = openTimestamps.get(t.symbol);
      if (arr && arr.length > 0) {
        const openTs = arr.shift()!;
        totalDuration += (t.timestamp - openTs) / 3600000;
        durationCount++;
      }
    }
  }
  const avgTradeDuration = durationCount > 0 ? totalDuration / durationCount : 0;

  // Monthly returns
  const monthlyReturns: { month: string; return: number }[] = [];
  if (curve.length > 0) {
    const byMonth = new Map<string, { first: number; last: number }>();
    for (const p of curve) {
      const month = p.date.slice(0, 7); // "YYYY-MM"
      const existing = byMonth.get(month);
      if (!existing) {
        byMonth.set(month, { first: p.value, last: p.value });
      } else {
        existing.last = p.value;
      }
    }
    for (const [month, { first, last }] of byMonth) {
      monthlyReturns.push({
        month,
        return: first > 0 ? ((last - first) / first) * 100 : 0,
      });
    }
  }

  return {
    totalReturn,
    totalReturnPct,
    sharpeRatio,
    sortinoRatio,
    maxDrawdownPct: Math.round(maxDDPct * 100) / 100,
    maxDrawdownDuration: maxDDDuration,
    recoveryFactor,
    winRate,
    totalTrades: sellTrades.length,
    profitFactor,
    avgWinLossRatio,
    maxConsecutiveWins: maxConsWins,
    maxConsecutiveLosses: maxConsLosses,
    largestWin,
    largestLoss,
    avgTradeDuration,
    monthlyReturns,
  };
}

export function calculateMetrics(
  trades: BacktestTrade[],
  curve: EquityPoint[],
  initialCapital: number,
): BacktestMetrics {
  const base = computeBaseMetrics(trades, curve, initialCapital);

  // Per-symbol breakdown
  const symbols = new Set(trades.map((t) => t.symbol));
  const perSymbol: Record<string, Omit<BacktestMetrics, "perSymbol">> = {};

  for (const symbol of symbols) {
    const symbolTrades = trades.filter((t) => t.symbol === symbol);
    perSymbol[symbol] = computeBaseMetrics(symbolTrades, [], initialCapital);
    // Compute totalReturn from trade PnLs for per-symbol
    const symbolPnl = symbolTrades
      .filter((t) => t.realizedPnl !== null)
      .reduce((s, t) => s + (t.realizedPnl ?? 0), 0);
    perSymbol[symbol].totalReturn = symbolPnl;
    perSymbol[symbol].totalReturnPct = initialCapital > 0 ? (symbolPnl / initialCapital) * 100 : 0;
  }

  return { ...base, perSymbol };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && pnpm vitest run agent/src/backtesting/__tests__/metrics-calculator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add agent/src/backtesting/metrics-calculator.ts agent/src/backtesting/__tests__/metrics-calculator.test.ts
git commit -m "feat(agent): add MetricsCalculator for backtest performance analytics"
```

---

## Task 4: Agent — BacktestEngine (orchestrator)

**Depends on:** Tasks 1, 2, 3

**Files:**
- Create: `agent/src/backtesting/backtest-engine.ts`
- Test: `agent/src/backtesting/__tests__/backtest-engine.test.ts`

**Context:** Orchestrates the full replay. Fetches historical bars from Alpaca, replays chronologically through the existing `preScreenBatch` function and `CycleRunner`, passes anomalies to `TradeGenerator` and `RiskManager`, executes via `BacktestExecutor`, and computes metrics via `calculateMetrics`. Emits progress events. See `agent/src/analysis/cycle-runner.ts` for how analysis works. See `agent/src/ingestion/alpaca-backfill.ts` for the data fetch pattern. See `agent/src/trading/trade-generator.ts` and `agent/src/trading/risk-manager.ts` for trade evaluation.

**Step 1: Write the failing test**

Create `agent/src/backtesting/__tests__/backtest-engine.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import type { BacktestConfig, DataTick, Anomaly } from "@finwatch/shared";
import { BacktestEngine } from "../backtest-engine.js";

function makeConfig(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    id: "bt-test",
    symbols: ["AAPL"],
    startDate: "2024-01-01",
    endDate: "2024-01-10",
    timeframe: "1Day",
    initialCapital: 100000,
    riskLimits: {
      maxPositionSize: 50000,
      maxExposure: 80000,
      maxDailyTrades: 10,
      maxLossPct: 5,
      cooldownMs: 0,
    },
    severityThreshold: "high",
    confidenceThreshold: 0.5,
    preScreenerSensitivity: 0.5,
    tradeSizingStrategy: "fixed_qty",
    modelId: "test-model",
    ...overrides,
  };
}

function makeTicks(): DataTick[] {
  return [
    { sourceId: "backtest", timestamp: new Date("2024-01-02").getTime(), symbol: "AAPL", metrics: { open: 180, high: 185, low: 178, close: 183, volume: 1000000 }, metadata: {} },
    { sourceId: "backtest", timestamp: new Date("2024-01-03").getTime(), symbol: "AAPL", metrics: { open: 183, high: 190, low: 182, close: 188, volume: 1500000 }, metadata: {} },
    { sourceId: "backtest", timestamp: new Date("2024-01-04").getTime(), symbol: "AAPL", metrics: { open: 188, high: 195, low: 187, close: 193, volume: 2000000 }, metadata: {} },
  ];
}

describe("BacktestEngine", () => {
  it("constructs with valid config", () => {
    const engine = new BacktestEngine(makeConfig());
    expect(engine).toBeDefined();
  });

  it("runs a backtest with mock data fetcher and analysis", async () => {
    const config = makeConfig();
    const ticks = makeTicks();

    // Mock data fetcher returns our ticks
    const fetchData = vi.fn().mockResolvedValue(ticks);

    // Mock analysis that returns one anomaly
    const anomaly: Anomaly = {
      id: "anom-1",
      severity: "high",
      source: "backtest",
      symbol: "AAPL",
      timestamp: ticks[2].timestamp,
      description: "Price spike detected",
      metrics: { close: 193, volume: 2000000 },
      preScreenScore: 0.85,
      sessionId: "bt-test",
    };
    const runAnalysis = vi.fn().mockResolvedValue([anomaly]);

    const progressEvents: unknown[] = [];
    const onProgress = vi.fn((p) => progressEvents.push(p));

    const engine = new BacktestEngine(config, { fetchData, runAnalysis });
    engine.onProgress = onProgress;

    const result = await engine.run();

    expect(result.status).toBe("completed");
    expect(result.config).toEqual(config);
    expect(fetchData).toHaveBeenCalled();
    expect(runAnalysis).toHaveBeenCalled();
    expect(result.equityCurve.length).toBeGreaterThan(0);
    expect(result.metrics).not.toBeNull();
    expect(onProgress).toHaveBeenCalled();
  });

  it("can be cancelled", async () => {
    const config = makeConfig();
    const fetchData = vi.fn().mockResolvedValue(makeTicks());
    // Slow analysis to allow cancellation
    const runAnalysis = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 100))
    );

    const engine = new BacktestEngine(config, { fetchData, runAnalysis });

    const runPromise = engine.run();
    engine.cancel();

    const result = await runPromise;
    expect(result.status).toBe("cancelled");
  });

  it("returns failed status on data fetch error", async () => {
    const config = makeConfig();
    const fetchData = vi.fn().mockRejectedValue(new Error("API error"));
    const runAnalysis = vi.fn();

    const engine = new BacktestEngine(config, { fetchData, runAnalysis });
    const result = await engine.run();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("API error");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && pnpm vitest run agent/src/backtesting/__tests__/backtest-engine.test.ts`
Expected: FAIL

**Step 3: Write implementation**

Create `agent/src/backtesting/backtest-engine.ts`:

```typescript
import type {
  BacktestConfig,
  BacktestResult,
  BacktestProgress,
  BacktestTrade,
  DataTick,
  Anomaly,
  TradeAction,
} from "@finwatch/shared";
import { BacktestExecutor } from "./backtest-executor.js";
import { calculateMetrics } from "./metrics-calculator.js";
import { TradeGenerator } from "../trading/trade-generator.js";
import { RiskManager, type RiskContext } from "../trading/risk-manager.js";
import { createLogger } from "../utils/logger.js";

export type DataFetcher = (
  symbols: string[],
  startDate: string,
  endDate: string,
  timeframe: string,
) => Promise<DataTick[]>;

export type AnalysisRunner = (
  ticks: DataTick[],
) => Promise<Anomaly[]>;

export type BacktestDeps = {
  fetchData: DataFetcher;
  runAnalysis: AnalysisRunner;
};

export class BacktestEngine {
  private config: BacktestConfig;
  private deps: BacktestDeps;
  private cancelled = false;
  private log = createLogger("backtest-engine");
  onProgress?: (progress: BacktestProgress) => void;

  constructor(config: BacktestConfig, deps: BacktestDeps) {
    this.config = config;
    this.deps = deps;
  }

  cancel(): void {
    this.cancelled = true;
  }

  async run(): Promise<BacktestResult> {
    const startTime = Date.now();

    try {
      // Fetch historical data
      const ticks = await this.deps.fetchData(
        this.config.symbols,
        this.config.startDate,
        this.config.endDate,
        this.config.timeframe,
      );

      // Sort chronologically
      ticks.sort((a, b) => a.timestamp - b.timestamp);

      if (ticks.length === 0) {
        return this.makeResult("completed", startTime, [], [], []);
      }

      const executor = new BacktestExecutor(this.config.id, this.config.initialCapital);
      const tradeGen = new TradeGenerator({
        hasPosition: (s) => executor.hasPosition(s),
        getQty: (s) => executor.getQty(s),
      });
      const riskMgr = new RiskManager(this.config.riskLimits);

      let anomaliesFound = 0;
      let tradesExecuted = 0;
      const dailyTradeCount = new Map<string, number>();
      const lastTradeBySymbol = new Map<string, number>();

      // Group ticks by date for batching
      const batches = this.groupByDate(ticks);
      const totalTicks = ticks.length;
      let ticksProcessed = 0;

      for (const [date, batch] of batches) {
        if (this.cancelled) {
          return this.makeResult("cancelled", startTime, executor.getTradeLog(), executor.getEquityCurve(), []);
        }

        // Run analysis on this batch
        const anomalies = await this.deps.runAnalysis(batch);
        anomaliesFound += anomalies.length;

        // Filter by severity threshold
        const actionable = anomalies.filter(
          (a) => this.severityRank(a.severity) >= this.severityRank(this.config.severityThreshold),
        );

        // Generate and execute trades
        for (const anomaly of actionable) {
          const action = tradeGen.evaluate(anomaly);
          if (!action) continue;

          if (action.confidence < this.config.confidenceThreshold) continue;

          const dateKey = date;
          const currentDayTrades = dailyTradeCount.get(dateKey) ?? 0;
          const lastPrice = batch[batch.length - 1].metrics["close"] ?? 0;

          const ctx: RiskContext = {
            currentPrice: lastPrice,
            currentExposure: this.calculateExposure(executor, batch),
            dailyTradeCount: currentDayTrades,
            lastTradeTimestamp: lastTradeBySymbol.get(action.symbol),
            lastTradeSymbol: action.symbol,
            portfolioValue: executor.portfolioValue(this.latestPrices(batch)),
          };

          const check = riskMgr.check(action, ctx);
          if (!check.approved) continue;

          const fillPrice = lastPrice;
          const trade = executor.execute(action, fillPrice, batch[batch.length - 1].timestamp);
          if (trade) {
            tradesExecuted++;
            dailyTradeCount.set(dateKey, currentDayTrades + 1);
            lastTradeBySymbol.set(action.symbol, batch[batch.length - 1].timestamp);
          }
        }

        // Snapshot equity
        executor.snapshot(date, this.latestPrices(batch));

        ticksProcessed += batch.length;
        this.emitProgress(ticksProcessed, totalTicks, anomaliesFound, tradesExecuted, date);
      }

      const trades = executor.getTradeLog();
      const curve = executor.getEquityCurve();
      const metrics = calculateMetrics(trades, curve, this.config.initialCapital);

      return {
        id: this.config.id,
        config: this.config,
        status: "completed",
        metrics,
        trades,
        equityCurve: curve,
        createdAt: startTime,
        completedAt: Date.now(),
        error: null,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error("Backtest failed", { error: message });
      return {
        id: this.config.id,
        config: this.config,
        status: "failed",
        metrics: null,
        trades: [],
        equityCurve: [],
        createdAt: startTime,
        completedAt: Date.now(),
        error: message,
      };
    }
  }

  private groupByDate(ticks: DataTick[]): Map<string, DataTick[]> {
    const groups = new Map<string, DataTick[]>();
    for (const tick of ticks) {
      const date = new Date(tick.timestamp).toISOString().split("T")[0];
      const arr = groups.get(date) ?? [];
      arr.push(tick);
      groups.set(date, arr);
    }
    return groups;
  }

  private severityRank(severity: string): number {
    const ranks: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };
    return ranks[severity] ?? 0;
  }

  private latestPrices(ticks: DataTick[]): Record<string, number> {
    const prices: Record<string, number> = {};
    for (const tick of ticks) {
      if (tick.symbol && tick.metrics["close"] !== undefined) {
        prices[tick.symbol] = tick.metrics["close"];
      }
    }
    return prices;
  }

  private calculateExposure(
    executor: BacktestExecutor,
    ticks: DataTick[],
  ): number {
    const prices = this.latestPrices(ticks);
    const positions = executor.getPositions();
    let exposure = 0;
    for (const [symbol, pos] of Object.entries(positions)) {
      const price = prices[symbol] ?? pos.avgEntry;
      exposure += pos.qty * price;
    }
    return exposure;
  }

  private emitProgress(
    ticksProcessed: number,
    totalTicks: number,
    anomaliesFound: number,
    tradesExecuted: number,
    currentDate: string,
  ): void {
    this.onProgress?.({
      backtestId: this.config.id,
      ticksProcessed,
      totalTicks,
      anomaliesFound,
      tradesExecuted,
      currentDate,
    });
  }

  private makeResult(
    status: BacktestResult["status"],
    startTime: number,
    trades: BacktestTrade[],
    curve: { date: string; value: number }[],
    _anomalies: Anomaly[],
  ): BacktestResult {
    return {
      id: this.config.id,
      config: this.config,
      status,
      metrics: status === "completed" ? calculateMetrics(trades, curve, this.config.initialCapital) : null,
      trades,
      equityCurve: curve,
      createdAt: startTime,
      completedAt: Date.now(),
      error: null,
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && pnpm vitest run agent/src/backtesting/__tests__/backtest-engine.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add agent/src/backtesting/backtest-engine.ts agent/src/backtesting/__tests__/backtest-engine.test.ts
git commit -m "feat(agent): add BacktestEngine orchestrator with progress events"
```

---

## Task 5: Rust — Database migration + backtest types + commands

**Depends on:** Task 1 (shared types for JSON shape reference)

**Files:**
- Modify: `src-tauri/src/migrations.rs` — add migration 003
- Create: `src-tauri/src/types/backtest.rs` — Rust types for serde
- Modify: `src-tauri/src/types/mod.rs` — add `pub mod backtest;`
- Create: `src-tauri/src/commands/backtest.rs` — Tauri commands
- Modify: `src-tauri/src/commands/mod.rs` — add `pub mod backtest;`
- Modify: `src-tauri/src/lib.rs` — register commands

**Context:** Follow the exact pattern from `src-tauri/src/commands/anomalies.rs` for command structure. Follow `src-tauri/src/migrations.rs` for migration pattern. Follow `src-tauri/src/types/anomaly.rs` for serde type pattern. All types use `#[derive(Debug, Clone, Serialize, Deserialize)]` with `#[serde(rename_all = "camelCase")]`.

**Step 1: Add Rust backtest types**

Create `src-tauri/src/types/backtest.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestConfig {
    pub id: String,
    pub symbols: Vec<String>,
    pub start_date: String,
    pub end_date: String,
    pub timeframe: String,
    pub initial_capital: f64,
    pub risk_limits: serde_json::Value,
    pub severity_threshold: String,
    pub confidence_threshold: f64,
    pub pre_screener_sensitivity: f64,
    pub trade_sizing_strategy: String,
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestSummary {
    pub id: String,
    pub status: String,
    pub config: serde_json::Value,
    pub metrics: Option<serde_json::Value>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
    pub ticks_processed: i64,
    pub total_ticks: i64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestTrade {
    pub id: String,
    pub backtest_id: String,
    pub symbol: String,
    pub side: String,
    pub qty: f64,
    pub fill_price: f64,
    pub timestamp: i64,
    pub anomaly_id: Option<String>,
    pub rationale: Option<String>,
    pub realized_pnl: Option<f64>,
}
```

Add to `src-tauri/src/types/mod.rs`:

```rust
pub mod backtest;
```

**Step 2: Add migration**

Add to `all_migrations()` in `src-tauri/src/migrations.rs`:

```rust
Migration {
    name: "003_backtest_tables",
    sql: "CREATE TABLE IF NOT EXISTS backtests (
              id TEXT PRIMARY KEY,
              status TEXT NOT NULL DEFAULT 'running',
              config TEXT NOT NULL,
              metrics TEXT,
              created_at INTEGER NOT NULL,
              completed_at INTEGER,
              ticks_processed INTEGER NOT NULL DEFAULT 0,
              total_ticks INTEGER NOT NULL DEFAULT 0,
              error TEXT
          );

          CREATE TABLE IF NOT EXISTS backtest_trades (
              id TEXT PRIMARY KEY,
              backtest_id TEXT NOT NULL REFERENCES backtests(id) ON DELETE CASCADE,
              symbol TEXT NOT NULL,
              side TEXT NOT NULL,
              qty REAL NOT NULL,
              fill_price REAL NOT NULL,
              timestamp INTEGER NOT NULL,
              anomaly_id TEXT,
              rationale TEXT,
              realized_pnl REAL
          );

          CREATE INDEX IF NOT EXISTS idx_backtest_trades_backtest ON backtest_trades(backtest_id);
          CREATE INDEX IF NOT EXISTS idx_backtests_status ON backtests(status);
          CREATE INDEX IF NOT EXISTS idx_backtests_created ON backtests(created_at);",
},
```

**Step 3: Add Tauri commands**

Create `src-tauri/src/commands/backtest.rs`:

```rust
use crate::db::DbPool;
use crate::types::backtest::{BacktestSummary, BacktestTrade};

pub fn backtest_insert_db(pool: &DbPool, id: &str, config_json: &str) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;

    conn.execute(
        "INSERT INTO backtests (id, status, config, created_at) VALUES (?1, 'running', ?2, ?3)",
        rusqlite::params![id, config_json, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn backtest_update_status_db(
    pool: &DbPool,
    id: &str,
    status: &str,
    metrics_json: Option<&str>,
    error: Option<&str>,
) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;

    conn.execute(
        "UPDATE backtests SET status = ?1, metrics = ?2, completed_at = ?3, error = ?4 WHERE id = ?5",
        rusqlite::params![status, metrics_json, now, error, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn backtest_update_progress_db(
    pool: &DbPool,
    id: &str,
    ticks_processed: i64,
    total_ticks: i64,
) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE backtests SET ticks_processed = ?1, total_ticks = ?2 WHERE id = ?3",
        rusqlite::params![ticks_processed, total_ticks, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn backtest_insert_trades_db(pool: &DbPool, trades: &[BacktestTrade]) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    for trade in trades {
        conn.execute(
            "INSERT INTO backtest_trades (id, backtest_id, symbol, side, qty, fill_price, timestamp, anomaly_id, rationale, realized_pnl)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![
                trade.id,
                trade.backtest_id,
                trade.symbol,
                trade.side,
                trade.qty,
                trade.fill_price,
                trade.timestamp,
                trade.anomaly_id,
                trade.rationale,
                trade.realized_pnl,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn backtest_list_db(pool: &DbPool) -> Result<Vec<BacktestSummary>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, status, config, metrics, created_at, completed_at, ticks_processed, total_ticks, error FROM backtests ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let config_str: String = row.get(2)?;
            let metrics_str: Option<String> = row.get(3)?;
            Ok(BacktestSummary {
                id: row.get(0)?,
                status: row.get(1)?,
                config: serde_json::from_str(&config_str).unwrap_or_default(),
                metrics: metrics_str.and_then(|s| serde_json::from_str(&s).ok()),
                created_at: row.get(4)?,
                completed_at: row.get(5)?,
                ticks_processed: row.get(6)?,
                total_ticks: row.get(7)?,
                error: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

pub fn backtest_get_db(pool: &DbPool, id: &str) -> Result<BacktestSummary, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let config_str: String = conn
        .query_row("SELECT config FROM backtests WHERE id = ?1", [id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, status, config, metrics, created_at, completed_at, ticks_processed, total_ticks, error FROM backtests WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    stmt.query_row([id], |row| {
        let metrics_str: Option<String> = row.get(3)?;
        Ok(BacktestSummary {
            id: row.get(0)?,
            status: row.get(1)?,
            config: serde_json::from_str(&config_str).unwrap_or_default(),
            metrics: metrics_str.and_then(|s| serde_json::from_str(&s).ok()),
            created_at: row.get(4)?,
            completed_at: row.get(5)?,
            ticks_processed: row.get(6)?,
            total_ticks: row.get(7)?,
            error: row.get(8)?,
        })
    })
    .map_err(|e| e.to_string())
}

pub fn backtest_get_trades_db(pool: &DbPool, backtest_id: &str) -> Result<Vec<BacktestTrade>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, backtest_id, symbol, side, qty, fill_price, timestamp, anomaly_id, rationale, realized_pnl FROM backtest_trades WHERE backtest_id = ?1 ORDER BY timestamp")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([backtest_id], |row| {
            Ok(BacktestTrade {
                id: row.get(0)?,
                backtest_id: row.get(1)?,
                symbol: row.get(2)?,
                side: row.get(3)?,
                qty: row.get(4)?,
                fill_price: row.get(5)?,
                timestamp: row.get(6)?,
                anomaly_id: row.get(7)?,
                rationale: row.get(8)?,
                realized_pnl: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

pub fn backtest_delete_db(pool: &DbPool, id: &str) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM backtest_trades WHERE backtest_id = ?1", [id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM backtests WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// Tauri command wrappers
#[tauri::command]
pub fn backtest_start(
    pool: tauri::State<'_, DbPool>,
    config: String,
) -> Result<String, String> {
    let parsed: serde_json::Value = serde_json::from_str(&config).map_err(|e| e.to_string())?;
    let id = parsed["id"].as_str().unwrap_or("bt-unknown").to_string();
    backtest_insert_db(&pool, &id, &config)?;
    Ok(id)
}

#[tauri::command]
pub fn backtest_list(pool: tauri::State<'_, DbPool>) -> Result<Vec<BacktestSummary>, String> {
    backtest_list_db(&pool)
}

#[tauri::command]
pub fn backtest_get(
    pool: tauri::State<'_, DbPool>,
    backtest_id: String,
) -> Result<BacktestSummary, String> {
    backtest_get_db(&pool, &backtest_id)
}

#[tauri::command]
pub fn backtest_get_trades(
    pool: tauri::State<'_, DbPool>,
    backtest_id: String,
) -> Result<Vec<BacktestTrade>, String> {
    backtest_get_trades_db(&pool, &backtest_id)
}

#[tauri::command]
pub fn backtest_delete(
    pool: tauri::State<'_, DbPool>,
    backtest_id: String,
) -> Result<(), String> {
    backtest_delete_db(&pool, &backtest_id)
}
```

Add `pub mod backtest;` to `src-tauri/src/commands/mod.rs`.

Register in `src-tauri/src/lib.rs` — add to the `generate_handler![]` list:

```rust
commands::backtest::backtest_start,
commands::backtest::backtest_list,
commands::backtest::backtest_get,
commands::backtest::backtest_get_trades,
commands::backtest::backtest_delete,
```

**Step 4: Run Rust tests**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && pnpm test:rust`
Expected: PASS (existing tests still pass, migration applies cleanly)

**Step 5: Commit**

```bash
git add src-tauri/src/types/backtest.rs src-tauri/src/types/mod.rs src-tauri/src/commands/backtest.rs src-tauri/src/commands/mod.rs src-tauri/src/migrations.rs src-tauri/src/lib.rs
git commit -m "feat(rust): add backtest DB tables, types, and Tauri commands"
```

---

## Task 6: Frontend — Zustand backtest slice

**Depends on:** Task 1 (shared types)

**Files:**
- Create: `src/store/backtest-slice.ts`
- Test: `src/store/__tests__/backtest-slice.test.ts`

**Context:** Follow the exact pattern from `src/store/trading-slice.ts`. Uses `createStore` from `zustand/vanilla`. State is updated immutably.

**Step 1: Write the failing test**

Create `src/store/__tests__/backtest-slice.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createBacktestSlice } from "../backtest-slice.js";
import type { BacktestResult, BacktestProgress } from "@finwatch/shared";

const mockResult: BacktestResult = {
  id: "bt-001",
  config: {
    id: "bt-001",
    symbols: ["AAPL"],
    startDate: "2024-01-01",
    endDate: "2024-12-31",
    timeframe: "1Day",
    initialCapital: 100000,
    riskLimits: { maxPositionSize: 10000, maxExposure: 50000, maxDailyTrades: 5, maxLossPct: 2, cooldownMs: 60000 },
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
};

describe("backtest-slice", () => {
  let slice: ReturnType<typeof createBacktestSlice>;

  beforeEach(() => {
    slice = createBacktestSlice();
  });

  it("starts with empty state", () => {
    const state = slice.getState();
    expect(state.runs).toEqual([]);
    expect(state.activeRunId).toBeNull();
    expect(state.progress).toBeNull();
    expect(state.comparisonIds).toEqual([]);
  });

  it("sets active run id", () => {
    slice.getState().setActiveRunId("bt-001");
    expect(slice.getState().activeRunId).toBe("bt-001");
  });

  it("sets progress", () => {
    const progress: BacktestProgress = {
      backtestId: "bt-001",
      ticksProcessed: 50,
      totalTicks: 200,
      anomaliesFound: 3,
      tradesExecuted: 1,
      currentDate: "2024-03-15",
    };
    slice.getState().setProgress(progress);
    expect(slice.getState().progress).toEqual(progress);
  });

  it("adds a completed run", () => {
    slice.getState().addRun(mockResult);
    expect(slice.getState().runs).toHaveLength(1);
    expect(slice.getState().runs[0].id).toBe("bt-001");
  });

  it("removes a run", () => {
    slice.getState().addRun(mockResult);
    slice.getState().removeRun("bt-001");
    expect(slice.getState().runs).toHaveLength(0);
  });

  it("sets comparison ids", () => {
    slice.getState().setComparisonIds(["bt-001", "bt-002"]);
    expect(slice.getState().comparisonIds).toEqual(["bt-001", "bt-002"]);
  });

  it("clears progress when run completes", () => {
    slice.getState().setProgress({
      backtestId: "bt-001",
      ticksProcessed: 50,
      totalTicks: 200,
      anomaliesFound: 3,
      tradesExecuted: 1,
      currentDate: "2024-03-15",
    });
    slice.getState().addRun(mockResult);
    slice.getState().clearProgress();
    expect(slice.getState().progress).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && pnpm vitest run src/store/__tests__/backtest-slice.test.ts`
Expected: FAIL

**Step 3: Write implementation**

Create `src/store/backtest-slice.ts`:

```typescript
import { createStore } from "zustand/vanilla";
import type { BacktestResult, BacktestProgress } from "@finwatch/shared";

type BacktestState = {
  runs: BacktestResult[];
  activeRunId: string | null;
  progress: BacktestProgress | null;
  comparisonIds: string[];

  setActiveRunId: (id: string | null) => void;
  setProgress: (progress: BacktestProgress) => void;
  clearProgress: () => void;
  addRun: (result: BacktestResult) => void;
  removeRun: (id: string) => void;
  setComparisonIds: (ids: string[]) => void;
  setRuns: (runs: BacktestResult[]) => void;
};

export type BacktestSlice = ReturnType<typeof createBacktestSlice>;

export function createBacktestSlice() {
  return createStore<BacktestState>((set) => ({
    runs: [],
    activeRunId: null,
    progress: null,
    comparisonIds: [],

    setActiveRunId: (id) => set({ activeRunId: id }),

    setProgress: (progress) => set({ progress }),

    clearProgress: () => set({ progress: null }),

    addRun: (result) =>
      set((state) => ({
        runs: [result, ...state.runs.filter((r) => r.id !== result.id)],
      })),

    removeRun: (id) =>
      set((state) => ({
        runs: state.runs.filter((r) => r.id !== id),
        comparisonIds: state.comparisonIds.filter((cid) => cid !== id),
      })),

    setComparisonIds: (ids) => set({ comparisonIds: ids }),

    setRuns: (runs) => set({ runs }),
  }));
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && pnpm vitest run src/store/__tests__/backtest-slice.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/store/backtest-slice.ts src/store/__tests__/backtest-slice.test.ts
git commit -m "feat(ui): add Zustand backtest slice for state management"
```

---

## Task 7: Frontend — BacktestConfig page

**Depends on:** Task 6 (backtest slice)

**Files:**
- Create: `src/pages/BacktestConfig.tsx`
- Modify: `src/App.tsx` — add tab, create store, render page
- Modify: `src/components/Sidebar.tsx` — add Backtest nav item

**Context:** Follow the existing page pattern from `src/pages/Settings.tsx`. The app uses Tailwind v4 with terminal aesthetic — dark bg, monospace, green accent (`#00ff88`). Tab system is string union in `App.tsx`. Sidebar uses unicode icons. Invoke commands via `invoke()` from `@tauri-apps/api/core`. Listen for events via `useTauriEvent` hook.

**Step 1: Create the BacktestConfig page**

Create `src/pages/BacktestConfig.tsx`:

```tsx
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTauriEvent } from "../hooks/use-tauri-event";
import type { BacktestConfig, BacktestProgress } from "@finwatch/shared";

type Props = {
  progress: BacktestProgress | null;
  onProgress: (p: BacktestProgress) => void;
  onComplete: (backtestId: string) => void;
  runs: { id: string; status: string; startDate: string; endDate: string; totalReturnPct?: number }[];
  onViewResult: (id: string) => void;
};

export function BacktestConfigPage({ progress, onProgress, onComplete, runs, onViewResult }: Props) {
  const [symbols, setSymbols] = useState("AAPL,TSLA,MSFT");
  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");
  const [timeframe, setTimeframe] = useState<"1Day" | "1Hour">("1Day");
  const [initialCapital, setInitialCapital] = useState(100000);
  const [sizingStrategy, setSizingStrategy] = useState<"fixed_qty" | "pct_of_capital" | "kelly">("pct_of_capital");
  const [maxPositionSize, setMaxPositionSize] = useState(10000);
  const [maxExposure, setMaxExposure] = useState(50000);
  const [maxDailyTrades, setMaxDailyTrades] = useState(5);
  const [maxLossPct, setMaxLossPct] = useState(2);
  const [preScreenerSensitivity, setPreScreenerSensitivity] = useState(0.5);
  const [severityThreshold, setSeverityThreshold] = useState<"low" | "medium" | "high" | "critical">("high");
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.7);
  const [modelId, setModelId] = useState("claude-3-5-haiku-20241022");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useTauriEvent<BacktestProgress>("backtest:progress", onProgress);
  useTauriEvent<{ backtestId: string }>("backtest:complete", (payload) => {
    setRunning(false);
    onComplete(payload.backtestId);
  });

  const handleStart = async () => {
    setError(null);
    const id = `bt-${Date.now()}`;
    const config: BacktestConfig = {
      id,
      symbols: symbols.split(",").map((s) => s.trim()).filter(Boolean),
      startDate,
      endDate,
      timeframe,
      initialCapital,
      riskLimits: {
        maxPositionSize,
        maxExposure,
        maxDailyTrades,
        maxLossPct,
        cooldownMs: 0,
      },
      severityThreshold,
      confidenceThreshold,
      preScreenerSensitivity,
      tradeSizingStrategy: sizingStrategy,
      modelId,
    };

    try {
      setRunning(true);
      await invoke("backtest_start", { config: JSON.stringify(config) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-lg text-accent font-bold tracking-wide">BACKTEST</h1>

      {/* Data Selection */}
      <section className="space-y-3">
        <h2 className="text-text-secondary text-xs uppercase tracking-widest">Data Selection</h2>
        <label className="block">
          <span className="text-text-muted text-xs">Symbols (comma-separated)</span>
          <input value={symbols} onChange={(e) => setSymbols(e.target.value)} disabled={running}
            className="mt-1 w-full bg-bg-elevated border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:border-accent focus:outline-none" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-text-muted text-xs">Start Date</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={running}
              className="mt-1 w-full bg-bg-elevated border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:border-accent focus:outline-none" />
          </label>
          <label className="block">
            <span className="text-text-muted text-xs">End Date</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={running}
              className="mt-1 w-full bg-bg-elevated border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:border-accent focus:outline-none" />
          </label>
        </div>
        <div className="flex gap-2">
          {(["1Day", "1Hour"] as const).map((tf) => (
            <button key={tf} onClick={() => setTimeframe(tf)} disabled={running}
              className={`px-3 py-1.5 rounded text-xs font-mono border cursor-pointer ${timeframe === tf ? "border-accent text-accent bg-bg-elevated" : "border-border text-text-muted hover:text-text-primary"}`}>
              {tf === "1Day" ? "Daily" : "Hourly"}
            </button>
          ))}
        </div>
      </section>

      {/* Portfolio Settings */}
      <section className="space-y-3">
        <h2 className="text-text-secondary text-xs uppercase tracking-widest">Portfolio</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-text-muted text-xs">Initial Capital ($)</span>
            <input type="number" value={initialCapital} onChange={(e) => setInitialCapital(Number(e.target.value))} disabled={running}
              className="mt-1 w-full bg-bg-elevated border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:border-accent focus:outline-none" />
          </label>
          <label className="block">
            <span className="text-text-muted text-xs">Sizing Strategy</span>
            <select value={sizingStrategy} onChange={(e) => setSizingStrategy(e.target.value as typeof sizingStrategy)} disabled={running}
              className="mt-1 w-full bg-bg-elevated border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:border-accent focus:outline-none">
              <option value="fixed_qty">Fixed Quantity</option>
              <option value="pct_of_capital">% of Capital</option>
              <option value="kelly">Kelly Criterion</option>
            </select>
          </label>
        </div>
      </section>

      {/* Risk Limits */}
      <section className="space-y-3">
        <h2 className="text-text-secondary text-xs uppercase tracking-widest">Risk Limits</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-text-muted text-xs">Max Position Size ($)</span>
            <input type="number" value={maxPositionSize} onChange={(e) => setMaxPositionSize(Number(e.target.value))} disabled={running}
              className="mt-1 w-full bg-bg-elevated border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:border-accent focus:outline-none" />
          </label>
          <label className="block">
            <span className="text-text-muted text-xs">Max Exposure ($)</span>
            <input type="number" value={maxExposure} onChange={(e) => setMaxExposure(Number(e.target.value))} disabled={running}
              className="mt-1 w-full bg-bg-elevated border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:border-accent focus:outline-none" />
          </label>
          <label className="block">
            <span className="text-text-muted text-xs">Max Daily Trades</span>
            <input type="number" value={maxDailyTrades} onChange={(e) => setMaxDailyTrades(Number(e.target.value))} disabled={running}
              className="mt-1 w-full bg-bg-elevated border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:border-accent focus:outline-none" />
          </label>
          <label className="block">
            <span className="text-text-muted text-xs">Max Loss (%)</span>
            <input type="number" value={maxLossPct} onChange={(e) => setMaxLossPct(Number(e.target.value))} disabled={running}
              className="mt-1 w-full bg-bg-elevated border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:border-accent focus:outline-none" />
          </label>
        </div>
      </section>

      {/* Detection Settings */}
      <section className="space-y-3">
        <h2 className="text-text-secondary text-xs uppercase tracking-widest">Detection</h2>
        <label className="block">
          <span className="text-text-muted text-xs">Pre-Screener Sensitivity: {preScreenerSensitivity.toFixed(2)}</span>
          <input type="range" min="0" max="1" step="0.05" value={preScreenerSensitivity} onChange={(e) => setPreScreenerSensitivity(Number(e.target.value))} disabled={running}
            className="mt-1 w-full accent-accent" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-text-muted text-xs">Severity Threshold</span>
            <select value={severityThreshold} onChange={(e) => setSeverityThreshold(e.target.value as typeof severityThreshold)} disabled={running}
              className="mt-1 w-full bg-bg-elevated border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:border-accent focus:outline-none">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label className="block">
            <span className="text-text-muted text-xs">Confidence Threshold: {confidenceThreshold.toFixed(2)}</span>
            <input type="range" min="0" max="1" step="0.05" value={confidenceThreshold} onChange={(e) => setConfidenceThreshold(Number(e.target.value))} disabled={running}
              className="mt-1 w-full accent-accent" />
          </label>
        </div>
        <label className="block">
          <span className="text-text-muted text-xs">LLM Model</span>
          <input value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={running}
            className="mt-1 w-full bg-bg-elevated border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:border-accent focus:outline-none" />
        </label>
      </section>

      {/* Run Controls */}
      <div className="flex gap-3 items-center">
        <button onClick={handleStart} disabled={running}
          className="px-4 py-2 bg-accent text-bg-primary font-bold rounded text-sm hover:opacity-90 disabled:opacity-50 cursor-pointer">
          {running ? "Running..." : "Start Backtest"}
        </button>
        {running && (
          <button onClick={() => setRunning(false)}
            className="px-4 py-2 border border-severity-high text-severity-high rounded text-sm hover:bg-severity-high/10 cursor-pointer">
            Cancel
          </button>
        )}
      </div>

      {error && <p className="text-severity-high text-xs">{error}</p>}

      {/* Progress */}
      {progress && running && (
        <div className="bg-bg-elevated border border-border rounded p-4 space-y-2">
          <div className="flex justify-between text-xs text-text-muted">
            <span>Progress: {progress.ticksProcessed} / {progress.totalTicks} ticks</span>
            <span>{progress.currentDate}</span>
          </div>
          <div className="w-full bg-bg-primary rounded-full h-2">
            <div className="bg-accent h-2 rounded-full transition-all"
              style={{ width: `${progress.totalTicks > 0 ? (progress.ticksProcessed / progress.totalTicks) * 100 : 0}%` }} />
          </div>
          <div className="flex gap-4 text-xs text-text-muted">
            <span>Anomalies: {progress.anomaliesFound}</span>
            <span>Trades: {progress.tradesExecuted}</span>
          </div>
        </div>
      )}

      {/* Recent Runs */}
      {runs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-text-secondary text-xs uppercase tracking-widest">Recent Runs</h2>
          <div className="border border-border rounded overflow-hidden">
            {runs.map((run) => (
              <button key={run.id} onClick={() => onViewResult(run.id)}
                className="w-full flex justify-between items-center px-4 py-2 hover:bg-bg-elevated text-left border-b border-border last:border-b-0 cursor-pointer">
                <span className="text-xs font-mono text-text-primary">{run.id.slice(0, 12)}</span>
                <span className="text-xs text-text-muted">{run.startDate} → {run.endDate}</span>
                <span className={`text-xs font-mono ${run.status === "completed" ? "text-accent" : run.status === "failed" ? "text-severity-high" : "text-text-muted"}`}>
                  {run.status}
                </span>
                {run.totalReturnPct !== undefined && (
                  <span className={`text-xs font-mono ${run.totalReturnPct >= 0 ? "text-accent" : "text-severity-high"}`}>
                    {run.totalReturnPct >= 0 ? "+" : ""}{run.totalReturnPct.toFixed(2)}%
                  </span>
                )}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
```

**Step 2: Update Sidebar**

In `src/components/Sidebar.tsx`, update the Tab type and navItems:

```typescript
type Tab = "Dashboard" | "Anomalies" | "Agent" | "Sources" | "Backtest" | "Settings";

// Add before Settings in navItems:
  { tab: "Backtest", icon: "\u23F1" },  // ⏱ stopwatch
```

**Step 3: Update App.tsx**

In `src/App.tsx`:

1. Add to imports: `import { BacktestConfigPage } from "./pages/BacktestConfig";` and `import { createBacktestSlice } from "./store/backtest-slice";`
2. Update tabs: `const tabs = ["Dashboard", "Anomalies", "Agent", "Sources", "Backtest", "Settings"] as const;`
3. Create store: `const backtestStore = createBacktestSlice();`
4. Add to `window.__stores`: `backtest: backtestStore,`
5. Subscribe: `const backtestState = useSyncExternalStore(backtestStore.subscribe, backtestStore.getState);`
6. Add render case for Backtest tab in JSX

**Step 4: Run lint**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && pnpm lint`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pages/BacktestConfig.tsx src/components/Sidebar.tsx src/App.tsx
git commit -m "feat(ui): add BacktestConfig page with form and progress display"
```

---

## Task 8: Frontend — BacktestResults page

**Depends on:** Task 6 (backtest slice)

**Files:**
- Create: `src/pages/BacktestResults.tsx`

**Context:** This page renders the full results dashboard. Uses the terminal aesthetic. No charting library — use inline SVG or CSS-based visualizations for the equity curve and heatmap (keep it simple, no new dependencies). Data comes from props (the parent App.tsx passes the selected `BacktestResult`).

**Step 1: Create BacktestResults page**

Create `src/pages/BacktestResults.tsx` with:
- Summary cards row (Total Return, Sharpe, Max Drawdown, Win Rate, Total Trades, Profit Factor)
- Equity curve as a simple SVG polyline chart
- Trade table (sortable by timestamp)
- Per-symbol breakdown as collapsible sections
- Monthly returns heatmap as a CSS grid
- Comparison mode: overlay metrics from selected comparison runs
- Export buttons (JSON/CSV)
- Back button to return to config

Full implementation in the component — see the design doc `docs/plans/2026-02-03-backtesting-design.md` section "BacktestResults Page" for the exact layout specification. Use the same Tailwind utility classes and color tokens as other pages. The equity curve should be a responsive SVG with green line on dark bg, red shading for drawdown periods, and triangle markers for trades.

**Step 2: Wire into App.tsx**

Add the import and render the BacktestResults page when `activeTab === "Backtest"` and `backtestState.activeRunId` is set (toggle between config and results view within the Backtest tab).

**Step 3: Run lint**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && pnpm lint`
Expected: PASS

**Step 4: Commit**

```bash
git add src/pages/BacktestResults.tsx src/App.tsx
git commit -m "feat(ui): add BacktestResults dashboard with equity curve and metrics"
```

---

## Dependency Graph

```
Task 1 (Shared Types)
  ├── Task 2 (BacktestExecutor)     ← can run in parallel
  ├── Task 3 (MetricsCalculator)    ← can run in parallel
  ├── Task 5 (Rust DB/Commands)     ← can run in parallel
  └── Task 6 (Zustand Slice)        ← can run in parallel
       ├── Task 7 (BacktestConfig)  ← after Task 6
       └── Task 8 (BacktestResults) ← after Task 6

Task 4 (BacktestEngine) ← after Tasks 2 + 3
```

**Parallel Execution Plan:**
1. **Wave 1:** Task 1 (shared types — must be first)
2. **Wave 2:** Tasks 2, 3, 5, 6 (all independent, run 4 subagents in parallel)
3. **Wave 3:** Tasks 4, 7, 8 (3 subagents in parallel — Task 4 needs 2+3, Tasks 7+8 need 6)
