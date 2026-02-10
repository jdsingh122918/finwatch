# Trading Strategy v2 Design

## Overview

Overhaul the trading strategy system from a simple anomaly-to-action lookup table into a retail quant pipeline with technical indicator confluence, market regime awareness, and intelligent position sizing. The LLM anomaly detection remains the primary trade trigger — no trade happens without an anomaly — but every decision is now informed by market context.

## Architecture

```
                        ┌─────────────────────────┐
                        │   Rust Indicator Engine  │
                        │  (RSI, MACD, BB, ATR)    │
                        └──────────┬──────────────┘
                                   │ indicators per symbol
                                   ▼
Anomaly Detection ──► Confluence Engine (Node.js agent)
                        │
                        ├─ Regime Detector (trending/mean-rev/volatile)
                        ├─ Signal Scorer (anomaly + indicators → score)
                        └─ Position Sizer (Kelly/ATR-based)
                                   │
                                   ▼
                        Enhanced TradeGenerator v2
                                   │
                                   ▼
                        RiskManager (unchanged)
```

### What changes

- **Rust gains** an `IndicatorEngine` — computes rolling technical indicators on tick buffers and exposes results via a new Tauri command (`indicators:compute`).
- **Node.js agent gains** three new modules: `RegimeDetector`, `ConfluenceScorer`, and `PositionSizer`.
- **TradeGenerator v2** replaces the signal-to-action lookup table with a scoring pipeline.

### What stays the same

- LLM anomaly detection remains the trigger.
- RiskManager's 5 checks are untouched.
- TradingGate, LiveSuggester, PaperExecutor unchanged.
- All shared types remain frozen (we extend, not modify).
- `TradeAction` type is unchanged — same fields, smarter values. Nothing downstream breaks.

---

## Component 1: Rust Indicator Engine

**Location:** `src-tauri/src/indicators/`

Computes four core indicators on tick arrays. The agent calls `indicators:compute` with a symbol and tick data, gets back a structured result.

### Indicators

| Indicator | Parameters | Output | Purpose |
|-----------|-----------|--------|---------|
| RSI | period=14 | 0–100 per tick | Overbought/oversold detection |
| MACD | fast=12, slow=26, signal=9 | line, signal, histogram per tick | Trend direction and momentum |
| Bollinger Bands | period=20, std=2.0 | upper, middle, lower, %B per tick | Volatility envelope and mean reversion |
| ATR | period=14 | dollar value per tick | Volatility measurement for position sizing |

### Interface

```rust
#[tauri::command]
fn indicators_compute(
    symbol: String,
    ticks: Vec<TickInput>,  // {timestamp, open, high, low, close, volume}
) -> IndicatorResult {
    IndicatorResult { rsi, macd, bollinger, atr }
}
```

### Compute strategy

- **Backtests:** Pre-compute indicators for the entire date range upfront in a single call per symbol. The replay loop indexes into arrays rather than recomputing per day.
- **Live trading:** Computed on each new tick batch (the rolling 20-day window the agent already maintains).

A 252-day backtest across 10 symbols means ~2,500 indicator computations. Rust handles this in milliseconds.

---

## Component 2: Market Regime Detector

**Location:** `agent/src/trading/regime-detector.ts`

Classifies the current market condition for a symbol using the indicators from Rust. The regime determines how the strategy behaves.

### Regimes

| Regime | Condition | Strategy Bias |
|--------|-----------|---------------|
| **Trending** | RSI > 60 or < 40, MACD histogram expanding, price outside Bollinger bands | Follow momentum — anomalies in trend direction get boosted, counter-trend gets penalized |
| **Mean-reverting** | RSI 45–55, MACD histogram near zero, price within middle Bollinger band | Fade extremes — price spike anomalies favor reversal trades, not momentum |
| **Volatile** | ATR > 1.5x its 20-day average, Bollinger band width expanding | Reduce size — anomalies are real but unpredictable, cut position sizes by 50% |

### Interface

