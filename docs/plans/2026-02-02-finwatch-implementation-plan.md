# FinWatch Implementation Plan

Multi-agent swarm execution plan for building the FinWatch financial anomaly detection system.

**Source spec:** `~/.claude/plans/wobbly-growing-sedgewick.md`

---

## Decisions

| Decision | Choice |
|----------|--------|
| Dev LLM | Claude Max (flat-rate, unlimited concurrency) |
| Agent coordination | Git worktrees (one branch per agent) |
| Parallelism | Moderate (2-3 agents per phase) |
| Test runners | Vitest (TypeScript) + cargo test (Rust) |
| Initial data sources | Yahoo Finance + CSV only |
| TDD | Mandatory. Test first, verify failure, then implement. |

---

## Phase Overview

```
Phase 0: Foundation          — 1 agent, sequential
Phase 1: Core Infrastructure — 2 agents in parallel
Phase 2: Feature Systems     — 3 agents in parallel
Phase 3: Intelligence        — 2 agents in parallel
Phase 4: Verification        — 1 agent, sequential
```

Each phase is a hard gate. All agents in a phase must complete and merge before the next phase begins.

---

## Interface Contracts (defined in Phase 0, frozen thereafter)

```
shared/types/
├── ipc.ts          — Tauri command + event type definitions
├── data.ts         — DataTick, DataSource, SourceHealth, SourceConfig
├── memory.ts       — MemoryEntry, SearchResult, DomainKnowledge types
├── anomaly.ts      — Anomaly, AnomalyFeedback, Severity
├── agent.ts        — AgentMessage, SessionMeta, CycleState
├── provider.ts     — LLMProvider, ProviderHealth, ModelSlot
├── config.ts       — Full config schema (Zod validated)
└── index.ts        — Barrel export

src-tauri/src/types.rs  — Mirror Rust types (serde-compatible with TS)
```

### IPC Contract

```typescript
// Commands: React -> Rust -> Node.js (pull)
type Commands = {
  'agent:start': () => void;
  'agent:stop': () => void;
  'agent:status': () => AgentStatus;
  'config:get': () => Config;
  'config:update': (patch: Partial<Config>) => Config;
  'anomalies:list': (filter: AnomalyFilter) => Anomaly[];
  'anomalies:feedback': (id: string, feedback: Feedback) => void;
  'memory:search': (query: string) => SearchResult[];
  'sources:health': () => Record<string, SourceHealth>;
};

// Events: Node.js -> Rust -> React (push)
type Events = {
  'agent:activity': AgentActivity;
  'data:tick': DataTick;
  'anomaly:detected': Anomaly;
  'source:health-change': SourceHealth;
  'memory:updated': MemoryEvent;
};
```

Agents implement one side of these contracts. `shared/` is frozen after Phase 0 — if a contract change is needed, it escalates to the orchestrator.

---

## Agent Ownership Map (Conflict Prevention)

No two agents ever touch the same directory.

```
Phase 1:
  Agent rust-backend:   src-tauri/              EXCLUSIVE
  Agent node-agent:     agent/src/core/         EXCLUSIVE
                        agent/src/providers/    EXCLUSIVE
                        agent/src/session/      EXCLUSIVE

Phase 2:
  Agent data-ingestion: agent/src/ingestion/    EXCLUSIVE
  Agent memory-system:  agent/src/memory/       EXCLUSIVE
  Agent react-frontend: src/                    EXCLUSIVE

Phase 3:
  Agent analysis-loop:  agent/src/analysis/     EXCLUSIVE
                        agent/src/subagents/    EXCLUSIVE
  Agent self-improve:   agent/src/improvement/  EXCLUSIVE
```

---

## Phase 0: Foundation

**Agent:** orchestrator (single session)
**Branch:** `main`

### Task List

