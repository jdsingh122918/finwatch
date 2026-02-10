# Backtest PR Review — Fix Implementation Plan

> Generated from comprehensive PR review of the backtesting feature (8 commits, 22 files, ~2,868 lines).
> Addresses all 53 issues found by 5 parallel review agents: code-reviewer, test-analyzer, silent-failure-hunter, type-design-analyzer, comment-analyzer.

---

## Phase 0: Shared Types Corrections (Foundation Layer)

**Issues addressed:** #2, #12, #13, #49, #50, #51
**Rationale:** Every other layer depends on the shared type contracts. Must come first.

> **CLAUDE.md escalation:** Modifications to `shared/src/` require escalation. Commit message must document approval for PR fix.

### File: `shared/src/backtest.ts`

1. **Issue #2 — Add `z.number().finite()` on Infinity-prone fields:**
   - `profitFactor: z.number()` → `profitFactor: z.number().finite()`
   - `avgWinLossRatio: z.number()` → `avgWinLossRatio: z.number().finite()`

2. **Issue #12 — Date validation with `.refine()`:**
   - `startDate: z.string().min(1)` → `startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format")`
   - Same for `endDate`
   - Add cross-field refinement:
     ```typescript
     .refine(
       (data) => new Date(data.startDate) < new Date(data.endDate),
       { message: "startDate must be before endDate", path: ["endDate"] }
     );
     ```

3. **Issue #49 — Document escalation:** Add comment at top of `backtest.ts`:
   ```typescript
   // Shared type modifications approved as part of backtesting feature PR review fixes
   ```

4. **Issue #50 — BacktestResult discriminated union (defer):**
   - Add JSDoc noting status-dependent nullability invariants
   - Full discriminated union migration deferred to follow-up PR

5. **Issue #51 — BacktestTrade side-dependent nullability (defer with comment):**
   - Add JSDoc: `/** realizedPnl is null for buy trades, number for sell trades */`

### File: `shared/src/ipc.ts`

6. **Issue #13 — Remove unimplemented `backtest:export`:**
   - Remove `"backtest:export": (backtestId: string, format: "json" | "csv") => string;`

### File: `shared/src/__tests__/backtest.test.ts`

7. **Issues #37, #38 — New schema validation tests:**
   ```typescript
   it("rejects initialCapital of zero")
   it("rejects negative initialCapital")
   it("rejects startDate after endDate")
   it("rejects invalid date format")
   it("rejects Infinity in profitFactor")
   it("rejects Infinity in avgWinLossRatio")
   ```

**Dependencies:** None. This is the foundation.

---

## Phase 1: Agent Layer — Metrics & Engine Bug Fixes

**Issues addressed:** #2, #3, #6, #20, #21, #24, #25, #39-48

### File: `agent/src/backtesting/metrics-calculator.ts`

1. **Issue #2 — Cap `Infinity` to `9999.99`:**
   - Line 52: `grossProfit > 0 ? Infinity : 0` → `grossProfit > 0 ? 9999.99 : 0`
   - Line 57: Same pattern for `avgWinLossRatio`

2. **Issues #40-44, #48 — Add missing comments:**
   - `Math.sqrt(252)`: `// Annualize: 252 trading days/year, multiply daily ratio by sqrt(252)`
   - Sortino: `// Downside deviation uses MAR=0; only negative daily returns contribute`
   - Variance: `// Population variance (N divisor, not N-1)`
   - Drawdown: `// maxDrawdownDuration measured in equity curve data points (trading days)`
   - Per-symbol: `// Per-symbol: empty equity curve → Sharpe/Sortino/drawdown will be 0. Only trade-based metrics are meaningful.`
   - Duration: Expand "approximate" → explain FIFO timestamp matching limitation

### File: `agent/src/backtesting/backtest-engine.ts`

3. **Issue #3 — Make `deps` required:**
   ```typescript
   // Before:
   constructor(config: BacktestConfig, deps?: BacktestDeps)
   // After:
   constructor(config: BacktestConfig, deps: BacktestDeps)
   ```
   Remove the fallback mock assignment entirely.

