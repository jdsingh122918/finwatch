# Phase 2C: React Frontend — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the FinWatch desktop UI: Zustand state management wired to Tauri IPC, typed hooks for commands and events, and 5 pages (Dashboard, Anomaly Feed, Agent Log, Source Health, Settings).

**Architecture:** React 19 with Zustand for state management. Custom hooks abstract Tauri IPC (commands and events) with TypeScript generics. Pages consume stores and hooks for real-time data display. Tab-based navigation, minimal CSS.

**Tech Stack:** React 19, TypeScript, Zustand, @tauri-apps/api, Vitest, @testing-library/react, happy-dom

**Worktree:** `/Users/jdsingh/Projects/AI/finwatch-react-frontend`
**Branch:** `feat/react-frontend`
**Owns:** `src/` — EXCLUSIVE

---

## Existing State

Bare Tauri v2 React scaffold: src/App.tsx (greeting), src/main.tsx, src/App.css. Tauri JS APIs installed: @tauri-apps/api/core (invoke), @tauri-apps/api/event (listen). Shared types from @finwatch/shared available.

---

## Task 2C.1: Add Dependencies and Test Setup

**Files:**
- Modify: `package.json` (add deps)
- Create: `src/test-setup.ts`
- Create: `src/vitest.config.ts` or modify root

**Step 1: Install dependencies**

```bash
pnpm add zustand
pnpm add -D @testing-library/react @testing-library/jest-dom happy-dom
```

**Step 2: Create test setup with Tauri mocks**

Create `src/test-setup.ts`:

```typescript
import { vi } from "vitest";

// Mock @tauri-apps/api/core
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock @tauri-apps/api/event
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}));
```

Update `vitest.config.ts` projects to include a frontend project with happy-dom:

```typescript
// In root vitest.config.ts, add to projects array:
{
  test: {
    name: "frontend",
    root: "./src",
    include: ["**/*.test.{ts,tsx}"],
    environment: "happy-dom",
    setupFiles: ["./test-setup.ts"],
  },
}
```

**Step 3: Verify setup**

```bash
pnpm vitest run src/
```

Expected: 0 tests, 0 failures (setup works).

**Step 4: Commit**

```bash
git add src/ package.json pnpm-lock.yaml vitest.config.ts
git commit -m "feat: add frontend test infrastructure with Tauri mocks"
```

---

## Task 2C.2: Zustand Store — dataSlice

**Files:**
- Create: `src/store/data-slice.ts`
- Create: `src/store/__tests__/data-slice.test.ts`

**Step 1: Write the failing test**

Create `src/store/__tests__/data-slice.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createDataSlice, DataSlice } from "../data-slice.js";
import type { DataTick } from "@finwatch/shared";

describe("dataSlice", () => {
  let slice: DataSlice;

  beforeEach(() => { slice = createDataSlice(); });

  const tick: DataTick = { sourceId: "yahoo", timestamp: 1000, symbol: "AAPL", metrics: { price: 150, volume: 1e6 }, metadata: {} };

  it("starts with empty ticks", () => { expect(slice.getState().ticks).toHaveLength(0); });

  it("adds a tick", () => {
    slice.getState().addTick(tick);
    expect(slice.getState().ticks).toHaveLength(1);
    expect(slice.getState().ticks[0].symbol).toBe("AAPL");
  });

  it("limits ticks to maxSize", () => {
    for (let i = 0; i < 200; i++) slice.getState().addTick({ ...tick, timestamp: i });
    expect(slice.getState().ticks.length).toBeLessThanOrEqual(100);
  });

  it("gets latest tick per symbol", () => {
    slice.getState().addTick({ ...tick, timestamp: 1, symbol: "AAPL" });
    slice.getState().addTick({ ...tick, timestamp: 2, symbol: "GOOGL" });
    slice.getState().addTick({ ...tick, timestamp: 3, symbol: "AAPL" });
    const latest = slice.getState().latestBySymbol();
    expect(latest.get("AAPL")?.timestamp).toBe(3);
    expect(latest.get("GOOGL")?.timestamp).toBe(2);
  });

  it("clears all ticks", () => {
    slice.getState().addTick(tick);
    slice.getState().clearTicks();
    expect(slice.getState().ticks).toHaveLength(0);
  });
});
```