| ID | Task | TDD Test (write FIRST) | Done When |
|----|------|------------------------|-----------|
| 0.1 | Git init, monorepo scaffold, tooling | `vitest --run` succeeds with 0 tests | `.gitignore`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.json` exist |
| 0.2 | Tauri v2 scaffold (`pnpm create tauri-app`) | `cargo check` passes in `src-tauri/` | Tauri dev window opens blank |
| 0.3 | Shared types package (`shared/`) | Type-level tests: `expectTypeOf<DataTick>()` compiles | All interfaces from IPC contract exported |
| 0.4 | Zod config schema + validation | `config.test.ts`: valid parses, invalid rejects, env vars resolve | `parseConfig()` passes all cases |
| 0.5 | Rust mirror types + serde tests | `cargo test` — JSON round-trip for every IPC type | Rust structs serialize to match TS |
| 0.6 | IPC contract stubs (Rust commands + events) | `cargo test` — each command handler compiles, returns stub | All command signatures registered in Tauri |
| 0.7 | Agent sidecar scaffold (`agent/`) | `vitest run agent/` — entry point imports, exits cleanly | `agent/src/index.ts` exists with JSON-RPC stub |
| 0.8 | CI-local script: `pnpm test:all` | Script runs and reports 0 failures | Runs `vitest` + `cargo test` in one command |

### Verification Gate

```
ALL must pass before Phase 1:
  [ ] pnpm test:all exits 0
  [ ] cargo check --all-targets exits 0
  [ ] shared types import cleanly from agent/ and src/
  [ ] Tauri dev window opens (blank is fine)
  [ ] git tag v0.0.1-foundation
```

---

## Phase 1: Core Infrastructure

### Agent A: rust-backend

**Worktree:** `../finwatch-rust-backend`
**Branch:** `feat/rust-backend`
**Owns:** `src-tauri/`

#### Task List

| ID | Task | TDD Test (write FIRST) | Done When |
|----|------|------------------------|-----------|
| 1A.1 | SQLite connection pool (r2d2 + rusqlite) | `cargo test` — open pool, create table, insert, query | Pool created on app startup |
| 1A.2 | Database migrations system | Test: run migrations on empty DB, verify schema | `migrations/` dir with initial schema |
| 1A.3 | IPC command handlers (config CRUD) | Test: invoke `config:get`, `config:update` via Tauri test utils | Config read/written to SQLite |
| 1A.4 | IPC command handlers (anomaly, memory, sources) | Test: each command returns typed response | All command stubs return real data shapes |
| 1A.5 | Event emission system (Rust -> frontend) | Test: emit event, verify payload shape | `emit_event()` helper with typed payloads |
| 1A.6 | Node.js sidecar process supervisor | Test: spawn/kill sidecar, capture stdout JSON-RPC | Sidecar starts on app launch, restarts on crash |
| 1A.7 | JSON-RPC bridge (Rust <-> Node.js stdio) | Test: send request from Rust, get response from Node mock | Bidirectional message passing works |
| 1A.8 | File system watcher for `~/.finwatch/` | Test: create file in watched dir, receive event | Config hot-reload triggers on file change |

#### Verification

```
  [ ] cargo test --all passes
  [ ] Tauri app starts, sidecar spawns, JSON-RPC handshake completes
  [ ] All IPC commands callable from JS (integration test)
  [ ] SQLite DB created at ~/.finwatch/state/
```

### Agent B: node-agent

**Worktree:** `../finwatch-node-agent`
**Branch:** `feat/node-agent`
**Owns:** `agent/src/core/`, `agent/src/providers/`, `agent/src/session/`

#### Task List

| ID | Task | TDD Test (write FIRST) | Done When |
|----|------|------------------------|-----------|
| 1B.1 | JSON-RPC server (stdio) | Test: send JSON-RPC request to stdin, parse response from stdout | Agent responds to `ping` method |
| 1B.2 | LLM Provider interface + registry | Test: register mock provider, resolve by id, health check | `ProviderRegistry` class with `get()`, `list()`, `health()` |
| 1B.3 | Anthropic provider adapter | Test: mock API, send message, stream response events | `AnthropicProvider` implements `LLMProvider` |
| 1B.4 | OpenRouter provider adapter | Test: mock API, verify auth header, stream parsing | `OpenRouterProvider` implements `LLMProvider` |
| 1B.5 | Provider fallback chain | Test: primary fails -> secondary called -> tertiary called | `withFallback()` wrapper retries down chain |
| 1B.6 | Session manager (JSONL read/write) | Test: create session, append messages, read back, rotate | `SessionManager` with `create()`, `append()`, `read()`, `rotate()` |
| 1B.7 | Session compaction | Test: session at 80% tokens -> compaction -> 50% remaining | `compact()` summarizes oldest 40% |
| 1B.8 | Tool executor framework | Test: register tool, invoke by name, validate args with Zod | `ToolRegistry` with typed tool definitions |

#### Verification

```
  [ ] vitest run agent/ — all pass
  [ ] Agent process starts, JSON-RPC handshake with mock host
  [ ] LLM provider streams response (mock or real)
  [ ] Session JSONL files created/read/compacted correctly
