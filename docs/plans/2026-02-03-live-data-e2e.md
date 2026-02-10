# Live Data End-to-End Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire up the full pipeline — Alpaca Markets streaming data → pre-screener → LLM analysis (Anthropic + OpenRouter fallback) → anomaly display in UI — through the Tauri sidecar IPC bridge.

**Architecture:** The Node.js agent gets a new `Orchestrator` class that wires SourceRegistry → DataBuffer → MonitorLoop. Rust's `agent_start` command spawns the Node.js sidecar, sends config via JSON-RPC, and forwards events back to React via Tauri events. React listens for events and updates Zustand stores. Settings page gets real credential/config forms.

**Tech Stack:** Tauri v2 (Rust), Node.js sidecar (JSON-RPC stdio), React 19, Zustand, Tailwind CSS v4, Alpaca Markets API, Anthropic SDK, OpenRouter API.

**Prerequisites:**
- Alpaca paper trading account (API key + secret)
- Anthropic API key (`ANTHROPIC_API_KEY`)
- OpenRouter API key (`OPENROUTER_API_KEY`)

---

## Task 1: Agent Orchestrator — Wire the Pipeline

The agent has all individual pieces (SourceRegistry, DataBuffer, MonitorLoop, Providers) but no orchestration layer connecting them. Create `Orchestrator` that accepts config and wires everything together.

**Files:**
- Create: `agent/src/orchestrator.ts`
- Create: `agent/src/__tests__/orchestrator.test.ts`
- Modify: `agent/src/index.ts` (register JSON-RPC commands)

**Step 1: Write the failing test**

```typescript
// agent/src/__tests__/orchestrator.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Orchestrator } from "../orchestrator.js";

function mockProvider() {
  return {
    id: "mock",
    name: "Mock",
    createMessage: vi.fn(async function* () {
      yield { type: "text" as const, text: "No anomalies found." };
      yield { type: "message_stop" as const };
    }),
    healthCheck: vi.fn(async () => ({
      providerId: "mock",
      status: "healthy" as const,
      latencyMs: 10,
    })),
    listModels: vi.fn(() => ["mock-model"]),
  };
}

describe("Orchestrator", () => {
  it("creates and starts with valid config", async () => {
    const orch = new Orchestrator({
      alpaca: { keyId: "TEST", secretKey: "SECRET", symbols: ["AAPL"], feed: "iex" },
      llm: { providers: [mockProvider()], model: "mock-model", maxTokens: 4096, temperature: 0.3 },
      buffer: { flushIntervalMs: 5000, urgentThreshold: 0.8 },
    });

    expect(orch.status.state).toBe("idle");
  });

  it("emits tick events when sources produce data", () => {
    const orch = new Orchestrator({
      alpaca: { keyId: "TEST", secretKey: "SECRET", symbols: ["AAPL"], feed: "iex" },
      llm: { providers: [mockProvider()], model: "mock-model", maxTokens: 4096, temperature: 0.3 },
      buffer: { flushIntervalMs: 5000, urgentThreshold: 0.8 },
    });

    const ticks: unknown[] = [];
    orch.on("tick", (t) => ticks.push(t));

    // Orchestrator should expose pushTick for testing / manual injection
    orch.injectTick({
      sourceId: "test",
      timestamp: Date.now(),
      metrics: { close: 150 },
      metadata: {},
    });

    expect(ticks).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- agent/src/__tests__/orchestrator.test.ts`
Expected: FAIL — `Orchestrator` not found

**Step 3: Write the Orchestrator**

