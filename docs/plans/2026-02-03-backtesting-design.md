# Backtesting Feature Design

## Overview

Add a backtesting system to FinWatch that replays historical Alpaca market data through the existing LLM-powered anomaly detection and trade generation pipeline, simulates execution, and presents comprehensive performance analytics. Supports configurable parameters, full dashboard visualization, side-by-side run comparison, and result export.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Historical data source | Alpaca API only | Already implemented, keeps it simple |
| Timeframe granularity | Daily + hourly | Good flexibility without data overload |
| LLM involvement | Full LLM analysis | Most faithful to production behavior |
| Performance metrics | Full dashboard | Equity curves, heatmaps, per-symbol breakdown |
| Strategy comparison | Side-by-side comparison | Avoids runaway LLM cost of parameter sweeps |
| Configurability | Full | Symbols, dates, risk limits, thresholds, sizing, model |
| Persistence | SQLite + exportable reports | Survives restarts, supports external analysis |

---

## Architecture

Three layers mirror the existing system:

```
UI (BacktestConfig + BacktestResults pages)
  ↕ Tauri commands/events
Rust (SQLite persistence, IPC bridge)
  ↕ JSON-RPC over stdio
Agent (BacktestEngine, BacktestExecutor, MetricsCalculator)
```

Data flow:
1. User configures and launches a backtest from the UI
2. Rust layer validates, inserts a `backtests` row, forwards config to agent via JSON-RPC
3. Agent's `BacktestEngine` fetches historical bars from Alpaca REST API
4. Engine replays ticks chronologically through `PreScreener → LLM → TradeGenerator → RiskManager → BacktestExecutor`
5. Progress events stream back to UI via `backtest:progress`
6. On completion, `MetricsCalculator` computes all metrics
7. Results stored in SQLite, `backtest:complete` event triggers UI refresh

---

## Agent Layer

### BacktestEngine (`agent/src/backtesting/backtest-engine.ts`)

Orchestrates the full replay. Takes a `BacktestConfig` and:

1. **Fetches data** — Uses the existing `alpaca-backfill.ts` client, extended to support hourly bars and arbitrary date ranges. Fetches all requested symbols, sorts ticks chronologically into a unified timeline.

2. **Replay loop** — Iterates through ticks in time order:
   - Batch ticks into windows (mimicking `MonitorLoop` grouping in live mode)
   - Run each batch through `PreScreener` with configured sensitivity
   - Qualifying batches go to `PromptBuilder → LLM → ResponseParser`
   - Detected anomalies pass to `TradeGenerator.evaluate()` with configured thresholds
   - Valid trade actions go through `RiskManager.check()` with configured risk limits
   - Approved trades execute in `BacktestExecutor`

3. **Progress reporting** — Emits `backtest:progress` events: `{ backtestId, ticksProcessed, totalTicks, anomaliesFound, tradesExecuted, currentDate }`

4. **Completion** — Passes trade log and position history to `MetricsCalculator`, stores results, emits `backtest:complete`.

### BacktestExecutor (`agent/src/backtesting/backtest-executor.ts`)

Simulates order execution without touching Alpaca. Internal state:
- `cash` — starts at `initialCapital`
- `positions` — map of symbol → `{ qty, avgEntry, lots[] }` using FIFO lot tracking
- `tradeLog` — every fill with timestamp, price, side, qty, rationale

Buy: deducts `qty * fillPrice` from cash, adds to position.
Sell: removes oldest lots first (FIFO), calculates realized P&L per lot.
Fill price: bar close price at the current tick's timestamp.

At each bar, snapshots total portfolio value (`cash + sum(position.qty * currentPrice)`) for equity curve and drawdown calculations.

### MetricsCalculator (`agent/src/backtesting/metrics-calculator.ts`)

Takes the trade log and daily portfolio snapshots to compute:

- **Core**: total P&L, total return %, win rate, number of trades, avg trade duration
- **Risk-adjusted**: Sharpe ratio (annualized), Sortino ratio, max drawdown (% and duration), recovery factor
- **Distribution**: profit factor, avg win / avg loss ratio, max consecutive wins/losses, largest single win/loss
- **Per-symbol**: all above metrics broken down by symbol
- **Time-series**: daily equity curve, daily drawdown curve, monthly returns grid

---

## Database Schema

New SQLite tables in `src-tauri/src/db.rs`:

```sql
CREATE TABLE backtests (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,          -- "running" | "completed" | "failed" | "cancelled"
  config TEXT NOT NULL,          -- JSON blob of BacktestConfig
  metrics TEXT,                  -- JSON blob of BacktestMetrics (null while running)
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  ticks_processed INTEGER DEFAULT 0,
  total_ticks INTEGER DEFAULT 0,
  error TEXT
);

CREATE TABLE backtest_trades (
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

CREATE INDEX idx_backtest_trades_backtest ON backtest_trades(backtest_id);
CREATE INDEX idx_backtests_status ON backtests(status);
CREATE INDEX idx_backtests_created ON backtests(created_at);
```

### Tauri Commands

| Command | Description |
|---------|-------------|
| `backtest:start` | Validate config, insert row, forward to agent |
| `backtest:cancel` | Signal agent to abort, update status |
| `backtest:list` | Return all runs with summary metrics |
| `backtest:get` | Return full detail for one run (config, metrics, trades) |
| `backtest:delete` | Remove run and associated trades |
| `backtest:export` | Serialize run to JSON or CSV, write to user-chosen path |

### Tauri Events

| Event | Payload | Direction |
|-------|---------|-----------|
| `backtest:progress` | `BacktestProgress` | Agent → UI |
| `backtest:complete` | `{ backtestId, status }` | Agent → UI |