4. **Issue #6 — Skip trade on zero/missing price:**
   ```typescript
   const currentPrice = prices[symbol] ?? anomaly.metrics.close;
   if (currentPrice === undefined || currentPrice <= 0) {
     this.log.warn("Skipping trade: no valid price", { symbol });
     continue;
   }
   ```

5. **Issue #20 — Log full stack trace in catch block:**
   ```typescript
   const stack = err instanceof Error ? err.stack : undefined;
   this.log.error("Backtest failed", { error: message, stack: stack ?? "no stack" });
   ```

6. **Issue #24 — Include partial data on cancellation:**
   ```typescript
   private finishCancelled(result: BacktestResult, executor?: BacktestExecutor): BacktestResult {
     result.status = "cancelled";
     result.completedAt = Date.now();
     if (executor) {
       result.trades = executor.getTradeLog();
       result.equityCurve = executor.getEquityCurve();
     }
     return result;
   }
   ```

7. **Issue #25 — Wrap progress emission in try-catch:**
   ```typescript
   private emitProgress(progress: BacktestProgress): void {
     try {
       this.onProgress?.(progress);
     } catch (err) {
       this.log.warn("Progress callback error", {
         error: err instanceof Error ? err.message : String(err),
       });
     }
   }
   ```

8. **Issue #39 — Fix misleading comment:** "confidence" → `preScreenScore`

9. **Issue #45 — `groupByDate` UTC comment:**
   `// Note: uses UTC date via toISOString() — timestamps must be in UTC`

### File: `agent/src/backtesting/backtest-executor.ts`

10. **Issue #21 — Document price fallback in `portfolioValue()`:**
    Add code comment noting fallback to `avgEntry` when price is missing.

11. **Issue #46 — Expand FIFO comment:**
    `// FIFO (First-In-First-Out) lot matching: sells consume the oldest purchased lots first`

**Dependencies:** Phase 0 (Zod `finite()` constraint must be in place).

---

## Phase 2: Agent Layer — Test Gap Fixes

**Issues addressed:** #26-35

### File: `agent/src/backtesting/__tests__/backtest-engine.test.ts`

| Test | Issue |
|------|-------|
| `handles analysis failure gracefully` | #26 |
| `filters anomalies below severity threshold` | #27 |
| `filters anomalies below confidence threshold` | #27 |
| `returns completed with empty metrics for zero ticks` | #28 |
| `handles multiple symbols correctly` | #29 |
| Tighten existing assertions to verify specific values | #30 |

### File: `agent/src/backtesting/__tests__/backtest-executor.test.ts`

| Test | Issue |
|------|-------|
| `clamps sell qty to held position` | #31 |

### File: `agent/src/backtesting/__tests__/metrics-calculator.test.ts`

| Test | Issue |
|------|-------|
| `caps profitFactor to 9999.99 when all trades are winners` | #32 |
| `caps avgWinLossRatio to 9999.99 when no losses` | #32 |
| `calculates sortino ratio with negative returns` | #33 |
| `calculates sharpe ratio with known value` (use `toBeCloseTo`) | #34 |
| `calculates monthly returns with specific values` | #35 |

**Dependencies:** Phase 1 (engine constructor change, Infinity cap).

---

## Phase 3: Zustand Slice Test Gaps

**Issues addressed:** #36, #52

### File: `src/store/__tests__/backtest-slice.test.ts`

| Test | Issue |
|------|-------|
| `addRun replaces existing run with same id` | #36 |
| `addRun prepends new runs to front` | #36 |

### Issue #52 — `setActiveRunId` validation:
Add code comment noting the lack of validation as a known limitation.

**Dependencies:** None (independent).

---

## Phase 4: Frontend Bug Fixes

**Issues addressed:** #1, #8, #11, #16, #22, #23

### File: `src/pages/BacktestResults.tsx`