**Step 2: Run test, verify FAIL:** `pnpm vitest run src/store/__tests__/data-slice.test.ts`

**Step 3: Implement `src/store/data-slice.ts`:**

```typescript
import { createStore } from "zustand/vanilla";
import type { DataTick } from "@finwatch/shared";

const MAX_TICKS = 100;

type DataState = {
  ticks: DataTick[];
  addTick: (tick: DataTick) => void;
  clearTicks: () => void;
  latestBySymbol: () => Map<string, DataTick>;
};

export type DataSlice = ReturnType<typeof createDataSlice>;

export function createDataSlice() {
  return createStore<DataState>((set, get) => ({
    ticks: [],
    addTick: (tick) => set((state) => ({
      ticks: [...state.ticks, tick].slice(-MAX_TICKS),
    })),
    clearTicks: () => set({ ticks: [] }),
    latestBySymbol: () => {
      const map = new Map<string, DataTick>();
      for (const tick of get().ticks) {
        if (tick.symbol) {
          const existing = map.get(tick.symbol);
          if (!existing || tick.timestamp > existing.timestamp) {
            map.set(tick.symbol, tick);
          }
        }
      }
      return map;
    },
  }));
}
```

**Step 4: Run test, verify PASS:** `pnpm vitest run src/store/__tests__/data-slice.test.ts`

**Step 5: Commit:** `git add src/ && git commit -m "feat: add Zustand data slice for tick management"`

---

## Task 2C.3: Zustand Store — anomalySlice

**Files:**
- Create: `src/store/anomaly-slice.ts`
- Create: `src/store/__tests__/anomaly-slice.test.ts`

**Step 1: Write the failing test**

Create `src/store/__tests__/anomaly-slice.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createAnomalySlice, AnomalySlice } from "../anomaly-slice.js";
import type { Anomaly } from "@finwatch/shared";

describe("anomalySlice", () => {
  let slice: AnomalySlice;
  beforeEach(() => { slice = createAnomalySlice(); });

  const anomaly: Anomaly = { id: "a1", severity: "high", source: "yahoo", symbol: "AAPL", timestamp: 1000, description: "Volume spike", metrics: { volume: 5e6 }, preScreenScore: 0.85, sessionId: "s1" };

  it("starts empty", () => { expect(slice.getState().anomalies).toHaveLength(0); });

  it("adds anomaly", () => {
    slice.getState().addAnomaly(anomaly);
    expect(slice.getState().anomalies).toHaveLength(1);
  });

  it("filters by severity", () => {
    slice.getState().addAnomaly(anomaly);
    slice.getState().addAnomaly({ ...anomaly, id: "a2", severity: "low" });
    expect(slice.getState().filterBySeverity("high")).toHaveLength(1);
  });

  it("tracks feedback submission", () => {
    slice.getState().addAnomaly(anomaly);
    slice.getState().addFeedback("a1", "confirmed");
    expect(slice.getState().feedbackMap.get("a1")).toBe("confirmed");
  });
});
```

**Step 2: Run test, verify FAIL:** `pnpm vitest run src/store/__tests__/anomaly-slice.test.ts`

**Step 3: Implement `src/store/anomaly-slice.ts`:**

```typescript
import { createStore } from "zustand/vanilla";
import type { Anomaly, Severity, FeedbackVerdict } from "@finwatch/shared";

type AnomalyState = {
  anomalies: Anomaly[];
  feedbackMap: Map<string, FeedbackVerdict>;
  addAnomaly: (a: Anomaly) => void;
  addFeedback: (anomalyId: string, verdict: FeedbackVerdict) => void;
  filterBySeverity: (severity: Severity) => Anomaly[];
  clear: () => void;
};

export type AnomalySlice = ReturnType<typeof createAnomalySlice>;

export function createAnomalySlice() {
  return createStore<AnomalyState>((set, get) => ({
    anomalies: [],
    feedbackMap: new Map(),
    addAnomaly: (a) => set((state) => ({ anomalies: [a, ...state.anomalies].slice(0, 500) })),
    addFeedback: (anomalyId, verdict) => set((state) => {
      const newMap = new Map(state.feedbackMap);
      newMap.set(anomalyId, verdict);
      return { feedbackMap: newMap };
    }),
    filterBySeverity: (severity) => get().anomalies.filter(a => a.severity === severity),
    clear: () => set({ anomalies: [], feedbackMap: new Map() }),
  }));
}
```