```typescript
// agent/src/orchestrator.ts
import { EventEmitter } from "node:events";
import type { DataTick, Anomaly, AgentActivity, AgentStatus, LLMProvider } from "@finwatch/shared";
import { DataBuffer } from "./ingestion/data-buffer.js";
import { SourceRegistry } from "./ingestion/source-registry.js";
import { MonitorLoop } from "./analysis/monitor-loop.js";
import { withFallback } from "./providers/fallback.js";

export type OrchestratorConfig = {
  alpaca: {
    keyId: string;
    secretKey: string;
    symbols: string[];
    feed: "iex" | "sip";
  };
  llm: {
    providers: LLMProvider[];
    model: string;
    maxTokens: number;
    temperature: number;
  };
  buffer: {
    flushIntervalMs: number;
    urgentThreshold: number;
  };
};

export class Orchestrator extends EventEmitter {
  private readonly registry: SourceRegistry;
  private readonly buffer: DataBuffer;
  private readonly monitor: MonitorLoop;
  private running = false;

  constructor(config: OrchestratorConfig) {
    super();
    this.registry = new SourceRegistry();
    this.buffer = new DataBuffer({
      flushIntervalMs: config.buffer.flushIntervalMs,
      urgentThreshold: config.buffer.urgentThreshold,
    });

    const provider = config.llm.providers.length > 1
      ? withFallback(config.llm.providers)
      : config.llm.providers[0]!;

    this.monitor = new MonitorLoop(this.buffer, {
      provider,
      model: config.llm.model,
      maxTokens: config.llm.maxTokens,
      temperature: config.llm.temperature,
      preScreenConfig: { zScoreThreshold: 3.0, urgentThreshold: 0.6, skipThreshold: 0.2 },
      patterns: [],
      thresholds: [],
    });

    this.monitor.onActivity = (a: AgentActivity) => this.emit("activity", a);
    this.monitor.onAnomaly = (a: Anomaly) => this.emit("anomaly", a);
  }

  get status(): AgentStatus {
    return this.monitor.status;
  }

  /** Inject a tick directly (for testing or manual sources). */
  injectTick(tick: DataTick): void {
    this.buffer.push(tick);
    this.emit("tick", tick);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.registry.startAll();
    this.monitor.start();
    this.emit("activity", { type: "cycle_start", message: "Orchestrator started", timestamp: Date.now() });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.monitor.stop();
    await this.registry.stopAll();
    this.buffer.destroy();
  }

  /** Expose registry for adding sources externally. */
  get sources(): SourceRegistry {
    return this.registry;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm test -- agent/src/__tests__/orchestrator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add agent/src/orchestrator.ts agent/src/__tests__/orchestrator.test.ts
git commit -m "feat(agent): add Orchestrator to wire ingestion → analysis pipeline"
```

---

## Task 2: Register JSON-RPC Commands in Agent

Wire `agent:start`, `agent:stop`, and `agent:status` JSON-RPC commands so Rust can control the agent lifecycle.

**Files:**
- Modify: `agent/src/index.ts`
- Create: `agent/src/__tests__/index-commands.test.ts`

**Step 1: Write the failing test**

```typescript
// agent/src/__tests__/index-commands.test.ts
import { describe, it, expect, vi } from "vitest";
import { JsonRpcServer } from "../ipc/json-rpc-server.js";

describe("agent JSON-RPC commands", () => {
  it("responds to agent:start with config", async () => {
    // We test by importing the server setup function
    const { createAgentServer } = await import("../index.js");
    const server = createAgentServer();

    const response = await server.handleRequest(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "agent:start",
      params: {
        alpaca: { keyId: "TEST", secretKey: "SECRET", symbols: ["AAPL"], feed: "iex" },
        llm: {
          anthropicApiKey: "sk-ant-test",
          openrouterApiKey: "sk-or-test",
          model: "claude-haiku-35-20241022",
          maxTokens: 4096,
          temperature: 0.3,
        },
      },
    }));

    const parsed = JSON.parse(response);
    expect(parsed.result.status).toBe("started");
  });

  it("responds to agent:status", async () => {
    const { createAgentServer } = await import("../index.js");
    const server = createAgentServer();

    const response = await server.handleRequest(JSON.stringify({
      jsonrpc: "2.0", id: 2, method: "agent:status",
    }));

    const parsed = JSON.parse(response);
    expect(parsed.result.state).toBeDefined();
  });

  it("responds to agent:stop", async () => {
    const { createAgentServer } = await import("../index.js");
    const server = createAgentServer();

    const response = await server.handleRequest(JSON.stringify({
      jsonrpc: "2.0", id: 3, method: "agent:stop",
    }));

    const parsed = JSON.parse(response);
    expect(parsed.result.status).toBe("stopped");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- agent/src/__tests__/index-commands.test.ts`
Expected: FAIL — `createAgentServer` not exported

**Step 3: Update `agent/src/index.ts`**