---

## Shared Types

New file: `shared/src/backtest.ts` (addition only, no modifications to existing contracts).

```typescript
import type { RiskLimits } from "./trading";
import type { Anomaly } from "./anomaly";

export type BacktestConfig = {
  id: string;
  symbols: string[];
  startDate: string;              // ISO date
  endDate: string;                // ISO date
  timeframe: "1Day" | "1Hour";
  initialCapital: number;
  riskLimits: RiskLimits;
  severityThreshold: Anomaly["severity"];
  confidenceThreshold: number;
  preScreenerSensitivity: number;
  tradeSizingStrategy: "fixed_qty" | "pct_of_capital" | "kelly";
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

export type BacktestResult = {
  id: string;
  config: BacktestConfig;
  status: "running" | "completed" | "failed" | "cancelled";
  metrics: BacktestMetrics | null;
  trades: BacktestTrade[];
  equityCurve: { date: string; value: number }[];
  createdAt: number;
  completedAt: number | null;
  error: string | null;
};

export type BacktestMetrics = {
  totalReturn: number;
  totalReturnPct: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdownPct: number;
  maxDrawdownDuration: number;    // days
  recoveryFactor: number;
  winRate: number;
  totalTrades: number;
  profitFactor: number;
  avgWinLossRatio: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  largestWin: number;
  largestLoss: number;
  avgTradeDuration: number;       // hours
  monthlyReturns: { month: string; return: number }[];
  perSymbol: Record<string, Omit<BacktestMetrics, "perSymbol">>;
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
```

IPC additions to `shared/src/ipc.ts`:
- Commands: `backtest:start`, `backtest:cancel`, `backtest:list`, `backtest:get`, `backtest:delete`, `backtest:export`
- Events: `backtest:progress`, `backtest:complete`

---

## Frontend

### BacktestConfig Page (`src/pages/BacktestConfig.tsx`)

Added to sidebar navigation. Form split into sections:

**Data Selection**
- Symbol picker — multi-select from configured symbols
- Date range — start and end date pickers
- Timeframe toggle — "Daily" or "Hourly"

**Portfolio Settings**
- Initial capital — numeric input (default $100,000)
- Trade sizing strategy — dropdown: "fixed_qty", "pct_of_capital", "kelly"

**Risk Limits**
- Max position size, max exposure, max daily trades, max loss % — numeric inputs, pre-filled from current system defaults

**Detection Settings**
- Pre-screener sensitivity — slider (0.0–1.0)
- Severity threshold — dropdown: "low", "medium", "high", "critical"
- Confidence threshold — slider (0.0–1.0)
- LLM model — dropdown of available models

**Run Controls**
- "Start Backtest" button — validates inputs, calls `backtest:start`
- While running: progress bar (ticks processed / total), current date, live anomaly/trade counters
- "Cancel" button to abort

**Recent Runs** — Below the form, a table of past runs: status, date range, total return, link to results.

### BacktestResults Page (`src/pages/BacktestResults.tsx`)

**Top Bar** — Backtest id, date range, symbols, status badge. Buttons: "Export JSON", "Export CSV", "Compare", "Delete".

**Summary Cards Row** — Horizontal card strip:
- Total Return (% and $)
- Sharpe Ratio
- Max Drawdown (%)
- Win Rate
- Total Trades
- Profit Factor

**Equity Curve Chart** — Line chart of portfolio value over time. Drawdown periods shaded red. Trade markers (green buy triangles, red sell triangles).

**Monthly Returns Heatmap** — Grid: months as columns, years as rows, cells colored green (positive) to red (negative).

**Trade Table** — Sortable, filterable: timestamp, symbol, side, qty, fill price, realized P&L, rationale. Clicking a trade highlights it on the equity curve.

**Per-Symbol Breakdown** — Tabs/accordion per symbol: return, win rate, trade count, mini equity curve.

**Comparison Mode** — "Compare" button opens a selector for 1-2 other saved runs. Overlays equity curves on same chart, adds columns to summary cards for side-by-side metrics. Color-coded per run.

All charts use the terminal aesthetic: dark background, monospace labels, green accent (`#00ff88`), severity colors for loss/drawdown.

### Zustand Store (`src/store/backtest-slice.ts`)

```typescript
type BacktestState = {
  runs: BacktestResult[];
  activeRunId: string | null;
  progress: BacktestProgress | null;
  comparisonIds: string[];

  startBacktest(config: BacktestConfig): void;
  cancelBacktest(id: string): void;
  setProgress(progress: BacktestProgress): void;
  completeBacktest(id: string, result: BacktestResult): void;
  deleteBacktest(id: string): void;
  setComparisonIds(ids: string[]): void;
  loadRuns(): void;
};
```

---

## New Files Summary

```
shared/src/backtest.ts                          — Shared types
agent/src/backtesting/backtest-engine.ts         — Replay orchestrator
agent/src/backtesting/backtest-executor.ts       — Simulated execution
agent/src/backtesting/metrics-calculator.ts      — Performance metrics
agent/src/backtesting/__tests__/                 — Tests for all above
src/pages/BacktestConfig.tsx                     — Config form page
src/pages/BacktestResults.tsx                    — Results dashboard page
src/store/backtest-slice.ts                      — Zustand state
src-tauri/src/commands/backtest.rs               — Tauri commands
```

Modified files:
- `src-tauri/src/db.rs` — Add migration for new tables
- `shared/src/ipc.ts` — Add backtest commands and events
- `shared/src/index.ts` — Re-export backtest types
- `src/App.tsx` — Add routes for new pages
- `src/components/Sidebar.tsx` — Add backtest nav items