**Step 4: Run test, verify PASS:** `pnpm vitest run src/store/__tests__/anomaly-slice.test.ts`

**Step 5: Commit:** `git add src/ && git commit -m "feat: add Zustand anomaly slice with feedback tracking"`

---

## Task 2C.4: Zustand Store — agentSlice

**Files:**
- Create: `src/store/agent-slice.ts`
- Create: `src/store/__tests__/agent-slice.test.ts`

**Step 1: Write the failing test**

Create `src/store/__tests__/agent-slice.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { createAgentSlice, AgentSlice } from "../agent-slice.js";
import type { AgentActivity } from "@finwatch/shared";

describe("agentSlice", () => {
  let slice: AgentSlice;
  beforeEach(() => { slice = createAgentSlice(); });

  it("starts idle", () => { expect(slice.getState().status.state).toBe("idle"); });

  it("updates status", () => {
    slice.getState().setStatus({ state: "running", totalCycles: 1, totalAnomalies: 0, uptime: 10 });
    expect(slice.getState().status.state).toBe("running");
  });

  it("appends activity log", () => {
    const activity: AgentActivity = { type: "cycle_start", message: "Cycle 1 started", timestamp: 1000 };
    slice.getState().addActivity(activity);
    expect(slice.getState().activityLog).toHaveLength(1);
  });

  it("limits activity log size", () => {
    for (let i = 0; i < 300; i++) {
      slice.getState().addActivity({ type: "cycle_start", message: `Cycle ${i}`, timestamp: i });
    }
    expect(slice.getState().activityLog.length).toBeLessThanOrEqual(200);
  });
});
```

**Step 2: Run test, verify FAIL:** `pnpm vitest run src/store/__tests__/agent-slice.test.ts`

**Step 3: Implement `src/store/agent-slice.ts`:**

```typescript
import { createStore } from "zustand/vanilla";
import type { AgentStatus, AgentActivity } from "@finwatch/shared";

const MAX_LOG = 200;

type AgentState = {
  status: AgentStatus;
  activityLog: AgentActivity[];
  setStatus: (update: Partial<AgentStatus>) => void;
  addActivity: (a: AgentActivity) => void;
  clearLog: () => void;
};

export type AgentSlice = ReturnType<typeof createAgentSlice>;

export function createAgentSlice() {
  return createStore<AgentState>((set) => ({
    status: { state: "idle", totalCycles: 0, totalAnomalies: 0, uptime: 0 },
    activityLog: [],
    setStatus: (update) => set((state) => ({ status: { ...state.status, ...update } })),
    addActivity: (a) => set((state) => ({ activityLog: [...state.activityLog, a].slice(-MAX_LOG) })),
    clearLog: () => set({ activityLog: [] }),
  }));
}
```

**Step 4: Run test, verify PASS:** `pnpm vitest run src/store/__tests__/agent-slice.test.ts`

**Step 5: Commit:** `git add src/ && git commit -m "feat: add Zustand agent slice with activity log"`

---

## Task 2C.5: useTauriEvent Hook

**Files:**
- Create: `src/hooks/use-tauri-event.ts`
- Create: `src/hooks/__tests__/use-tauri-event.test.tsx`

**Step 1: Write the failing test**