Refactor to export a `createAgentServer()` factory that registers all commands, and keep the stdio wiring in the `start()` function.

Key changes to `agent/src/index.ts`:
- Export `createAgentServer()` that creates a `JsonRpcServer` and registers `agent:start`, `agent:stop`, `agent:status`, `ping`
- `agent:start` params: `{ alpaca, llm }` → creates `Orchestrator`, calls `orch.start()`, hooks events to emit JSON-RPC notifications via stdout
- `agent:stop` → calls `orch.stop()`
- `agent:status` → returns `orch.status`
- Notifications: When orchestrator emits `"tick"`, `"anomaly"`, `"activity"`, write JSON-RPC notification (no `id`, just method + params) to stdout

**Step 4: Run test to verify it passes**

Run: `pnpm test -- agent/src/__tests__/index-commands.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add agent/src/index.ts agent/src/__tests__/index-commands.test.ts
git commit -m "feat(agent): register agent:start/stop/status JSON-RPC commands"
```

---

## Task 3: Rust Sidecar Bridge — Spawn & Communicate

Replace the stubbed `agent_start`/`agent_stop`/`agent_status` Tauri commands with real sidecar spawning. Rust spawns the Node.js agent as a child process, sends JSON-RPC via stdin, reads responses + notifications from stdout, and emits Tauri events.

**Files:**
- Create: `src-tauri/src/bridge.rs` (sidecar process manager)
- Modify: `src-tauri/src/commands/agent.rs` (use bridge)
- Modify: `src-tauri/src/lib.rs` (manage bridge state)

**Step 1: Write the failing test**

```rust
// In src-tauri/src/bridge.rs
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_starts_in_idle_state() {
        let bridge = SidecarBridge::new();
        assert!(!bridge.is_running());
    }
}
```

**Step 2: Run test to verify it fails**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -- bridge`
Expected: FAIL — module not found

**Step 3: Implement `SidecarBridge`**

`src-tauri/src/bridge.rs` should:
- Use `tauri_plugin_shell` to spawn the Node.js agent as a sidecar (`node agent/src/index.ts` or bundled binary)
- Hold a `Child` process handle
- Provide `send_request(method, params) -> Result<JsonRpcResponse>`
- Spawn a reader thread that reads stdout line-by-line:
  - Lines with `id` field → route to pending request futures
  - Lines without `id` (notifications) → emit as Tauri events using `events::emit_event`
- Notification routing: `"data:tick"` → `event_names::DATA_TICK`, `"anomaly:detected"` → `event_names::ANOMALY_DETECTED`, etc.

Update `commands/agent.rs`:
- `agent_start` → gets config from SQLite + credentials, calls `bridge.send_request("agent:start", config)`
- `agent_stop` → calls `bridge.send_request("agent:stop", {})`
- `agent_status` → calls `bridge.send_request("agent:status", {})`, returns parsed response

Update `lib.rs`:
- Add `SidecarBridge` to Tauri managed state alongside `DbPool`
- Pass `AppHandle` to bridge for event emission

**Step 4: Run test to verify it passes**

Run: `cargo test --manifest-path src-tauri/Cargo.toml -- bridge`
Expected: PASS

**Step 5: Commit**

```bash
git add src-tauri/src/bridge.rs src-tauri/src/commands/agent.rs src-tauri/src/lib.rs
git commit -m "feat(tauri): implement SidecarBridge for agent process management"
```

---

## Task 4: Settings Page — Credential & Config Forms

Replace the raw JSON textarea with proper form fields for Alpaca credentials, LLM API keys, symbol selection, and agent controls.

**Files:**
- Modify: `src/pages/Settings.tsx`
- Modify: `src/pages/__tests__/Settings.test.tsx`
- Modify: `src/App.tsx` (wire Settings to Tauri commands)

**Step 1: Write the failing test**

```typescript
// src/pages/__tests__/Settings.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Settings } from "../Settings";