```

### Phase 1 Merge Gate

```
  [ ] Both branches green (all tests pass independently)
  [ ] Merge feat/rust-backend -> main (no conflicts — different directories)
  [ ] Merge feat/node-agent -> main
  [ ] Integration test: Tauri starts -> spawns sidecar -> JSON-RPC handshake -> ping/pong
  [ ] git tag v0.1.0-core
```

---

## Phase 2: Feature Systems

### Agent A: data-ingestion

**Worktree:** `../finwatch-data-ingestion`
**Branch:** `feat/data-ingestion`
**Owns:** `agent/src/ingestion/`

#### Task List

| ID | Task | TDD Test (write FIRST) | Done When |
|----|------|------------------------|-----------|
| 2A.1 | `DataSource` interface + source registry | Test: register source, start/stop lifecycle, health check | `SourceRegistry` class |
| 2A.2 | Yahoo Finance adapter | Test: mock HTTP, parse response to `DataTick[]`, error handling | Fetches OHLCV for configured symbols |
| 2A.3 | CSV file adapter | Test: write CSV to watched dir, verify `DataTick[]` output, incremental read | Watches dir, parses new/modified CSVs |
| 2A.4 | DataTick normalization layer | Test: raw Yahoo response -> normalized tick, raw CSV row -> normalized tick | All sources output identical `DataTick` shape |
| 2A.5 | Event stream + buffer | Test: push ticks -> buffer accumulates -> flush on interval or urgent flag | `DataBuffer` with `push()`, `nextBatch()` |
| 2A.6 | Source health monitor | Test: healthy source -> ok, 4 failures -> degraded, 11 -> offline + event | 5-min health check cycle runs |
| 2A.7 | Polling scheduler | Test: configure 5m interval, verify fetch at intervals, backoff on error | Configurable per-source poll intervals |
| 2A.8 | Custom source loader | Test: drop `.ts` file in `~/.finwatch/sources/custom/`, verify auto-loaded | Dynamic import of user-defined sources |

#### Verification

```
  [ ] vitest run agent/src/ingestion/ — all pass
  [ ] Yahoo adapter fetches real data (integration test, skippable in CI)
  [ ] CSV adapter processes sample file correctly
  [ ] Buffer flushes on interval and on urgent flag
```

### Agent B: memory-system

**Worktree:** `../finwatch-memory-system`
**Branch:** `feat/memory-system`
**Owns:** `agent/src/memory/`

#### Task List

| ID | Task | TDD Test (write FIRST) | Done When |
|----|------|------------------------|-----------|
| 2B.1 | SQLite setup with sqlite-vec + FTS5 | Test: create DB, enable extensions, verify both work | `memory.sqlite` initializes with both extensions |
| 2B.2 | Embedding integration (OpenAI text-embedding-3-small) | Test: mock API, embed text, verify vector dimensions | `embed()` returns float array |
| 2B.3 | Vector search (cosine via sqlite-vec) | Test: insert 10 entries, query, verify top-K by similarity | `vectorSearch()` returns ranked results |
| 2B.4 | Keyword search (FTS5 BM25) | Test: insert entries, full-text query, verify relevance | `keywordSearch()` returns ranked results |
| 2B.5 | Hybrid search merge | Test: combine vector + keyword at 0.7/0.3, filter >= 0.35, limit 6 | `hybridSearch()` returns merged results |
| 2B.6 | Semantic memory store (Markdown files) | Test: flush to `memory/YYYY-MM-DD-HH.md`, read back, search | Memory files created and indexed |
| 2B.7 | Domain knowledge tables | Test: CRUD for patterns, correlations, thresholds, seasonal | `domain_knowledge.sqlite` with all 4 tables |
| 2B.8 | Auto-recall hook | Test: given context, search memory + domain, format as `<relevant-context>` | Context block injected before analysis turn |
| 2B.9 | Auto-capture hook | Test: given response, extract facts, dedup cosine > 0.90, max 5 | Knowledge entries created after analysis turn |

#### Verification

```
  [ ] vitest run agent/src/memory/ — all pass
  [ ] Hybrid search returns relevant results for financial queries
  [ ] Auto-recall injects context, auto-capture stores knowledge
  [ ] Deduplication prevents near-duplicate entries