Create `src/hooks/__tests__/use-tauri-event.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTauriEvent } from "../use-tauri-event.js";
import { listen } from "@tauri-apps/api/event";

const mockListen = vi.mocked(listen);

describe("useTauriEvent", () => {
  it("calls listen with event name on mount", () => {
    const callback = vi.fn();
    mockListen.mockResolvedValue(() => {});
    renderHook(() => useTauriEvent("data:tick", callback));
    expect(mockListen).toHaveBeenCalledWith("data:tick", expect.any(Function));
  });

  it("calls callback when event fires", async () => {
    const callback = vi.fn();
    let handler: ((event: any) => void) | undefined;
    mockListen.mockImplementation(async (_name, cb) => { handler = cb as any; return () => {}; });

    renderHook(() => useTauriEvent("data:tick", callback));
    await vi.waitFor(() => expect(handler).toBeDefined());

    act(() => { handler!({ payload: { sourceId: "yahoo", timestamp: 1 } }); });
    expect(callback).toHaveBeenCalledWith({ sourceId: "yahoo", timestamp: 1 });
  });

  it("cleans up on unmount", async () => {
    const unlisten = vi.fn();
    mockListen.mockResolvedValue(unlisten);
    const { unmount } = renderHook(() => useTauriEvent("data:tick", vi.fn()));
    await vi.waitFor(() => expect(mockListen).toHaveBeenCalled());
    unmount();
    await vi.waitFor(() => expect(unlisten).toHaveBeenCalled());
  });
});
```

**Step 2: Run test, verify FAIL:** `pnpm vitest run src/hooks/__tests__/use-tauri-event.test.tsx`

**Step 3: Implement `src/hooks/use-tauri-event.ts`:**

```typescript
import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

export function useTauriEvent<T>(eventName: string, callback: (payload: T) => void): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<T>(eventName, (event) => {
      callbackRef.current(event.payload);
    }).then((fn) => { unlisten = fn; });

    return () => { unlisten?.(); };
  }, [eventName]);
}
```

**Step 4: Run test, verify PASS:** `pnpm vitest run src/hooks/__tests__/use-tauri-event.test.tsx`

**Step 5: Commit:** `git add src/ && git commit -m "feat: add useTauriEvent hook with typed payloads"`

---

## Task 2C.6: useTauriCommand Hook

**Files:**
- Create: `src/hooks/use-tauri-command.ts`
- Create: `src/hooks/__tests__/use-tauri-command.test.tsx`

**Step 1: Write the failing test**

Create `src/hooks/__tests__/use-tauri-command.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTauriCommand } from "../use-tauri-command.js";
import { invoke } from "@tauri-apps/api/core";

const mockInvoke = vi.mocked(invoke);

describe("useTauriCommand", () => {
  it("starts with idle state", () => {
    const { result } = renderHook(() => useTauriCommand<string>("config:get"));
    expect(result.current.data).toBeUndefined();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeUndefined();
  });

  it("sets loading during execution", async () => {
    let resolve: (v: string) => void;
    mockInvoke.mockReturnValue(new Promise(r => { resolve = r as any; }));
    const { result } = renderHook(() => useTauriCommand<string>("config:get"));

    act(() => { result.current.execute(); });
    expect(result.current.loading).toBe(true);

    await act(async () => { resolve!("{}"); });
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBe("{}");
  });

  it("sets error on failure", async () => {
    mockInvoke.mockRejectedValue(new Error("DB error"));
    const { result } = renderHook(() => useTauriCommand<string>("config:get"));
    await act(async () => { await result.current.execute().catch(() => {}); });
    expect(result.current.error).toBe("DB error");
  });

  it("passes args to invoke", async () => {
    mockInvoke.mockResolvedValue("ok");
    const { result } = renderHook(() => useTauriCommand<string>("config:update"));
    await act(async () => { await result.current.execute({ patch: "{}" }); });
    expect(mockInvoke).toHaveBeenCalledWith("config:update", { patch: "{}" });
  });
});
```

**Step 2: Run test, verify FAIL:** `pnpm vitest run src/hooks/__tests__/use-tauri-command.test.tsx`

**Step 3: Implement `src/hooks/use-tauri-command.ts`:**

```typescript
import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

type CommandState<T> = {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
  execute: (args?: Record<string, unknown>) => Promise<T | undefined>;
};

export function useTauriCommand<T>(command: string): CommandState<T> {
  const [data, setData] = useState<T | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const execute = useCallback(async (args?: Record<string, unknown>) => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await invoke<T>(command, args);
      setData(result);
      setLoading(false);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setLoading(false);
      throw err;
    }
  }, [command]);

  return { data, loading, error, execute };
}
```

**Step 4: Run test, verify PASS:** `pnpm vitest run src/hooks/__tests__/use-tauri-command.test.tsx`

**Step 5: Commit:** `git add src/ && git commit -m "feat: add useTauriCommand hook with loading/error states"`

---