describe("Settings", () => {
  it("renders Alpaca credential fields", () => {
    render(<Settings config={{}} onSave={vi.fn()} onCredentialsSave={vi.fn()} />);
    expect(screen.getByLabelText(/api key/i)).toBeDefined();
    expect(screen.getByLabelText(/api secret/i)).toBeDefined();
  });

  it("renders LLM provider fields", () => {
    render(<Settings config={{}} onSave={vi.fn()} onCredentialsSave={vi.fn()} />);
    expect(screen.getByLabelText(/anthropic/i)).toBeDefined();
    expect(screen.getByLabelText(/openrouter/i)).toBeDefined();
  });

  it("renders symbol input", () => {
    render(<Settings config={{}} onSave={vi.fn()} onCredentialsSave={vi.fn()} />);
    expect(screen.getByLabelText(/symbols/i)).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- src/pages/__tests__/Settings.test.tsx`
Expected: FAIL — current Settings doesn't have these fields

**Step 3: Rebuild Settings page**

Replace the JSON textarea with sections:
- **Alpaca Credentials:** `API Key` input, `API Secret` password input, `Save Credentials` button (calls `credentials_set` Tauri command)
- **LLM Providers:** `Anthropic API Key` input, `OpenRouter API Key` input
- **Symbols:** Comma-separated text input (e.g., `AAPL, TSLA, MSFT`)
- **Agent Controls:** `Start Agent` / `Stop Agent` buttons (call `agent_start` / `agent_stop`)

Style: Use terminal aesthetic — `bg-bg-surface`, `border-border`, `text-accent` inputs, monospace.

**Step 4: Run test to verify it passes**

Run: `pnpm test -- src/pages/__tests__/Settings.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/pages/Settings.tsx src/pages/__tests__/Settings.test.tsx src/App.tsx
git commit -m "feat(ui): add credential & config forms to Settings page"
```

---

## Task 5: React Event Listeners — Wire Stores to Tauri Events

Connect Zustand stores to real Tauri events so the UI updates live when the agent produces data.

**Files:**
- Create: `src/hooks/use-agent-events.ts`
- Create: `src/hooks/__tests__/use-agent-events.test.tsx`
- Modify: `src/App.tsx` (activate event listener hook)

**Step 1: Write the failing test**

```typescript
// src/hooks/__tests__/use-agent-events.test.tsx
import { describe, it, expect, vi } from "vitest";

// Mock @tauri-apps/api/event
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((_event: string, _cb: unknown) => Promise.resolve(() => {})),
}));

describe("useAgentEvents", () => {
  it("exports a hook function", async () => {
    const mod = await import("../use-agent-events.js");
    expect(typeof mod.useAgentEvents).toBe("function");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm test -- src/hooks/__tests__/use-agent-events.test.tsx`
Expected: FAIL — module not found

**Step 3: Create the event listener hook**

```typescript
// src/hooks/use-agent-events.ts
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { DataTick, Anomaly, AgentActivity, SourceHealth } from "@finwatch/shared";

type Stores = {
  data: { addTick: (tick: DataTick) => void };
  anomaly: { addAnomaly: (anomaly: Anomaly) => void };
  agent: { addActivity: (activity: AgentActivity) => void };
  sources: { setState: (s: Record<string, SourceHealth>) => void };
};

export function useAgentEvents(stores: Stores): void {
  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    listen<DataTick>("data:tick", (e) => stores.data.addTick(e.payload))
      .then((fn) => unlisteners.push(fn));

    listen<Anomaly>("anomaly:detected", (e) => stores.anomaly.addAnomaly(e.payload))
      .then((fn) => unlisteners.push(fn));

    listen<AgentActivity>("agent:activity", (e) => stores.agent.addActivity(e.payload))
      .then((fn) => unlisteners.push(fn));

    listen<SourceHealth>("source:health-change", (e) => {
      // Merge into existing sources map
      stores.sources.setState({ [e.payload.sourceId]: e.payload });
    }).then((fn) => unlisteners.push(fn));

    return () => unlisteners.forEach((fn) => fn());
  }, [stores]);
}
```

Update `App.tsx` to call `useAgentEvents` with the stores.

**Step 4: Run test to verify it passes**

Run: `pnpm test -- src/hooks/__tests__/use-agent-events.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/hooks/use-agent-events.ts src/hooks/__tests__/use-agent-events.test.tsx src/App.tsx
git commit -m "feat(ui): wire Zustand stores to Tauri events for live updates"
```

---

## Task 6: Integration Test — Full Tauri E2E

Create an integration test that validates the full flow works when Tauri is running.

**Files:**
- Create: `src/__tests__/integration/v11-live-pipeline.test.ts`

**Step 1: Write the integration test**

This test mocks the Tauri API layer (since we can't run Tauri in vitest) but validates the React → store → render flow:

```typescript
// src/__tests__/integration/v11-live-pipeline.test.ts
import { describe, it, expect } from "vitest";

describe("v11: live pipeline integration", () => {
  it("stores update on simulated data:tick event", () => {
    const { data } = window.__stores;
    const before = data.getState().ticks.length;

    data.getState().addTick({
      sourceId: "alpaca-stream",
      timestamp: Date.now(),
      symbol: "AAPL",
      metrics: { close: 185.50, volume: 1000000 },
      metadata: { source: "alpaca" },
    });

    expect(data.getState().ticks.length).toBe(before + 1);
  });

  it("stores update on simulated anomaly:detected event", () => {
    const { anomaly } = window.__stores;
    const before = anomaly.getState().anomalies.length;

    anomaly.getState().addAnomaly({
      id: "test-anomaly-1",
      severity: "high",
      description: "Unusual volume spike on AAPL",
      sourceId: "alpaca-stream",
      timestamp: Date.now(),
      metrics: { volume: 5000000 },
      metadata: {},
    });

    expect(anomaly.getState().anomalies.length).toBe(before + 1);
  });

  it("agent store updates on simulated agent:activity event", () => {
    const { agent } = window.__stores;

    agent.getState().addActivity({
      type: "cycle_end",
      message: "Cycle complete: 1 anomaly from 10 ticks",
      timestamp: Date.now(),
      data: { anomalyCount: 1, tickCount: 10 },
    });

    expect(agent.getState().activityLog.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run test**

Run: `pnpm test -- src/__tests__/integration/v11-live-pipeline.test.ts`
Expected: PASS (if stores have `addTick`, `addAnomaly`, `addActivity` methods — may need to add these in the store slices)

**Step 3: Add missing store methods if needed**

Check `data-slice.ts`, `anomaly-slice.ts`, `agent-slice.ts` for `addTick`, `addAnomaly`, `addActivity` methods. Add them if missing.

**Step 4: Commit**

```bash
git add src/__tests__/integration/v11-live-pipeline.test.ts
git commit -m "test(v11): live pipeline integration — store updates from events"
```

---

## Task 7: Manual Smoke Test with Real Alpaca Data

Not a code task — this is the verification step.

**Step 1: Set environment variables**

```bash
export ANTHROPIC_API_KEY="your-key"
export OPENROUTER_API_KEY="your-key"
```

**Step 2: Build and run**

```bash
pnpm build
pnpm tauri dev
```

**Step 3: Configure in UI**

1. Go to Settings tab
2. Enter Alpaca paper trading API Key and Secret
3. Enter symbols: `AAPL, TSLA, MSFT`
4. Click "Save Credentials"
5. Click "Start Agent"

**Step 4: Verify**

- Dashboard: Should show live tick data for symbols
- StatusBar: Should show `RUNNING`, tick count increasing, symbol count = 3
- Agent tab: Should show cycle activity (cycle_start, cycle_end)
- Anomaly Feed: Should show anomalies if detected (may take several cycles)
- Source Health: Should show `alpaca-stream` source as `healthy`

**Step 5: Stop and verify clean shutdown**

1. Click "Stop Agent" in Settings
2. StatusBar should return to `IDLE`
3. No console errors

---

## Summary

| Task | What | Layer |
|------|------|-------|
| 1 | Orchestrator — wire pipeline | Agent (Node.js) |
| 2 | JSON-RPC commands | Agent (Node.js) |
| 3 | Sidecar bridge — spawn + communicate | Rust (Tauri) |
| 4 | Settings page — credentials + config | React (UI) |
| 5 | Event listeners — stores ← Tauri events | React (UI) |
| 6 | Integration test — store flow | Test |
| 7 | Manual smoke test — real Alpaca data | Verification |

**Dependencies:** Task 1 → Task 2 → Task 3 (sequential, agent must work before Rust can use it). Task 4 and Task 5 can be done in parallel. Task 6 depends on Tasks 4+5. Task 7 depends on all.