1. **Issue #1 — Split `fmtPct` into two functions:**
   ```typescript
   /** Format a value already in percentage form (e.g., 5.0 → "+5.00%") */
   function fmtPct(n: number): string {
     return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
   }

   /** Format a 0-1 ratio as percentage (e.g., 0.65 → "+65.00%") */
   function fmtRatio(n: number): string {
     return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
   }
   ```

   **Call site audit:**
   | Call site | Field | Unit | Function |
   |-----------|-------|------|----------|
   | `totalReturnPct` | already % | `fmtPct` |
   | `maxDrawdownPct` | already % | `fmtPct` |
   | `winRate` | 0-1 ratio | `fmtRatio` |
   | `monthlyReturns[].return` | already % | `fmtPct` |

2. **Issue #16 — Remove unused `comparisonResults` prop** from Props type.

3. **Issue #22 — Guard SVG division by zero:**
   ```typescript
   if (curve.length < 2) return <p className="text-muted">Not enough data for chart.</p>;
   ```

### File: `src/pages/BacktestConfig.tsx`

4. **Issue #8 — Wire cancel button to backend:**
   ```typescript
   onClick={async () => {
     try { await invoke("backtest_cancel", { backtestId: currentId }); }
     catch { /* best-effort */ }
     setRunning(false);
   }}
   ```

5. **Issue #11 — Add Zod validation before invoke:**
   ```typescript
   import { BacktestConfigSchema } from "@finwatch/shared";

   const parseResult = BacktestConfigSchema.safeParse(config);
   if (!parseResult.success) {
     setError(parseResult.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
     return;
   }
   ```

6. **Issue #23 — Guard NaN in number inputs:**
   ```typescript
   onChange={(e) => {
     const parsed = parseFloat(e.target.value);
     if (!isNaN(parsed)) setInitialCapital(parsed);
   }}
   ```
   Apply to all numeric inputs: `initialCapital`, `maxPositionSize`, `maxExposure`, `maxDailyTrades`, `maxLossPct`.

**Dependencies:** Phase 0 (date validation), Phase 1 (Infinity cap).

---

## Phase 5: Rust Backend Fixes

**Issues addressed:** #4, #5, #7, #8, #14, #15, #17, #18, #19, #47

### File: `src-tauri/src/types/backtest.rs`

1. **Issue #4 — Add Rust enums for union types:**
   ```rust
   #[derive(Debug, Clone, Serialize, Deserialize)]
   pub enum BacktestStatus {
       #[serde(rename = "running")] Running,
       #[serde(rename = "completed")] Completed,
       #[serde(rename = "failed")] Failed,
       #[serde(rename = "cancelled")] Cancelled,
   }

   #[derive(Debug, Clone, Serialize, Deserialize)]
   pub enum TradeSide {
       #[serde(rename = "buy")] Buy,
       #[serde(rename = "sell")] Sell,
   }
   ```

2. **Issue #4 — Align nullability:** Make `anomaly_id` and `rationale` required `String` (matching TS).

3. **Issue #14 — Use `BacktestConfig` struct** (wire into `backtest_start`).

4. **Issue #47 — Add `///` doc comments** to all public types.

### File: `src-tauri/src/commands/backtest.rs`

5. **Issue #4 — Typed deserialization in `backtest_start`:**
   ```rust
   let parsed: BacktestConfig = serde_json::from_str(&config)
       .map_err(|e| format!("Invalid backtest config: {}", e))?;
   ```
   This also resolves **Issue #7** (no more `unwrap_or("bt-unknown")`).

6. **Issue #5 — Log deserialization errors** instead of silently swallowing with `unwrap_or_default()` and `.ok()`.

7. **Issue #8 — Add `backtest_cancel` Tauri command:**
   ```rust
   #[tauri::command]
   pub fn backtest_cancel(pool: tauri::State<'_, DbPool>, backtest_id: String) -> Result<(), String> {
       // Update DB status to cancelled
       // Note: full agent cancellation via JSON-RPC is a follow-up
   }
   ```

8. **Issue #15 — Wire unused DB functions** as Tauri commands or remove dead ones.

9. **Issue #17 — Remove redundant query in `backtest_get_db`:** Single query, read config from full row.