## Task 2C.7: Dashboard Page

**Files:**
- Create: `src/pages/Dashboard.tsx`
- Create: `src/pages/__tests__/Dashboard.test.tsx`

**Step 1: Write the failing test**

Create `src/pages/__tests__/Dashboard.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dashboard } from "../Dashboard.js";

describe("Dashboard", () => {
  it("renders dashboard heading", () => {
    render(<Dashboard ticks={[]} />);
    expect(screen.getByText("Dashboard")).toBeTruthy();
  });

  it("shows 'No data' when no ticks", () => {
    render(<Dashboard ticks={[]} />);
    expect(screen.getByText(/no data/i)).toBeTruthy();
  });

  it("renders tick data when available", () => {
    const ticks = [
      { sourceId: "yahoo", timestamp: 1000, symbol: "AAPL", metrics: { price: 150.25, volume: 1e6 }, metadata: {} },
    ];
    render(<Dashboard ticks={ticks} />);
    expect(screen.getByText(/AAPL/)).toBeTruthy();
    expect(screen.getByText(/150.25/)).toBeTruthy();
  });

  it("shows multiple symbols", () => {
    const ticks = [
      { sourceId: "yahoo", timestamp: 1, symbol: "AAPL", metrics: { price: 150 }, metadata: {} },
      { sourceId: "yahoo", timestamp: 2, symbol: "GOOGL", metrics: { price: 175 }, metadata: {} },
    ];
    render(<Dashboard ticks={ticks} />);
    expect(screen.getByText(/AAPL/)).toBeTruthy();
    expect(screen.getByText(/GOOGL/)).toBeTruthy();
  });
});
```

**Step 2: Run test, verify FAIL:** `pnpm vitest run src/pages/__tests__/Dashboard.test.tsx`

**Step 3: Implement `src/pages/Dashboard.tsx`:**

```tsx
import type { DataTick } from "@finwatch/shared";

type Props = { ticks: DataTick[] };

export function Dashboard({ ticks }: Props) {
  const latestBySymbol = new Map<string, DataTick>();
  for (const tick of ticks) {
    if (tick.symbol) {
      const existing = latestBySymbol.get(tick.symbol);
      if (!existing || tick.timestamp > existing.timestamp) latestBySymbol.set(tick.symbol, tick);
    }
  }

  return (
    <div>
      <h1>Dashboard</h1>
      {ticks.length === 0 ? (
        <p>No data yet. Waiting for data sources...</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px" }}>
          {Array.from(latestBySymbol.entries()).map(([symbol, tick]) => (
            <div key={symbol} style={{ border: "1px solid #333", borderRadius: 8, padding: 12 }}>
              <h3>{symbol}</h3>
              {Object.entries(tick.metrics).map(([key, val]) => (
                <div key={key} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{key}</span>
                  <span>{typeof val === "number" ? val.toLocaleString() : val}</span>
                </div>
              ))}
              <small style={{ opacity: 0.6 }}>{new Date(tick.timestamp).toLocaleTimeString()}</small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 4: Run test, verify PASS:** `pnpm vitest run src/pages/__tests__/Dashboard.test.tsx`

**Step 5: Commit:** `git add src/ && git commit -m "feat: add Dashboard page with live tick display"`

---

## Task 2C.8: Anomaly Feed Page

**Files:**
- Create: `src/pages/AnomalyFeed.tsx`
- Create: `src/pages/__tests__/AnomalyFeed.test.tsx`

**Step 1: Write the failing test**

Create `src/pages/__tests__/AnomalyFeed.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AnomalyFeed } from "../AnomalyFeed.js";
import type { Anomaly, FeedbackVerdict } from "@finwatch/shared";

const anomaly: Anomaly = { id: "a1", severity: "high", source: "yahoo", symbol: "AAPL", timestamp: 1000, description: "Volume spike detected", metrics: { volume: 5e6 }, preScreenScore: 0.85, sessionId: "s1" };

