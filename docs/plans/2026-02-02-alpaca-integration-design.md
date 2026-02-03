# Alpaca Markets Integration Design

## Overview

Full Alpaca Markets integration for FinWatch: real-time market data ingestion via WebSocket streaming, paper trading with auto-execution on detected anomalies, and live trading with manual approval. The system's self-improvement loop uses paper trade outcomes as automated ground-truth feedback.

## Architecture

```
Alpaca WebSocket → AlpacaStreamSource → Normalizer → Buffer → Analysis
                                                                  ↓
                                                         Anomaly detected
                                                                  ↓
                                                        Trading Engine
                                                         ↓           ↓
                                                   Paper: auto    Live: suggest
                                                   execute        → UI approval
                                                         ↓           ↓
                                                      Alpaca Trading API
```

Three new capabilities:
1. **Streaming Data Source** — WebSocket-based `AlpacaStreamSource` in the ingestion layer
2. **Trading Engine** — Anomaly-to-trade pipeline with paper auto-execution and live suggestions
3. **Credential Management** — Encrypted API key storage via Tauri's secure store, configured through the UI

## Component Design

### 1. AlpacaStreamSource

**File:** `agent/src/ingestion/alpaca-stream-source.ts`

Implements the existing `DataSource` interface with streaming extensions.

**Connection lifecycle:**
- On `start()`, authenticates via WebSocket to `wss://stream.data.alpaca.markets/v2/iex` (or `/sip` for paid tier)
- Subscribes to configured symbols for trades, quotes, and bars
- On disconnect, reconnects with exponential backoff (1s, 2s, 4s, max 30s)
- Integrates with existing `HealthMonitor` for degraded/offline state reporting

**Data mapping:**
- Bar messages (`{T:"b", S:"AAPL", o, h, l, c, v, t}`) → `DataTick` with metrics `{open, high, low, close, volume}`
- Trade messages → ticks with `{price, size}` metrics
- Quote messages → ticks with `{bidPrice, askPrice, bidSize, askSize, spread}` (spread computed as `askPrice - bidPrice`)

**Buffer integration:**
- Streaming ticks flow into the existing `DataBuffer` identically to polled ticks
- Pre-screener's urgent flush (score > 0.6) works naturally with real-time data

**Historical backfill:**
- On first connect, uses REST SDK (`getBarsV2`) to pull 30 days of daily bars per symbol
- Provides baseline data for z-score calculations before live stream starts

**Configuration:**
```typescript
{
  id: "alpaca-stream",
  type: "alpaca",
  config: {
    feed: "iex" | "sip",
    symbols: ["AAPL", "TSLA", "SPY"],
    channels: ["trades", "quotes", "bars"],
  }
}
```

### 2. Trading Engine

**Directory:** `agent/src/trading/`

**`trade-generator.ts`**
- Listens for anomaly events from `MonitorLoop`
- Evaluates trade action based on: anomaly severity (high/critical only), anomaly type (price spike → sell/short, volume drop → hold/exit), current positions (no doubling, no selling unheld)
- Outputs `TradeAction` — symbol, side, qty, order type, rationale, confidence score
- Rule set evolves alongside existing `RuleEvolution` system

**`paper-executor.ts`**
- Auto-executes `TradeAction` against Alpaca paper trading API
- Tracks local portfolio mirror in SQLite (positions, P&L, trade history)
- Builds track record for the improvement system to analyze

**`live-suggester.ts`**
- Wraps `TradeAction` into `TradeSuggestion` event pushed to UI via Tauri events
- Includes anomaly context, rationale, one-click approve/dismiss
- Suggestions expire after configurable timeout (default 5 minutes)
- On approval, forwards to Alpaca live trading API

**`position-tracker.ts`**
- Polls Alpaca positions/account endpoints to sync local state
- Provides portfolio context to trade generator
- Feeds the UI portfolio view

### 3. Credential Management

**Encrypted storage** via `tauri-plugin-store` (AES-256, OS keychain).

**Rust commands** in `src-tauri/src/commands/credentials.rs`:
- `credentials:set` — Stores `{keyId, secretKey, paperKeyId, paperSecretKey}`
- `credentials:get` — Retrieves decrypted keys (Rust process only, not exposed to renderer)
- `credentials:exists` — Boolean check for UI setup flow

**Agent key delivery:**
- Rust reads decrypted keys at sidecar startup
- Passes as JSON-RPC `config:credentials` message over stdio
- Keys live in agent memory only — never written to disk

### 4. IPC Extensions

**New commands (pull):**
- `trading:suggest` — Get pending trade suggestions
- `trading:approve` / `trading:dismiss` — User acts on suggestion
- `trading:history` — Past trades with P&L
- `trading:positions` — Current portfolio
- `trading:mode` — Get/set paper vs live mode