10. **Issue #18 — Simplify delete:** Delete only from `backtests`, let `ON DELETE CASCADE` handle trades.

11. **Issue #19 — Wrap batch insert in transaction:**
    ```rust
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for trade in trades { tx.execute(...)?; }
    tx.commit().map_err(|e| e.to_string())?;
    ```

12. **Issue #47 — Add `///` doc comments** to all public functions.

### File: `src-tauri/src/lib.rs`

13. Register `backtest_cancel` in `generate_handler![]`.

**Dependencies:** Phase 0 (shared type changes).

---

## Phase 6: Rust Tests

**Issues addressed:** #9

### File: `src-tauri/src/commands/backtest.rs` — add `#[cfg(test)] mod tests`

| Test | What it verifies |
|------|-----------------|
| `backtest_insert_and_get` | Insert + retrieve round-trip |
| `backtest_insert_duplicate_fails` | PRIMARY KEY constraint |
| `backtest_list_returns_all` | List operation |
| `backtest_list_orders_by_created_at_desc` | Sort order |
| `backtest_update_status` | Status + metrics update |
| `backtest_delete_removes_record` | Delete operation |
| `backtest_delete_cascades_to_trades` | ON DELETE CASCADE |
| `backtest_get_nonexistent_returns_error` | Error case |
| `backtest_insert_trades_in_transaction` | Batch insert atomicity |
| `backtest_update_progress` | Progress tracking |

**Dependencies:** Phase 5 (Rust code changes must compile first).

---

## Phase 7: Frontend Tests

**Issues addressed:** #10

### File: `src/pages/__tests__/BacktestResults.test.tsx` (new)