```

### Agent C: react-frontend

**Worktree:** `../finwatch-react-frontend`
**Branch:** `feat/react-frontend`
**Owns:** `src/`

#### Task List

| ID | Task | TDD Test (write FIRST) | Done When |
|----|------|------------------------|-----------|
| 2C.1 | Zustand store: `dataSlice` | Test: push ticks, subscribe, verify state updates | Real-time data state management |
| 2C.2 | Zustand store: `anomalySlice` | Test: add anomaly, submit feedback, filter by severity | Anomaly list + feedback state |
| 2C.3 | Zustand store: `agentSlice` | Test: status transitions, activity log append | Agent status + activity tracking |
| 2C.4 | `useTauriEvent` hook | Test: mock Tauri event, verify hook callback fires | Generic typed event subscription |
| 2C.5 | `useTauriCommand` hook | Test: mock invoke, verify loading/error/data states | Generic typed command invocation |
| 2C.6 | Dashboard page (data charts) | Test: render with mock data, verify chart elements | Live-updating price/volume charts |
| 2C.7 | Anomaly feed page | Test: render list, click feedback, verify state | Scrollable anomaly cards with feedback |
| 2C.8 | Agent activity log page | Test: render log entries, verify auto-scroll | Streaming agent activity display |
| 2C.9 | Source health panel | Test: render statuses, verify color coding | Green/yellow/red health indicators |
| 2C.10 | Settings page (config panel) | Test: render form, edit, save via command | Config CRUD through UI |

#### Verification

```
  [ ] vitest run src/ — all pass (component + hook tests)
  [ ] All pages render without errors (mock data)
  [ ] Tauri hooks subscribe/invoke correctly (mocked)
  [ ] Zustand stores update reactively
```

### Phase 2 Merge Gate

```
  [ ] All 3 branches green independently
  [ ] Merge feat/data-ingestion -> main
  [ ] Merge feat/memory-system -> main
  [ ] Merge feat/react-frontend -> main
  [ ] Integration: source -> buffer -> ticks visible in dashboard (mock agent)
  [ ] Integration: memory search callable from frontend
  [ ] git tag v0.2.0-features
```

---

## Phase 3: Intelligence & Integration

### Agent A: analysis-loop

**Worktree:** `../finwatch-analysis-loop`
**Branch:** `feat/analysis-loop`
**Owns:** `agent/src/analysis/`, `agent/src/subagents/`

#### Task List

| ID | Task | TDD Test (write FIRST) | Done When |
|----|------|------------------------|-----------|
| 3A.1 | Pre-screen: z-score calculator | Test: known data -> verify z-scores, threshold classification | Ticks scored 0-1, routed correctly |
| 3A.2 | Pre-screen: moving average deviation | Test: trending data -> verify deviation detection | MA crossover signals detected |
| 3A.3 | Pre-screen: rule engine | Test: load rules JSON, evaluate tick against rules | Domain rules applied to incoming data |
| 3A.4 | Context assembly | Test: given state, build prompt within token budget | System + memories + data + anomalies assembled |
| 3A.5 | Analysis turn orchestration | Test: mock LLM, feed batch, verify anomaly extraction | Full turn: data in -> analysis out -> anomalies flagged |
| 3A.6 | Monitor loop (continuous cycle) | Test: start loop, feed 3 batches, verify 3 turns, stop | Loop runs, processes batches, handles shutdown |
| 3A.7 | Subagent spawner | Test: spawn subagent, mock LLM, collect result, inject | Child sessions created, results merged |
| 3A.8 | Subagent concurrency limiter | Test: spawn 5, verify only 3 run, 2 queued | Max 3 concurrent (configurable) |
| 3A.9 | Agent tools (all 7 from spec) | Test: each tool validates args, correct side effects | flag_anomaly, dismiss_signal, search_memory, etc. |

#### Verification

```
  [ ] vitest run agent/src/analysis/ — all pass
  [ ] Pre-screen correctly routes synthetic anomalies
  [ ] Full analysis turn produces anomaly flags from mock data
  [ ] Monitor loop starts, runs 3 cycles, stops cleanly
  [ ] Subagents spawn, execute, return results
