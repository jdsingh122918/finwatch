# FinWatch

AI-powered financial anomaly detection desktop app. Multi-agent swarm system that monitors financial data, detects anomalies via LLM analysis, and self-improves through feedback loops.

## Stack

- **Frontend:** React 19 + Zustand + Tailwind CSS v4 + Vite 7 (Tauri window)
- **Backend:** Rust / Tauri v2 + SQLite (rusqlite)
- **Agent:** Node.js sidecar, JSON-RPC over stdio
- **Shared types:** `shared/` package (Zod-validated, frozen after Phase 0)
- **Package manager:** pnpm (monorepo workspaces: `shared/`, `agent/`)

## Project Structure

```
src/               → React frontend
  components/      → Shared UI (Sidebar, StatusBar)
  pages/           → Route-level views (Dashboard, AnomalyFeed, AgentLog, SourceHealth, Settings)
  hooks/           → Custom hooks (useTauriCommand, useTauriEvent)
  store/           → Zustand slices (data, anomaly, agent, trading)
src-tauri/         → Rust backend (SQLite, IPC bridge, process supervisor)
agent/             → Node.js agent (LLM providers, ingestion, memory, analysis)
shared/            → Shared TypeScript types (frozen interface contracts)
docs/plans/        → Phase-by-phase implementation plans
```

## Commands

```bash
pnpm dev             # Vite + Tauri dev server
pnpm build           # TypeScript check + Vite build
pnpm test            # Run all TS tests (vitest)
pnpm test:rust       # Run Rust tests (cargo test)
pnpm test:all        # Both TS + Rust tests
pnpm test:watch      # Interactive test runner
pnpm lint            # Type check (tsc --noEmit)
```

## Development Rules

- **TDD is mandatory.** Write the test first, verify it fails, then implement.
- **Shared types are frozen.** Do not modify `shared/src/` without escalation — all agents depend on these contracts.
- **Agent communication:** React ↔ Rust via Tauri commands/events. Rust ↔ Node.js via JSON-RPC over stdio.
- **File naming:** `kebab-case.ts`, tests as `*.test.ts` co-located or in `__tests__/`.
- **State management:** Zustand slice pattern — one slice per domain (data, anomaly, agent, trading).
- **No dead code.** `noUnusedLocals` and `noUnusedParameters` are enforced by tsconfig.

## UI & Styling

- **Terminal aesthetic** — dark bg, monospace type, green accent (`#00ff88`). Theme tokens in `src/index.css` (`@theme` block).
- **Tailwind v4 only.** No CSS files. Use semantic tokens: `bg-primary`, `text-muted`, `accent`, `severity-*`, `state-*`.
- **Layout:** App shell = Sidebar (left nav) + main content + StatusBar (bottom), defined in `App.tsx`.

## Architecture Notes

- The Node.js agent runs as a Tauri sidecar process, not in-browser.
- IPC contract is defined in `shared/src/ipc.ts` — commands (pull) and events (push).
- LLM providers use an adapter pattern (`agent/src/providers/`). Currently: Anthropic, OpenRouter, with fallback chain.
- Trading integration via Alpaca Markets API — streaming, order execution, risk management. State in `trading-slice.ts`.
- Integration tests are phase-tagged in `__tests__/integration/`.

## Plans

Detailed implementation plans live in `docs/plans/`. Start with `2026-02-02-finwatch-implementation-plan.md` for the master plan and phase overview.