```typescript
type Regime = "trending_up" | "trending_down" | "mean_reverting" | "volatile";

type RegimeContext = {
  regime: Regime;
  confidence: number;    // 0-1, how clearly the regime is identified
  atrMultiple: number;   // current ATR / 20-day avg ATR
  rsiZone: "overbought" | "neutral" | "oversold";
};

function detectRegime(indicators: IndicatorResult): RegimeContext;
```

### Conflict resolution

When indicators disagree (e.g., RSI says overbought but MACD is expanding), the regime falls back to `volatile` with lower confidence. Deliberately conservative — unclear signals mean smaller trades, not no trades.

---

## Component 3: Signal Confluence Engine

**Location:** `agent/src/trading/confluence-scorer.ts`

Replaces the "one anomaly = one action" model. Scores how much evidence supports a trade before acting. An anomaly alone is a hypothesis; technical indicators are corroborating evidence.

### Scoring system (0–100)

```typescript
type SignalScore = {
  total: number;          // 0-100 composite
  components: {
    anomaly: number;      // 0-40 pts — severity + LLM confidence
    trend: number;        // 0-20 pts — MACD/RSI alignment with trade direction
    momentum: number;     // 0-20 pts — price position relative to Bollinger bands
    volume: number;       // 0-20 pts — volume confirmation of the move
  };
  direction: "long" | "short";
  regime: RegimeContext;
};
```

### Point allocation (example: BUY signal)

| Component | Full points when... | Zero points when... |
|-----------|---|---|
| Anomaly (40) | Critical severity + confidence > 0.8 | Low severity or confidence < 0.5 |
| Trend (20) | RSI < 40 (oversold) + MACD crossing up | RSI > 70 (overbought against a buy) |
| Momentum (20) | Price near lower Bollinger band | Price above upper band |
| Volume (20) | Volume anomaly confirms (volume spike on buy) | Volume declining (no conviction) |

### Action thresholds

- Score **< 40** — No trade (insufficient evidence)
- Score **40–60** — Trade at minimum size
- Score **60–80** — Trade at normal size
- Score **> 80** — Trade at maximum size (strong confluence)

---

## Component 4: Smart Position Sizing

**Location:** `agent/src/trading/position-sizer.ts`

Replaces the hardcoded `qty=1` with three sizing methods that account for volatility, conviction, and portfolio state.

### ATR-based sizing (volatility-adjusted)

```
dollarRisk = ATR(14) x riskMultiplier (default 2.0)
baseQty = accountRiskPerTrade / dollarRisk
```

Volatile stocks get smaller positions, calm stocks get larger. A $100 ATR stock gets 1/10th the position of a $10 ATR stock, keeping dollar risk constant.

### Confluence-scaled sizing

```
scaledQty = baseQty x confluenceMultiplier

Score < 40  → 0.0x (no trade)
Score 40-60 → 0.5x (half size)
Score 60-80 → 1.0x (full size)
Score > 80  → 1.5x (conviction size)
```

### Regime adjustment

```
finalQty = scaledQty x regimeMultiplier

trending     → 1.0x (normal)
mean_revert  → 0.75x (slightly cautious)
volatile     → 0.5x (half size)
```

### Portfolio-level constraint

```
maxSymbolAllocation = 20% of portfolio
currentAllocation = existingPosition + proposedOrder
if currentAllocation > maxSymbolAllocation → clamp qty
```

### Full formula chain

```
ATR → baseQty → x confluence → x regime → clamp(riskLimits) → finalQty
```

Stacks with the existing RiskManager checks. The sizer proposes an intelligent quantity, then RiskManager enforces hard limits (max exposure, max position size, daily cap). Sizer is "how much should we trade", RiskManager is "how much can we trade".

---

## Component 5: Enhanced TradeGenerator v2

**Location:** `agent/src/trading/trade-generator.ts` (replaces existing)

Wires everything together into a single decision flow.

### Decision flow

