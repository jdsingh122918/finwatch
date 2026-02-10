# Watchlist & Ticker Selector

**Date:** 2026-02-04
**Status:** Design approved

## Summary

Replace the manual comma-separated ticker input with a searchable, categorized ticker selector. Users browse Alpaca's full asset list on a dedicated Watchlist page, and see a compact chip display in Settings.

## Current State

- Tickers entered as comma-separated string in Settings text input
- Stored in SQLite config as JSON, passed to agent on startup as `string[]`
- No validation, no search, no discovery

## Design

### Data Layer

**New Tauri command: `assets_fetch`**
- Calls Alpaca `GET /v2/assets?status=active&tradable=true` using stored API credentials
- Returns: `{ symbol, name, exchange, class, status }[]`
- Cached in SQLite `assets` table with `fetched_at` timestamp
- Returns cached data if less than 24 hours old
- On API failure, returns stale cache if available

**New Zustand slice: `watchlist-slice.ts`**
- `assets: Asset[]` — full Alpaca asset list (fetched on demand)
- `watchlist: string[]` — user's selected symbols (synced with config)
- `pendingChanges: boolean` — whether watchlist differs from actively streaming symbols
- `searchQuery: string` / `categoryFilter: string` — UI filter state
- Actions: `fetchAssets()`, `addSymbol(s)`, `removeSymbol(s)`, `applyChanges()`
- Watchlist stored internally as a `Set` for dedup, serialized as array for config

### Watchlist Page

New route `/watchlist` in Sidebar, between Dashboard and Anomaly Feed.

**Layout (top to bottom):**

1. **Header bar** — Title "Watchlist", symbol count pill (`12/20 symbols`), "Apply Changes" button (visible when `pendingChanges` is true, green accent).

2. **Filter bar** — Search input (debounced 150ms, filters by symbol or name) + dropdown for asset class (`All`, `US Equity`, `Crypto`, etc. from Alpaca `class` field) + optional exchange filter (`NYSE`, `NASDAQ`, `AMEX`).

3. **Asset table** — Columns: checkbox (add/remove toggle), Symbol, Name, Exchange, Class. Virtualized rows (CSS `overflow-y` with fixed row heights, no extra dependency). Active watchlist items sorted to top with visual distinction (green left border). Clicking checkbox toggles watchlist membership in local state.

4. **Soft limit warning** — Banner appears when count exceeds 20: "Monitoring many symbols may increase API load and slow anomaly detection." Dismissible per session, reappears on next visit if still over.

### Settings Integration

Replace comma-separated text input with:
- **Chip/tag display** — each active ticker as a pill with `×` remove button
- **"Manage Watchlist →" link** — navigates to `/watchlist`
- **"Apply Changes" button** — visible when `pendingChanges` is true

Removing a chip sets `pendingChanges: true`. No inline adding in Settings.

### Apply Changes Flow

1. User clicks "Apply Changes" (available on Watchlist page and Settings)
2. New symbol list saved to config via `config_update`
3. Confirmation dialog: "Restart agent to apply new symbols?" (Confirm/Cancel)
4. On confirm: agent stopped and restarted with updated symbols
5. `pendingChanges` resets to false
6. StatusBar symbol count updates to reflect new active set

Empty watchlist is valid — confirmation warns: "No symbols selected. The agent will start with no data streams."

### Edge Cases

- **No API key:** Watchlist page shows empty state with link to Settings. Chip display in Settings still works for existing tickers.
- **API failure:** Return stale cache if available. No cache → error banner with "Retry" button.
- **Soft limit:** Threshold at 20. Warning only, no hard block.
- **Search performance:** Client-side filtering on cached list. Debounce 150ms. Virtualized rows handle thousands of assets.

## File Changes

| File | Change |
|------|--------|
| `src-tauri/src/commands/assets.rs` | New `assets_fetch` command, SQLite cache |
| `src/store/watchlist-slice.ts` | New Zustand slice |
| `src/pages/Watchlist.tsx` | New page — search, filters, virtualized table |
| `src/pages/Settings.tsx` | Replace text input with chips + link |
| `src/App.tsx` | Add `/watchlist` route and Sidebar entry |
| `src/components/SymbolChips.tsx` | Reusable chip component (Settings + Watchlist) |

**No changes to `shared/`** — asset list is frontend-only state. Config contract (`symbols: string[]`) unchanged.

**No changes to `agent/`** — agent receives symbols on startup as before.