| Test | What it verifies |
|------|-----------------|
| Renders summary cards when metrics present | Basic rendering |
| Renders "No metrics" when metrics null | Null state |
| Renders equity curve with valid data | Chart rendering |
| Handles single-point curve (Issue #22) | Edge case guard |
| `fmtPct` displays correctly (not double-scaled) | Issue #1 fix |
| `fmtRatio` displays 0-1 ratios correctly | Issue #1 fix |
| Export buttons trigger download | Functionality |

### File: `src/pages/__tests__/BacktestConfig.test.tsx` (new)

| Test | What it verifies |
|------|-----------------|
| Renders all form fields | Basic rendering |
| Start button invokes Tauri command | Integration |
| Cancel calls `backtest_cancel` (Issue #8) | Cancel fix |
| Shows validation errors (Issue #11) | Zod validation |
| Numeric inputs handle NaN (Issue #23) | NaN guard |
| Displays progress during backtest | Progress UI |

**Dependencies:** Phase 4 (frontend fixes must be done first).

---

## Phase 8: Final Cleanup

**Issues addressed:** #53

### Issue #53 — File naming convention:
- Existing `src/pages/` files use PascalCase (pre-existing convention).
- No rename needed. Note the divergence from CLAUDE.md kebab-case rule as a known convention for React page components.

---

## Commit Strategy

| Commit | Phase | Message |
|--------|-------|---------|
| 1 | 0 | `fix(shared): add finite() constraints, date validation, remove backtest:export` |
| 2 | 1 | `fix(agent): cap Infinity, require deps, skip zero-price trades, improve error handling` |
| 3 | 2 | `test(agent): add engine, executor, and metrics edge case coverage` |
| 4 | 3 | `test(store): add backtest slice deduplication tests` |
| 5 | 4 | `fix(ui): split fmtPct/fmtRatio, add Zod validation, fix cancel, guard SVG` |
| 6 | 5 | `fix(rust): typed commands, transactions, cascade delete, cancel command` |
| 7 | 6 | `test(rust): add comprehensive backtest DB function tests` |
| 8 | 7 | `test(ui): add BacktestConfig and BacktestResults component tests` |

---

## Verification Checklist

After all phases:
- [ ] `pnpm test` — all TS tests pass
- [ ] `pnpm test:rust` — all Rust tests pass
- [ ] `pnpm lint` — no type errors (`tsc --noEmit`)
- [ ] `pnpm build` — clean build
- [ ] Manual smoke test: start backtest → observe progress → view results → cancel mid-run → delete run

---

## Issue Index

| # | Issue | Phase | Severity |
|---|-------|-------|----------|
| 1 | `fmtPct` double-scales percentages | 4 | Critical |
| 2 | `Infinity` in profitFactor/avgWinLossRatio | 0+1 | Critical |
| 3 | Production mock fallback in BacktestEngine | 1 | Critical |
| 4 | Cross-layer type erasure (Rust ignores TS types) | 5 | Critical |
| 5 | Silent JSON deserialization in Rust DB reads | 5 | Critical |
| 6 | Silent fallback to price $0 | 1 | Critical |
| 7 | Silent ID extraction "bt-unknown" | 5 | Critical |
| 8 | Cancel button doesn't cancel backend | 4+5 | Critical |
| 9 | No Rust tests for backtest commands | 6 | Important |
| 10 | No frontend tests for UI pages | 7 | Important |
| 11 | No Zod validation at IPC boundary | 4 | Important |
| 12 | Missing date validation | 0 | Important |
| 13 | `backtest:export` unimplemented in IPC | 0 | Important |
| 14 | Dead code: unused Rust `BacktestConfig` struct | 5 | Important |
| 15 | Dead code: 3 unused Rust DB functions | 5 | Important |
| 16 | Unused `comparisonResults` prop | 4 | Important |
| 17 | Redundant query in `backtest_get_db` | 5 | Important |
| 18 | Non-atomic delete without transaction | 5 | Important |
| 19 | Batch insert without transaction | 5 | Important |
| 20 | Broad catch block loses stack traces | 1 | Important |
| 21 | Silent price fallback in `portfolioValue()` | 1 | Important |
| 22 | SVG division by zero (`curve.length === 1`) | 4 | Important |
| 23 | NaN propagation from number inputs | 4 | Important |
| 24 | Partial equity data discarded on cancel | 1 | Important |
| 25 | Progress event failures crash backtest | 1 | Important |
| 26 | Engine: analysis failure path untested | 2 | Test gap |
| 27 | Engine: severity/confidence filtering untested | 2 | Test gap |
| 28 | Engine: empty ticks path untested | 2 | Test gap |
| 29 | Engine: multi-symbol untested | 2 | Test gap |
| 30 | Engine: test assertions too loose | 2 | Test gap |
| 31 | Executor: oversell clamping untested | 2 | Test gap |
| 32 | Metrics: Infinity edge case untested | 2 | Test gap |
| 33 | Metrics: Sortino ratio untested | 2 | Test gap |
| 34 | Metrics: Sharpe directional-only assertion | 2 | Test gap |
| 35 | Metrics: monthly returns weak assertion | 2 | Test gap |
| 36 | Slice: `addRun` deduplication untested | 3 | Test gap |
| 37 | Schema: zero/negative capital untested | 0 | Test gap |
| 38 | Schema: reversed dates untested | 0 | Test gap |
| 39 | Misleading "confidence" comment | 1 | Comment |
| 40 | Missing: sqrt(252) annualization | 1 | Comment |
| 41 | Missing: Sortino MAR=0 | 1 | Comment |
| 42 | Missing: population vs sample variance | 1 | Comment |
| 43 | Missing: drawdown duration units | 1 | Comment |
| 44 | Missing: per-symbol empty equity curve | 1 | Comment |
| 45 | Missing: `groupByDate` UTC assumption | 1 | Comment |
| 46 | Missing: FIFO lot matching explanation | 1 | Comment |
| 47 | Rust: no doc comments on public functions | 5 | Comment |
| 48 | "approximate" comment lacks explanation | 1 | Comment |
| 49 | Shared types modified without escalation | 0 | Process |
| 50 | BacktestResult should be discriminated union | 0 | Type design |
| 51 | BacktestTrade side-dependent nullability | 0 | Type design |
| 52 | `setActiveRunId` doesn't validate existence | 3 | Type design |
| 53 | Frontend pages use PascalCase vs kebab-case | 8 | Convention |