describe("AnomalyFeed", () => {
  it("renders anomaly description", () => {
    render(<AnomalyFeed anomalies={[anomaly]} feedbackMap={new Map()} onFeedback={vi.fn()} />);
    expect(screen.getByText(/Volume spike detected/)).toBeTruthy();
  });

  it("shows severity badge", () => {
    render(<AnomalyFeed anomalies={[anomaly]} feedbackMap={new Map()} onFeedback={vi.fn()} />);
    expect(screen.getByText(/high/i)).toBeTruthy();
  });

  it("calls onFeedback when button clicked", () => {
    const onFeedback = vi.fn();
    render(<AnomalyFeed anomalies={[anomaly]} feedbackMap={new Map()} onFeedback={onFeedback} />);
    fireEvent.click(screen.getByText(/confirm/i));
    expect(onFeedback).toHaveBeenCalledWith("a1", "confirmed");
  });

  it("shows empty state", () => {
    render(<AnomalyFeed anomalies={[]} feedbackMap={new Map()} onFeedback={vi.fn()} />);
    expect(screen.getByText(/no anomalies/i)).toBeTruthy();
  });

  it("shows feedback status for submitted anomalies", () => {
    const map = new Map<string, FeedbackVerdict>([["a1", "confirmed"]]);
    render(<AnomalyFeed anomalies={[anomaly]} feedbackMap={map} onFeedback={vi.fn()} />);
    expect(screen.getByText(/confirmed/i)).toBeTruthy();
  });
});
```

**Step 2: Run test, verify FAIL:** `pnpm vitest run src/pages/__tests__/AnomalyFeed.test.tsx`

**Step 3: Implement `src/pages/AnomalyFeed.tsx`:**

```tsx
import type { Anomaly, FeedbackVerdict } from "@finwatch/shared";

type Props = { anomalies: Anomaly[]; feedbackMap: Map<string, FeedbackVerdict>; onFeedback: (id: string, verdict: FeedbackVerdict) => void };

const severityColors: Record<string, string> = { critical: "#ff4444", high: "#ff8800", medium: "#ffcc00", low: "#88cc00" };