```

### Agent B: self-improve

**Worktree:** `../finwatch-self-improve`
**Branch:** `feat/self-improve`
**Owns:** `agent/src/improvement/`

#### Task List

| ID | Task | TDD Test (write FIRST) | Done When |
|----|------|------------------------|-----------|
| 3B.1 | Feedback store (SQLite table) | Test: insert feedback, query unprocessed, mark processed | `feedback_log` table in domain_knowledge.sqlite |
| 3B.2 | Feedback batch trigger | Test: 10 feedbacks triggers, 2hr timeout triggers | Batch fires on count or time threshold |
| 3B.3 | Feedback integration turn | Test: mock LLM, feed batch, verify adjustments | LLM analyzes feedback, updates domain knowledge |
| 3B.4 | Knowledge accumulation (patterns) | Test: extract patterns after analysis, verify storage + dedup | Patterns written with confidence scores |
| 3B.5 | Knowledge accumulation (correlations, thresholds, seasonal) | Test: cross-source correlation stored | All 4 domain knowledge tables populated |
| 3B.6 | Weekly consolidation pass | Test: mock LLM, verify merge/dedup/prune | `KNOWLEDGE.md` rewritten |
| 3B.7 | Rule evolution (daily) | Test: feed metrics + rules, verify versioned output | `rules_v{NNN}.json` created |
| 3B.8 | Auto-revert safety | Test: FP rate >50% -> revert to previous version | Revert triggered, notification emitted |

#### Verification

```
  [ ] vitest run agent/src/improvement/ — all pass
  [ ] Feedback integration adjusts thresholds measurably
  [ ] Rule evolution creates versioned snapshots
  [ ] Auto-revert fires when FP rate degrades
```

### Phase 3 Merge Gate

```
  [ ] Both branches green independently
  [ ] Merge feat/analysis-loop -> main
  [ ] Merge feat/self-improve -> main
  [ ] Integration: source -> buffer -> pre-screen -> analysis -> anomaly -> UI
  [ ] Integration: feedback -> store -> batch -> rules updated
  [ ] git tag v0.3.0-intelligence
```

---

## Phase 4: End-to-End Verification

**Agent:** orchestrator (single session)
**Branch:** `main`

### Verification Matrix (from original spec)

| ID | Verification | Test | Pass Criteria |
|----|-------------|------|---------------|
| V1 | Data ingestion | Configure Yahoo source, run 5 polls | `DataTick[]` normalized, buffered, visible in dashboard |
| V2 | Pre-screen | Feed synthetic data with 3 known anomalies | All 3 scored >0.6, routed to immediate analysis |
| V3 | Analysis turn | Run analysis on batch with anomaly | Anomaly flagged, transcript persisted to JSONL |
| V4 | Memory | Search for stored pattern | Hybrid search returns relevant result, auto-recall injects it |
| V5 | Compaction | Fill session to 80% context | Flush + compaction runs, findings preserved |
| V6 | Feedback loop | Submit 10 thumbs down on false positives | Threshold adjusted upward for that pattern |
| V7 | Rule evolution | Trigger daily evolution | New `rules_v002.json` created, changes logged |
| V8 | Subagents | Trigger volume analysis subagent | Child session created, result injected into parent |
| V9 | Provider fallback | Disable primary provider | Fallback to secondary, analysis continues |
| V10 | Full UI flow | Source -> agent -> Tauri event -> React | Real-time data visible, anomaly appears in feed |

### System-Level Tests

```
  [ ] App cold start -> agent running -> data flowing in under 10 seconds
  [ ] Sidecar crash -> auto-restart -> session recovery
  [ ] Config change via UI -> hot-reload -> no restart needed
  [ ] 1 hour continuous run with no memory leaks (RSS stable)
```

### Final Gate

```
  [ ] All 10 verifications pass
  [ ] pnpm test:all exits 0 (full suite)
  [ ] cargo test --all exits 0
  [ ] App runs stable for 10 minutes
  [ ] git tag v1.0.0-rc1