```
Anomaly arrives
    │
    ├─ 1. Fetch indicators (Rust: indicators:compute)
    ├─ 2. Detect regime (RegimeDetector)
    ├─ 3. Score confluence (ConfluenceScorer)
    │
    ▼
Score < 40? ──► SKIP (log reason, no trade)
    │
    ▼
    ├─ 4. Determine direction
    │     Regime=trending_up + price_drop anomaly → BUY (dip in uptrend)
    │     Regime=trending_up + price_spike anomaly → HOLD (don't fade the trend)
    │     Regime=mean_reverting + price_spike → SELL (fade the extreme)
    │     Regime=volatile + any → direction from anomaly but half-sized
    │
    ├─ 5. Check existing position
    │     Has position + same direction → SKIP (no doubling)
    │     Has position + opposite direction → close first, then open if score > 60
    │
    ├─ 6. Size the position (PositionSizer)
    │     ATR base → confluence scale → regime adjust → clamp
    │
    ▼
Emit TradeAction {symbol, side, qty, type, rationale, confidence, anomalyId}
```

### Rich rationale

The `rationale` field becomes descriptive. Instead of "price_spike detected", it reads:

> BUY AAPL: price drop anomaly (severity: high, confidence: 0.82) in trending-up regime. Confluence score 73/100 — RSI oversold (34), MACD bullish crossover, price at lower Bollinger band. ATR-sized at 15 shares (0.5% portfolio risk).

This flows through to the UI in `TradeSuggestion`, giving users real context for approval decisions.

---

## Component 6: Backtest Integration

### Modified backtest loop

**Current:**
```
For each date → LLM analysis → anomalies → TradeGenerator.evaluate() → execute
```

**New:**
```
Pre-compute: indicators for full date range (single Rust call per symbol)
                │
For each date:  │
  ├─ LLM analysis → anomalies
  ├─ Index into pre-computed indicators for current date
  ├─ RegimeDetector.detect(indicators[date])
  ├─ ConfluenceScorer.score(anomaly, indicators[date], regime)
  ├─ PositionSizer.size(score, regime, atr, portfolio)
  └─ TradeGenerator v2 decision → BacktestExecutor
```

### New backtest metrics (added to MetricsCalculator)

| Metric | Purpose |
|--------|---------|
| Avg confluence score | Are you trading on strong or weak signals? |
| Win rate by regime | Which regime does the strategy perform best in? |
| Win rate by score bucket | Do high-confluence trades actually win more? |
| Avg position size / ATR | Is sizing adapting to volatility properly? |

These metrics close the feedback loop — after a backtest you can see "trades with confluence > 70 won 68% of the time, trades with 40-50 won only 41%" and tune thresholds accordingly.

No changes to backtest config schema (new fields are internal), Rust persistence layer, or the UI results page (new metrics appear as additional rows).

---

## New Files Summary

| File | Runtime | Purpose |
|------|---------|---------|
| `src-tauri/src/indicators/mod.rs` | Rust | Indicator engine module |
| `src-tauri/src/indicators/rsi.rs` | Rust | RSI computation |
| `src-tauri/src/indicators/macd.rs` | Rust | MACD computation |
| `src-tauri/src/indicators/bollinger.rs` | Rust | Bollinger Bands computation |
| `src-tauri/src/indicators/atr.rs` | Rust | ATR computation |
| `agent/src/trading/regime-detector.ts` | Node.js | Market regime classification |
| `agent/src/trading/confluence-scorer.ts` | Node.js | Multi-signal scoring |
| `agent/src/trading/position-sizer.ts` | Node.js | ATR/confluence/regime-aware sizing |

## Modified Files

| File | Change |
|------|--------|
| `agent/src/trading/trade-generator.ts` | Replace lookup table with v2 decision flow |
| `agent/src/backtesting/backtest-engine.ts` | Add indicator pre-compute step, pass context through |
| `agent/src/backtesting/metrics-calculator.ts` | Add confluence/regime breakdown metrics |
| `src-tauri/src/lib.rs` | Register `indicators:compute` command |