**New events (push):**
- `trade:suggestion` — New suggestion for UI approval
- `trade:executed` — Paper auto-executed or live approved
- `trade:expired` — Suggestion timed out
- `portfolio:update` — Position/P&L changes

### 5. Risk Management & Safety

**Hard limits** (configurable, conservative defaults):
- Max position size: $1,000/symbol (paper: $10,000)
- Max total exposure: $5,000 (paper: $50,000)
- Max trades/day: 10 (paper: unlimited)
- Max single loss: -5% triggers auto-close suggestion
- Cooldown: 15 min between trades on same symbol
- Enforced in Rust before forwarding to sidecar — agent cannot override

**Paper-to-live gate:**
- Live mode locked until paper trading has run 7+ days with 20+ trades
- Explicit user confirmation dialog required (not just a toggle)

**Kill switch:**
- Prominent UI button that immediately closes WebSocket, cancels open orders, stops trading engine
- Monitoring/analysis continues (observation without action)

**Audit trail:**
- `trade_audit` SQLite table logs every action: generated, executed, approved, dismissed, expired, rejected-by-limit
- Full context: triggering anomaly, confidence score, limits checked, outcome

**Mode isolation:**
- Paper and live use separate API key pairs
- App enforces at credential level — cannot mix keys across modes

### 6. Feedback Loop Integration

**Trade outcome feedback:**
- `PaperExecutor` auto-generates anomaly feedback by comparing trade results:
  - Profitable → anomaly verdict: `confirmed`
  - Loss → anomaly verdict: `needs_review`
- Continuous feedback stream without user input

**Strategy evolution:**
- Extends `RuleEvolution` with trading-specific rules
- Analyzes: which anomaly types → profitable trades, which severity thresholds are actionable, which symbols respond predictably
- Daily evolution pass incorporates trade P&L data

**Domain knowledge enrichment:**
- Memory system captures trading context patterns
- Feeds back into prompt builder for richer LLM analysis context

**Consolidation:**
- Weekly pass produces `TRADING_PERFORMANCE.md` alongside `KNOWLEDGE.md`
- Tracks win rate, average P&L per anomaly type, strategy drift

### 7. New Shared Types

Deliberate, versioned expansion of frozen contracts:

```typescript
// shared/src/trading.ts
TradeAction: { symbol, side, qty, type, rationale, confidence, anomalyId }
TradeSuggestion: { action: TradeAction, expiresAt, status: "pending" | "approved" | "dismissed" | "expired" }
PortfolioPosition: { symbol, qty, avgEntry, currentPrice, unrealizedPnl }
TradingMode: "paper" | "live"
RiskLimits: { maxPositionSize, maxExposure, maxDailyTrades, maxLossPct, cooldownMs }
TradeAuditEntry: { id, action, anomalyId, outcome, limitsChecked, timestamp }
```

### 8. UI Additions

- **Settings > Alpaca** — API key input (paper + live), feed selection (IEX/SIP), symbol watchlist
- **Trading page** — Live suggestions feed, position table, trade history with anomaly links, paper/live mode toggle, kill switch button

## Implementation Phases

### Phase 1 — Data Ingestion
- `AlpacaStreamSource` with WebSocket streaming
- Historical backfill via REST
- Credential management (encrypted store + settings UI)
- Normalizer mappings for Alpaca data formats
- IPC extensions for Alpaca config
- **Shippable value:** Real-time market data source for anomaly detection

### Phase 2 — Trading Engine
- `TradeGenerator`, `PaperExecutor`, `PositionTracker`
- Risk management guardrails (hard limits, kill switch)
- Trading UI page (suggestions, positions, history)
- Trade audit logging
- Paper trade → anomaly feedback automation
- **Shippable value:** Validates anomaly detection with paper money

### Phase 3 — Live Trading & Strategy Evolution
- `LiveSuggester` with approval flow
- Paper-to-live gate enforcement
- Trading-aware rule evolution
- `TRADING_PERFORMANCE.md` consolidation
- Mode isolation and live safety checks
- **Shippable value:** Full closed-loop anomaly detection → trading system

## Dependencies

- `@alpacahq/alpaca-trade-api` — Node.js SDK for REST + WebSocket
- `tauri-plugin-store` — Encrypted credential storage
- No new LLM provider dependencies

## Alpaca API Notes

- **Free tier:** IEX feed (real-time, ~2% market volume), 200 req/min, 30 WebSocket symbols
- **Paid tier ($99/mo):** SIP feed (all exchanges), 10,000 req/min, unlimited symbols
- **Auth:** Header-based (`APCA-API-KEY-ID` / `APCA-API-SECRET-KEY`)
- **Paper trading:** Separate endpoint and keys, no real money
- Start with IEX (free) for development, upgrade to SIP for production