export function AnomalyFeed({ anomalies, feedbackMap, onFeedback }: Props) {
  if (anomalies.length === 0) return <div><h1>Anomaly Feed</h1><p>No anomalies detected yet.</p></div>;

  return (
    <div>
      <h1>Anomaly Feed</h1>
      {anomalies.map((a) => {
        const feedback = feedbackMap.get(a.id);
        return (
          <div key={a.id} style={{ border: "1px solid #333", borderRadius: 8, padding: 12, marginBottom: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: severityColors[a.severity] || "#fff", fontWeight: "bold" }}>{a.severity.toUpperCase()}</span>
              <span>{a.symbol || a.source}</span>
              <small>{new Date(a.timestamp).toLocaleString()}</small>
            </div>
            <p>{a.description}</p>
            {feedback ? (
              <span style={{ opacity: 0.7 }}>Feedback: {feedback}</span>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => onFeedback(a.id, "confirmed")}>Confirm</button>
                <button onClick={() => onFeedback(a.id, "false_positive")}>False Positive</button>
                <button onClick={() => onFeedback(a.id, "needs_review")}>Needs Review</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

**Step 4: Run test, verify PASS:** `pnpm vitest run src/pages/__tests__/AnomalyFeed.test.tsx`

**Step 5: Commit:** `git add src/ && git commit -m "feat: add Anomaly Feed page with feedback buttons"`

---

## Task 2C.9: Agent Activity Log Page

**Files:**
- Create: `src/pages/AgentLog.tsx`
- Create: `src/pages/__tests__/AgentLog.test.tsx`

**Step 1: Write the failing test**

Create `src/pages/__tests__/AgentLog.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentLog } from "../AgentLog.js";
import type { AgentActivity, AgentStatus } from "@finwatch/shared";

describe("AgentLog", () => {
  const status: AgentStatus = { state: "running", totalCycles: 5, totalAnomalies: 2, uptime: 3600 };
  const log: AgentActivity[] = [
    { type: "cycle_start", message: "Cycle 1 started", timestamp: 1000 },
    { type: "anomaly_detected", message: "AAPL volume spike", timestamp: 2000 },
  ];

  it("renders status", () => {
    render(<AgentLog status={status} log={log} />);
    expect(screen.getByText(/running/i)).toBeTruthy();
  });

  it("renders log entries", () => {
    render(<AgentLog status={status} log={log} />);
    expect(screen.getByText(/Cycle 1 started/)).toBeTruthy();
    expect(screen.getByText(/AAPL volume spike/)).toBeTruthy();
  });

  it("shows empty state", () => {
    render(<AgentLog status={{ state: "idle", totalCycles: 0, totalAnomalies: 0, uptime: 0 }} log={[]} />);
    expect(screen.getByText(/no activity/i)).toBeTruthy();
  });
});
```

**Step 2: Run test, verify FAIL**

**Step 3: Implement `src/pages/AgentLog.tsx`:**

```tsx
import type { AgentStatus, AgentActivity } from "@finwatch/shared";

type Props = { status: AgentStatus; log: AgentActivity[] };

const stateColors: Record<string, string> = { running: "#44ff44", idle: "#888", paused: "#ffcc00", error: "#ff4444" };

export function AgentLog({ status, log }: Props) {
  return (
    <div>
      <h1>Agent Activity</h1>
      <div style={{ display: "flex", gap: 16, marginBottom: 16, padding: 12, border: "1px solid #333", borderRadius: 8 }}>
        <span>State: <strong style={{ color: stateColors[status.state] }}>{status.state}</strong></span>
        <span>Cycles: {status.totalCycles}</span>
        <span>Anomalies: {status.totalAnomalies}</span>
        <span>Uptime: {Math.floor(status.uptime / 60)}m</span>
      </div>
      {log.length === 0 ? <p>No activity yet.</p> : (
        <div style={{ fontFamily: "monospace", fontSize: 13, maxHeight: 400, overflow: "auto" }}>
          {log.map((entry, i) => (
            <div key={i} style={{ padding: "4px 0", borderBottom: "1px solid #222" }}>
              <span style={{ opacity: 0.5 }}>{new Date(entry.timestamp).toLocaleTimeString()}</span>{" "}
              <span style={{ color: entry.type === "error" ? "#ff4444" : "#ccc" }}>[{entry.type}]</span>{" "}
              {entry.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 4: Run test, verify PASS**

**Step 5: Commit:** `git add src/ && git commit -m "feat: add Agent Log page with status display"`

---

## Task 2C.10: Source Health Panel + Settings Page

**Files:**
- Create: `src/pages/SourceHealth.tsx`
- Create: `src/pages/Settings.tsx`
- Create: `src/pages/__tests__/SourceHealth.test.tsx`
- Create: `src/pages/__tests__/Settings.test.tsx`

**Step 1: Write failing tests**

`src/pages/__tests__/SourceHealth.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourceHealth } from "../SourceHealth.js";

describe("SourceHealth", () => {
  it("renders source statuses", () => {
    const sources = { yahoo: { sourceId: "yahoo", status: "healthy" as const, lastSuccess: 1000, failCount: 0, latencyMs: 50 } };
    render(<SourceHealth sources={sources} />);
    expect(screen.getByText(/yahoo/)).toBeTruthy();
    expect(screen.getByText(/healthy/i)).toBeTruthy();
  });

  it("shows empty state", () => {
    render(<SourceHealth sources={{}} />);
    expect(screen.getByText(/no sources/i)).toBeTruthy();
  });
});
```

`src/pages/__tests__/Settings.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Settings } from "../Settings.js";

describe("Settings", () => {
  it("renders config JSON", () => {
    render(<Settings config='{"monitor":{"analysisIntervalMs":60000}}' onSave={vi.fn()} />);
    expect(screen.getByText(/analysisIntervalMs/)).toBeTruthy();
  });

  it("calls onSave", () => {
    const onSave = vi.fn();
    render(<Settings config="{}" onSave={onSave} />);
    fireEvent.click(screen.getByText(/save/i));
    expect(onSave).toHaveBeenCalled();
  });
});
```

**Step 2: Run tests, verify FAIL**

**Step 3: Implement both pages**

`src/pages/SourceHealth.tsx`:

```tsx
import type { SourceHealth as SH } from "@finwatch/shared";

type Props = { sources: Record<string, SH> };
const statusColors: Record<string, string> = { healthy: "#44ff44", degraded: "#ffcc00", offline: "#ff4444" };

export function SourceHealth({ sources }: Props) {
  const entries = Object.values(sources);
  return (
    <div>
      <h1>Source Health</h1>
      {entries.length === 0 ? <p>No sources configured.</p> : (
        <div>{entries.map(s => (
          <div key={s.sourceId} style={{ display: "flex", justifyContent: "space-between", padding: 8, borderBottom: "1px solid #333" }}>
            <span>{s.sourceId}</span>
            <span style={{ color: statusColors[s.status] || "#888" }}>{s.status}</span>
            <span>{s.latencyMs}ms</span>
            <span>fails: {s.failCount}</span>
          </div>
        ))}</div>
      )}
    </div>
  );
}
```

`src/pages/Settings.tsx`:

```tsx
import { useState } from "react";

type Props = { config: string; onSave: (config: string) => void };

export function Settings({ config, onSave }: Props) {
  const [value, setValue] = useState(config);
  return (
    <div>
      <h1>Settings</h1>
      <textarea value={value} onChange={e => setValue(e.target.value)} rows={20} style={{ width: "100%", fontFamily: "monospace", fontSize: 13 }} />
      <button onClick={() => onSave(value)} style={{ marginTop: 8 }}>Save</button>
    </div>
  );
}
```

**Step 4: Run tests, verify PASS**

**Step 5: Commit:** `git add src/ && git commit -m "feat: add Source Health panel and Settings page"`

---

## Task 2C.11: App Shell with Tab Navigation

**Files:**
- Modify: `src/App.tsx`
- Create: `src/pages/__tests__/App.test.tsx`

**Step 1: Write the failing test**

Create `src/pages/__tests__/App.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "../../App.js";

describe("App shell", () => {
  it("renders navigation tabs", () => {
    render(<App />);
    expect(screen.getByText("Dashboard")).toBeTruthy();
    expect(screen.getByText("Anomalies")).toBeTruthy();
    expect(screen.getByText("Agent")).toBeTruthy();
    expect(screen.getByText("Sources")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("switches pages on tab click", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Anomalies"));
    expect(screen.getByText("Anomaly Feed")).toBeTruthy();
  });
});
```

**Step 2: Run test, verify FAIL**

**Step 3: Implement `src/App.tsx`:**

```tsx
import { useState } from "react";
import { Dashboard } from "./pages/Dashboard";
import { AnomalyFeed } from "./pages/AnomalyFeed";
import { AgentLog } from "./pages/AgentLog";
import { SourceHealth } from "./pages/SourceHealth";
import { Settings } from "./pages/Settings";
import type { FeedbackVerdict } from "@finwatch/shared";

const tabs = ["Dashboard", "Anomalies", "Agent", "Sources", "Settings"] as const;
type Tab = typeof tabs[number];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("Dashboard");

  return (
    <div style={{ padding: 16, color: "#eee", background: "#111", minHeight: "100vh" }}>
      <nav style={{ display: "flex", gap: 4, marginBottom: 16, borderBottom: "1px solid #333", paddingBottom: 8 }}>
        {tabs.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{ padding: "8px 16px", background: activeTab === tab ? "#333" : "transparent", color: "#eee", border: "none", borderRadius: 4, cursor: "pointer" }}>
            {tab}
          </button>
        ))}
      </nav>

      {activeTab === "Dashboard" && <Dashboard ticks={[]} />}
      {activeTab === "Anomalies" && <AnomalyFeed anomalies={[]} feedbackMap={new Map()} onFeedback={(id: string, v: FeedbackVerdict) => { console.log(id, v); }} />}
      {activeTab === "Agent" && <AgentLog status={{ state: "idle", totalCycles: 0, totalAnomalies: 0, uptime: 0 }} log={[]} />}
      {activeTab === "Sources" && <SourceHealth sources={{}} />}
      {activeTab === "Settings" && <Settings config="{}" onSave={(c) => { console.log(c); }} />}
    </div>
  );
}
```

**Step 4: Run test, verify PASS**

**Step 5: Commit:** `git add src/ && git commit -m "feat: add App shell with tab navigation"`

---

## Final Verification

```bash
pnpm vitest run src/
```

Expected: ALL PASS across stores, hooks, pages, and App tests.

Write COMPLETION.md and commit:

```bash
git add -A && git commit -m "docs: add completion summary"
```
