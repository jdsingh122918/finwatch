# FinWatch

AI-powered financial anomaly detection desktop app. A multi-agent swarm system that monitors financial data sources, detects anomalies through LLM analysis, and self-improves via feedback loops.

Built with React, Rust (Tauri v2), and a Node.js agent sidecar.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 9
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
- [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS (system dependencies vary by platform)

## Setup

Clone the repo and install dependencies:

```bash
git clone <repo-url>
cd finwatch
pnpm install
```

## Running Locally

Start the full Tauri desktop app in development mode:

```bash
pnpm tauri dev
```

This runs Vite (frontend dev server on `localhost:1420`) and the Tauri Rust backend together with hot reload.

To run only the frontend (no Tauri shell):

```bash
pnpm dev
```

## Testing

```bash
pnpm test          # TypeScript tests (vitest)
pnpm test:rust     # Rust tests (cargo test)
pnpm test:all      # Both
pnpm test:watch    # Interactive mode (re-runs on change)
```

## Building

```bash
pnpm tauri build
```

Produces a native desktop binary in `src-tauri/target/release/`.

## Type Checking

```bash
pnpm lint
```

Runs `tsc --noEmit` across the project.

## Project Structure

```
src/            React frontend (pages, hooks, Zustand store)
src-tauri/      Rust backend (Tauri, SQLite, IPC bridge)
agent/          Node.js agent sidecar (LLM providers, analysis, memory)
shared/         Shared TypeScript types (Zod-validated contracts)
docs/plans/     Implementation plans
```

## Architecture

```
┌──────────────┐    Tauri Commands/Events    ┌──────────────┐
│    React     │ ◄─────────────────────────► │  Rust/Tauri  │
│   Frontend   │                             │   Backend    │
└──────────────┘                             └──────┬───────┘
                                                    │ JSON-RPC
                                                    │ (stdio)
                                             ┌──────┴───────┐
                                             │   Node.js    │
                                             │    Agent     │
                                             └──────────────┘
```

- **React** renders the dashboard UI inside a Tauri window
- **Rust** manages SQLite storage, spawns the agent as a sidecar process, and bridges IPC
- **Node.js agent** handles LLM calls, data ingestion, anomaly analysis, and memory

## License

Private — not yet licensed for distribution.