```

---

## Agent Orchestration Protocol

### Worktree Setup

```bash
# Phase 0: init repo
cd /Users/jdsingh/Projects/AI/finwatch
git init && git add -A && git commit -m "Phase 0: foundation"

# Phase 1: create worktrees
git worktree add ../finwatch-rust-backend feat/rust-backend
git worktree add ../finwatch-node-agent feat/node-agent

# Phase 2: create worktrees
git worktree add ../finwatch-data-ingestion feat/data-ingestion
git worktree add ../finwatch-memory-system feat/memory-system
git worktree add ../finwatch-react-frontend feat/react-frontend

# Phase 3: create worktrees
git worktree add ../finwatch-analysis-loop feat/analysis-loop
git worktree add ../finwatch-self-improve feat/self-improve
```

### Agent Entry Contract

Each agent receives:
1. **Branch name** and **worktree path**
2. **Task table** from this plan as its todo list
3. **Interface contracts** (shared types) — read-only reference
4. **TDD mandate**: write test FIRST, verify it fails, then implement
5. **Boundary rule**: only modify files in your designated directories

### Agent Exit Contract

Before signaling completion, each agent must:
1. All tests pass (`vitest run <scope>` or `cargo test`)
2. No lint errors (`pnpm lint` or `cargo clippy`)
3. No type errors (`tsc --noEmit` or `cargo check`)
4. All work committed to feature branch
5. Write `COMPLETION.md` in worktree root summarizing what was built

### Merge Protocol

```
1. Agent signals completion
2. Orchestrator verifies:
   - Tests pass in isolation (agent's worktree)
   - No files outside ownership boundary were modified
3. Merge to main: git merge --no-ff feat/<branch>
4. Run pnpm test:all on main after merge
5. If main breaks: revert merge, agent fixes, re-merge
6. Remove worktree: git worktree remove ../finwatch-<name>
```

### Escalation Rules

- **Contract change needed**: Agent stops, notifies orchestrator. Orchestrator updates `shared/`, commits to main, agents pull.
- **Cross-boundary dependency**: Agent writes a stub/mock, continues. Integration tested at merge gate.
- **Blocked on another agent**: Never happens if Phase 0 contracts are solid. If it does, orchestrator mediates.

---

## Progress Tracking

### Per-Agent Progress File

Each agent maintains `PROGRESS.md` in its worktree root:

```markdown
# Agent: <name>
## Status: in-progress | blocked | complete

### Completed
- [x] 1A.1 SQLite connection pool
- [x] 1A.2 Database migrations

### In Progress
- [ ] 1A.3 IPC command handlers (config)

### Blocked
(none)

### Notes
- Discovered rusqlite bundled feature needed for SQLite extensions
```

### Orchestrator Dashboard

Track overall progress by phase:

```
Phase 0: [########] 8/8   COMPLETE  v0.0.1-foundation
Phase 1: [####----] 8/16  IN PROGRESS
  rust-backend:  [####----] 4/8
  node-agent:    [####----] 4/8
Phase 2: [--------] 0/27  WAITING
Phase 3: [--------] 0/17  WAITING
Phase 4: [--------] 0/14  WAITING
```

---

## Test Count Targets

| Phase | Unit Tests | Integration Tests | Total |
|-------|-----------|-------------------|-------|
| 0 | 12 | 2 | 14 |
| 1 | 30 | 6 | 36 |
| 2 | 45 | 8 | 53 |
| 3 | 35 | 6 | 41 |
| 4 | 0 | 14 | 14 |
| **Total** | **122** | **36** | **158** |

---

## Key Dependencies & Risk Mitigations

| Risk | Mitigation |
|------|------------|
| sqlite-vec extension not available on all platforms | Bundle via `rusqlite` bundled feature; test in Phase 0 |
| Yahoo Finance API changes/rate limits | Mock-first TDD; integration tests skippable; CSV as fallback |
| Tauri v2 sidecar communication flaky | JSON-RPC over stdio is simple and battle-tested; add heartbeat |
| LLM provider outages during dev | Mock providers for all tests; real providers only in integration |
| Worktree merge conflicts | Strict ownership boundaries; `shared/` frozen after Phase 0 |
| Context window limits during analysis | Token counting in tests; compaction tested with synthetic overflows |
