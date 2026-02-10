# FinWatch UI Redesign — Terminal Aesthetic

**Date:** 2026-02-03
**Direction:** Terminal/hacker aesthetic with balanced data density
**Styling:** Tailwind CSS
**Navigation:** Slim left sidebar (48px, icon-only)
**Status bar:** Always-visible bottom bar (28px)

---

## Design System Foundation

### Typography
- Font stack: `JetBrains Mono`, `Fira Code`, `monospace`
- Sizes: `text-xs` (11px) dense data, `text-sm` (13px) body, `text-base` (15px) section headers
- No large headings

### Color Palette
| Token | Value | Usage |
|-------|-------|-------|
| `bg-primary` | `#0a0a0a` | Main background |
| `bg-surface` | `#111111` | Cards, panels |
| `bg-elevated` | `#1a1a1a` | Hover, active states |
| `border` | `#222222` | Dividers |
| `text-primary` | `#d4d4d4` | Main text |
| `text-muted` | `#666666` | Secondary info |
| `accent` | `#00ff88` | Terminal green, active states |
| `severity-critical` | `#ef4444` | Critical/error |
| `severity-high` | `#f97316` | High/warning |
| `severity-medium` | `#eab308` | Medium |
| `severity-low` | `#22c55e` | Low/healthy |

### Spacing & Borders
- Tight: `gap-1` to `gap-3` between data, `p-3` to `p-4` panel padding
- Borders: 1px solid `#222`, `rounded-sm` (2px) max
- No shadows

### Animations
- Hover: `transition-opacity duration-150`
- Data updates: brief accent-color pulse
- No bouncing, sliding, or scaling

---

## Layout Structure

```
┌──────┬─────────────────────────────────┐
│      │                                 │
│ SIDE │         MAIN CONTENT            │
│ BAR  │                                 │
│      │                                 │
│ 48px │        flex-1                   │
│      │                                 │
│      │                                 │
├──────┴─────────────────────────────────┤
│           STATUS BAR (28px)            │
└────────────────────────────────────────┘
```

### Left Sidebar (48px, collapsed)
- Fixed position, full height minus status bar
- 5 icons stacked vertically: Dashboard, Anomalies, Agent, Sources, Settings
- Unicode/minimal SVG icons
- Active: accent-colored icon + left 2px accent border
- Hover: tooltip label overlay (sidebar doesn't expand)
- Background: `#0a0a0a`, right border `#222`

### Main Content
- Remaining space, `p-4` padding
- Vertical scroll within zone
- Pages own their internal layout

### Status Bar (28px, fixed bottom)
- Full width, monospace `text-xs`
- Left: agent state (dot + label), cycle count, anomaly count
- Center: last tick timestamp, active symbols count
- Right: trading mode badge (`PAPER`/`LIVE`), kill switch status, connection dot

---

## Page Designs

### Dashboard
- Header: "MARKET DATA" label + auto-refresh indicator
- Grid: `grid-cols-3` / `grid-cols-2` / `grid-cols-1` responsive
- Symbol cards: ticker in accent, price + delta (green/red), volume, timestamp
- `bg-surface`, `border`, `p-3`

### Anomaly Feed
- Full-width rows, no wrapping
- Left: severity dot (8px) + timestamp
- Center: symbol tag + description (one line, truncated)
- Right: `[CONFIRM]` `[FALSE+]` `[REVIEW]` buttons (keyboard-shortcut style)
- Reviewed items: verdict text replaces buttons

### Agent Log
- Top: inline status row (state, cycles, anomalies, uptime) with `gap-6`
- Below: terminal-style scrollable log, `text-xs`, newest first
- Lines: timestamp prefix (muted) + activity text, errors in red
- Separators: `border-b border-[#1a1a1a]`

### Source Health
- Table: Source ID, Status, Latency, Failures, Last Seen
- Status: colored text ("HEALTHY" green, "DOWN" red, "DEGRADED" yellow)
- Alternating row backgrounds
- `py-1.5` compact rows

### Settings
- Styled as terminal code editor: monospace, `bg-primary` inset, line numbers optional
- Save button styled as terminal command

---

## Component Architecture

### New Components (minimal set)
1. `AppShell` — three-zone layout (sidebar + content + status bar)
2. `Sidebar` — icon nav with active state
3. `StatusBar` — bottom bar reading from Zustand stores
4. `SeverityDot` — colored severity indicator
5. `DataTable` — minimal table for Source Health

### Implementation Order
1. Install & configure Tailwind + custom theme tokens
2. Build `AppShell` (sidebar, content zone, status bar)
3. Restyle Dashboard
4. Restyle Anomaly Feed
5. Restyle Agent Log
6. Restyle Source Health
7. Restyle Settings
8. Remove inline styles and old `App.css`

### What Stays Unchanged
- Zustand stores
- Tauri hooks
- Tab state pattern (sidebar replaces tabs)
- No new deps beyond Tailwind (Unicode icons, no icon library)

### Testing
- Update existing tests to match new class-based markup
- No new test files unless components split
