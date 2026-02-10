# UI Redesign — Terminal Aesthetic Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restyle the FinWatch frontend with a terminal/hacker aesthetic using Tailwind CSS v4, replacing all inline styles with a slim sidebar layout, status bar, and balanced data density.

**Architecture:** Install Tailwind CSS v4 via `@tailwindcss/vite` plugin. Define custom theme tokens (colors, fonts) via `@theme` directive in a main CSS file. Build 3 structural components (AppShell, Sidebar, StatusBar) plus 2 small utilities (SeverityDot, DataTable). Then restyle each of the 5 existing pages. Finally remove all inline styles and old CSS.

**Tech Stack:** Tailwind CSS v4, `@tailwindcss/vite`, React 19, Zustand 5, Vitest

**Design doc:** `docs/plans/2026-02-03-ui-redesign.md`

---

## Task 1: Install and Configure Tailwind CSS v4

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts:1-32`
- Create: `src/index.css`
- Modify: `src/main.tsx:1-9`
- Modify: `index.html:5` (add Google Fonts link)

**Step 1: Install Tailwind CSS v4 Vite plugin**

Run:
```bash
pnpm add -D @tailwindcss/vite
```
Expected: Package added to devDependencies.

**Step 2: Add Tailwind plugin to Vite config**

Modify `vite.config.ts`:
```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
```

**Step 3: Create main CSS file with Tailwind import and theme tokens**

Create `src/index.css`:
```css
@import "tailwindcss";

@theme {
  --font-mono: "JetBrains Mono", "Fira Code", ui-monospace, monospace;

  --color-bg-primary: #0a0a0a;
  --color-bg-surface: #111111;
  --color-bg-elevated: #1a1a1a;
  --color-border: #222222;
  --color-text-primary: #d4d4d4;
  --color-text-muted: #666666;
  --color-accent: #00ff88;

  --color-severity-critical: #ef4444;
  --color-severity-high: #f97316;
  --color-severity-medium: #eab308;
  --color-severity-low: #22c55e;

  --color-state-running: #22c55e;
  --color-state-idle: #666666;
  --color-state-paused: #eab308;
  --color-state-error: #ef4444;
}
```

**Step 4: Import CSS in main.tsx**

Modify `src/main.tsx`:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

**Step 5: Add JetBrains Mono font to index.html**

Modify `index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
    <title>FinWatch</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 6: Verify Tailwind works**

Run: `pnpm build`
Expected: Build succeeds with no errors.

**Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml vite.config.ts src/index.css src/main.tsx index.html
git commit -m "feat(ui): install Tailwind CSS v4 with terminal theme tokens"
```

---

## Task 2: Build Sidebar Component

**Files:**
- Create: `src/components/Sidebar.tsx`
- Create: `src/components/__tests__/Sidebar.test.tsx`

**Step 1: Write the failing test**

Create `src/components/__tests__/Sidebar.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "../Sidebar.js";

const tabs = ["Dashboard", "Anomalies", "Agent", "Sources", "Settings"] as const;

describe("Sidebar", () => {
  it("renders all navigation items", () => {
    render(<Sidebar activeTab="Dashboard" onTabChange={vi.fn()} />);
    for (const tab of tabs) {
      expect(screen.getByTitle(tab)).toBeTruthy();
    }
  });

  it("calls onTabChange when icon is clicked", () => {
    const handler = vi.fn();
    render(<Sidebar activeTab="Dashboard" onTabChange={handler} />);
    fireEvent.click(screen.getByTitle("Anomalies"));
    expect(handler).toHaveBeenCalledWith("Anomalies");
  });

  it("marks active tab with accent styling", () => {
    render(<Sidebar activeTab="Agent" onTabChange={vi.fn()} />);
    const agentBtn = screen.getByTitle("Agent");
    expect(agentBtn.className).toContain("text-accent");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/__tests__/Sidebar.test.tsx`
Expected: FAIL — module not found.

**Step 3: Write Sidebar component**

Create `src/components/Sidebar.tsx`:
```tsx
type Tab = "Dashboard" | "Anomalies" | "Agent" | "Sources" | "Settings";

type Props = {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
};

const navItems: { tab: Tab; icon: string }[] = [
  { tab: "Dashboard", icon: "◫" },
  { tab: "Anomalies", icon: "⚠" },
  { tab: "Agent", icon: "⬡" },
  { tab: "Sources", icon: "◉" },
  { tab: "Settings", icon: "⚙" },
];

export function Sidebar({ activeTab, onTabChange }: Props) {
  return (
    <nav className="fixed left-0 top-0 bottom-7 w-12 bg-bg-primary border-r border-border flex flex-col items-center pt-3 gap-1 z-10">
      {navItems.map(({ tab, icon }) => (
        <button
          key={tab}
          title={tab}
          onClick={() => onTabChange(tab)}
          className={`w-10 h-10 flex items-center justify-center text-lg rounded-sm transition-opacity duration-150 cursor-pointer border-l-2 ${
            activeTab === tab
              ? "text-accent border-accent bg-bg-elevated"
              : "text-text-muted border-transparent hover:text-text-primary hover:bg-bg-elevated"
          }`}
        >
          {icon}
        </button>
      ))}
    </nav>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/__tests__/Sidebar.test.tsx`
Expected: 3 tests PASS.

**Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/components/__tests__/Sidebar.test.tsx
git commit -m "feat(ui): add Sidebar navigation component"
```

---

## Task 3: Build StatusBar Component

**Files:**
- Create: `src/components/StatusBar.tsx`
- Create: `src/components/__tests__/StatusBar.test.tsx`

**Step 1: Write the failing test**

Create `src/components/__tests__/StatusBar.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBar } from "../StatusBar.js";

describe("StatusBar", () => {
  it("renders agent state", () => {
    render(
      <StatusBar
        agentState="running"
        totalCycles={42}
        totalAnomalies={5}
        tickCount={100}
        symbolCount={3}
        tradingMode="paper"
        killSwitchActive={false}
      />,
    );
    expect(screen.getByText("RUNNING")).toBeTruthy();
  });

  it("renders trading mode", () => {
    render(
      <StatusBar
        agentState="idle"
        totalCycles={0}
        totalAnomalies={0}
        tickCount={0}
        symbolCount={0}
        tradingMode="paper"
        killSwitchActive={false}
      />,
    );
    expect(screen.getByText("PAPER")).toBeTruthy();
  });

  it("shows kill switch when active", () => {
    render(
      <StatusBar
        agentState="idle"
        totalCycles={0}
        totalAnomalies={0}
        tickCount={0}
        symbolCount={0}
        tradingMode="live"
        killSwitchActive={true}
      />,
    );
    expect(screen.getByText("KILL SWITCH")).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/components/__tests__/StatusBar.test.tsx`
Expected: FAIL — module not found.

**Step 3: Write StatusBar component**

Create `src/components/StatusBar.tsx`:
```tsx
type Props = {
  agentState: string;
  totalCycles: number;
  totalAnomalies: number;
  tickCount: number;
  symbolCount: number;
  tradingMode: string;
  killSwitchActive: boolean;
};

const stateColorClass: Record<string, string> = {
  running: "bg-state-running",
  idle: "bg-state-idle",
  paused: "bg-state-paused",
  error: "bg-state-error",
};

export function StatusBar({
  agentState,
  totalCycles,
  totalAnomalies,
  tickCount,
  symbolCount,
  tradingMode,
  killSwitchActive,
}: Props) {
  return (
    <footer className="fixed bottom-0 left-0 right-0 h-7 bg-bg-primary border-t border-border flex items-center px-3 text-xs font-mono text-text-muted z-20">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${stateColorClass[agentState] ?? "bg-state-idle"}`}
          />
          <span>{agentState.toUpperCase()}</span>
        </span>
        <span>cycles:{totalCycles}</span>
        <span>anomalies:{totalAnomalies}</span>
      </div>
      <div className="flex-1 text-center">
        <span>ticks:{tickCount}</span>
        <span className="ml-4">symbols:{symbolCount}</span>
      </div>
      <div className="flex items-center gap-4">
        <span
          className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold ${
            tradingMode === "live"
              ? "bg-severity-critical/20 text-severity-critical"
              : "bg-accent/10 text-accent"
          }`}
        >
          {tradingMode.toUpperCase()}
        </span>
        {killSwitchActive && (
          <span className="text-severity-critical font-bold">KILL SWITCH</span>
        )}
      </div>
    </footer>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/components/__tests__/StatusBar.test.tsx`
Expected: 3 tests PASS.

**Step 5: Commit**

```bash
git add src/components/StatusBar.tsx src/components/__tests__/StatusBar.test.tsx
git commit -m "feat(ui): add StatusBar component with agent/trading status"
```

---

## Task 4: Build AppShell and Rewire App.tsx

**Files:**
- Modify: `src/App.tsx:1-118`
- Modify: `src/pages/__tests__/App.test.tsx:1-20`

**Step 1: Update App.test.tsx for new sidebar navigation**

Replace `src/pages/__tests__/App.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "../../App.js";

describe("App shell", () => {
  it("renders sidebar navigation items", () => {
    render(<App />);
    expect(screen.getByTitle("Dashboard")).toBeTruthy();
    expect(screen.getByTitle("Anomalies")).toBeTruthy();
    expect(screen.getByTitle("Agent")).toBeTruthy();
    expect(screen.getByTitle("Sources")).toBeTruthy();
    expect(screen.getByTitle("Settings")).toBeTruthy();
  });

  it("switches pages on sidebar click", () => {
    render(<App />);
    fireEvent.click(screen.getByTitle("Anomalies"));
    expect(screen.getByText("ANOMALY FEED")).toBeTruthy();
  });

  it("renders status bar", () => {
    render(<App />);
    expect(screen.getByText("IDLE")).toBeTruthy();
    expect(screen.getByText("PAPER")).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/pages/__tests__/App.test.tsx`
Expected: FAIL — new assertions don't match old markup.

**Step 3: Rewrite App.tsx with AppShell layout**

Replace `src/App.tsx`:
```tsx
import { useState, useSyncExternalStore } from "react";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { Dashboard } from "./pages/Dashboard";
import { AnomalyFeed } from "./pages/AnomalyFeed";
import { AgentLog } from "./pages/AgentLog";
import { SourceHealth } from "./pages/SourceHealth";
import { Settings } from "./pages/Settings";
import { createDataSlice } from "./store/data-slice";
import { createAnomalySlice } from "./store/anomaly-slice";
import { createAgentSlice } from "./store/agent-slice";
import { createTradingSlice } from "./store/trading-slice";
import type { SourceHealth as SH } from "@finwatch/shared";

const tabs = ["Dashboard", "Anomalies", "Agent", "Sources", "Settings"] as const;
type Tab = (typeof tabs)[number];

const dataStore = createDataSlice();
const anomalyStore = createAnomalySlice();
const agentStore = createAgentSlice();
const tradingStore = createTradingSlice();

declare global {
  interface Window {
    __stores: {
      data: typeof dataStore;
      anomaly: typeof anomalyStore;
      agent: typeof agentStore;
      trading: typeof tradingStore;
      sources: {
        getState: () => { sources: Record<string, SH> };
        setState: (s: Record<string, SH>) => void;
        subscribe: (fn: () => void) => () => void;
      };
    };
  }
}

const sourcesListeners = new Set<() => void>();
let sourcesSnapshot = { sources: {} as Record<string, SH> };
const sourcesStore = {
  getState: () => sourcesSnapshot,
  setState: (s: Record<string, SH>) => {
    sourcesSnapshot = { sources: s };
    sourcesListeners.forEach((fn) => fn());
  },
  subscribe: (fn: () => void) => {
    sourcesListeners.add(fn);
    return () => {
      sourcesListeners.delete(fn);
    };
  },
};

window.__stores = {
  data: dataStore,
  anomaly: anomalyStore,
  agent: agentStore,
  trading: tradingStore,
  sources: sourcesStore,
};

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("Dashboard");

  const dataState = useSyncExternalStore(dataStore.subscribe, dataStore.getState);
  const anomalyState = useSyncExternalStore(anomalyStore.subscribe, anomalyStore.getState);
  const agentState = useSyncExternalStore(agentStore.subscribe, agentStore.getState);
  const sourceState = useSyncExternalStore(sourcesStore.subscribe, sourcesStore.getState);
  const tradingState = useSyncExternalStore(tradingStore.subscribe, tradingStore.getState);

  const uniqueSymbols = new Set(dataState.ticks.map((t) => t.symbol).filter(Boolean));

  return (
    <div className="h-screen bg-bg-primary text-text-primary font-mono text-sm">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

      <main className="ml-12 pb-7 p-4 h-screen overflow-y-auto">
        {activeTab === "Dashboard" && <Dashboard ticks={dataState.ticks} />}
        {activeTab === "Anomalies" && (
          <AnomalyFeed
            anomalies={anomalyState.anomalies}
            feedbackMap={anomalyState.feedbackMap}
            onFeedback={(id, v) => anomalyState.addFeedback(id, v)}
          />
        )}
        {activeTab === "Agent" && (
          <AgentLog status={agentState.status} log={agentState.activityLog} />
        )}
        {activeTab === "Sources" && <SourceHealth sources={sourceState.sources} />}
        {activeTab === "Settings" && (
          <Settings
            config="{}"
            onSave={(c) => {
              console.log(c);
            }}
          />
        )}
      </main>

      <StatusBar
        agentState={agentState.status.state}
        totalCycles={agentState.status.totalCycles}
        totalAnomalies={agentState.status.totalAnomalies}
        tickCount={dataState.ticks.length}
        symbolCount={uniqueSymbols.size}
        tradingMode={tradingState.mode}
        killSwitchActive={tradingState.killSwitchActive}
      />
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/pages/__tests__/App.test.tsx`
Expected: 3 tests PASS.

**Step 5: Commit**

```bash
git add src/App.tsx src/pages/__tests__/App.test.tsx
git commit -m "feat(ui): rewire App shell with Sidebar + StatusBar layout"
```

---

## Task 5: Restyle Dashboard Page

**Files:**
- Modify: `src/pages/Dashboard.tsx:1-61`
- Modify: `src/pages/__tests__/Dashboard.test.tsx:1-52`

**Step 1: Update Dashboard test for new markup**

Replace `src/pages/__tests__/Dashboard.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Dashboard } from "../Dashboard.js";

describe("Dashboard", () => {
  it("renders dashboard heading", () => {
    render(<Dashboard ticks={[]} />);
    expect(screen.getByText("MARKET DATA")).toBeTruthy();
  });

  it("shows empty state when no ticks", () => {
    render(<Dashboard ticks={[]} />);
    expect(screen.getByText(/waiting for data/i)).toBeTruthy();
  });

  it("renders tick data when available", () => {
    const ticks = [
      {
        sourceId: "yahoo",
        timestamp: 1000,
        symbol: "AAPL",
        metrics: { price: 150.25, volume: 1e6 },
        metadata: {},
      },
    ];
    render(<Dashboard ticks={ticks} />);
    expect(screen.getByText("AAPL")).toBeTruthy();
    expect(screen.getByText(/150.25/)).toBeTruthy();
  });

  it("shows multiple symbols", () => {
    const ticks = [
      { sourceId: "yahoo", timestamp: 1, symbol: "AAPL", metrics: { price: 150 }, metadata: {} },
      { sourceId: "yahoo", timestamp: 2, symbol: "GOOGL", metrics: { price: 175 }, metadata: {} },
    ];
    render(<Dashboard ticks={ticks} />);
    expect(screen.getByText("AAPL")).toBeTruthy();
    expect(screen.getByText("GOOGL")).toBeTruthy();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/pages/__tests__/Dashboard.test.tsx`
Expected: FAIL — "MARKET DATA" not found.

**Step 3: Restyle Dashboard component**

Replace `src/pages/Dashboard.tsx`:
```tsx
import type { DataTick } from "@finwatch/shared";

type Props = { ticks: DataTick[] };

export function Dashboard({ ticks }: Props) {
  const latestBySymbol = new Map<string, DataTick>();
  for (const tick of ticks) {
    if (tick.symbol) {
      const existing = latestBySymbol.get(tick.symbol);
      if (!existing || tick.timestamp > existing.timestamp)
        latestBySymbol.set(tick.symbol, tick);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-text-muted text-xs uppercase tracking-widest">Market Data</h2>
        <span className="text-text-muted text-xs">
          {latestBySymbol.size} symbols
        </span>
      </div>
      {ticks.length === 0 ? (
        <p className="text-text-muted">Waiting for data sources...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from(latestBySymbol.entries()).map(([symbol, tick]) => (
            <div
              key={symbol}
              className="bg-bg-surface border border-border rounded-sm p-3"
            >
              <div className="text-accent font-bold mb-2">{symbol}</div>
              {Object.entries(tick.metrics).map(([key, val]) => (
                <div key={key} className="flex justify-between text-xs py-0.5">
                  <span className="text-text-muted">{key}</span>
                  <span>{typeof val === "number" ? val.toLocaleString() : val}</span>
                </div>
              ))}
              <div className="text-text-muted text-xs mt-2">
                {new Date(tick.timestamp).toLocaleTimeString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/pages/__tests__/Dashboard.test.tsx`
Expected: 4 tests PASS.

**Step 5: Commit**

```bash
git add src/pages/Dashboard.tsx src/pages/__tests__/Dashboard.test.tsx
git commit -m "feat(ui): restyle Dashboard with terminal aesthetic"
```

---

## Task 6: Restyle Anomaly Feed Page

**Files:**
- Modify: `src/pages/AnomalyFeed.tsx:1-79`
- Modify: `src/pages/__tests__/AnomalyFeed.test.tsx`

**Step 1: Read existing AnomalyFeed test**

Read `src/pages/__tests__/AnomalyFeed.test.tsx` for current assertions.

**Step 2: Update AnomalyFeed test for new markup**

Replace `src/pages/__tests__/AnomalyFeed.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AnomalyFeed } from "../AnomalyFeed.js";

const mockAnomaly = {
  id: "a1",
  source: "yahoo",
  severity: "critical" as const,
  symbol: "AAPL",
  description: "Price spike detected",
  timestamp: Date.now(),
  metadata: {},
};

describe("AnomalyFeed", () => {
  it("renders heading", () => {
    render(<AnomalyFeed anomalies={[]} feedbackMap={new Map()} onFeedback={vi.fn()} />);
    expect(screen.getByText("ANOMALY FEED")).toBeTruthy();
  });

  it("shows empty state", () => {
    render(<AnomalyFeed anomalies={[]} feedbackMap={new Map()} onFeedback={vi.fn()} />);
    expect(screen.getByText(/no anomalies/i)).toBeTruthy();
  });

  it("renders anomaly with severity dot", () => {
    render(
      <AnomalyFeed anomalies={[mockAnomaly]} feedbackMap={new Map()} onFeedback={vi.fn()} />,
    );
    expect(screen.getByText("AAPL")).toBeTruthy();
    expect(screen.getByText(/price spike/i)).toBeTruthy();
  });

  it("renders feedback buttons", () => {
    render(
      <AnomalyFeed anomalies={[mockAnomaly]} feedbackMap={new Map()} onFeedback={vi.fn()} />,
    );
    expect(screen.getByText("CONFIRM")).toBeTruthy();
    expect(screen.getByText("FALSE+")).toBeTruthy();
    expect(screen.getByText("REVIEW")).toBeTruthy();
  });

  it("calls onFeedback when button clicked", () => {
    const handler = vi.fn();
    render(
      <AnomalyFeed anomalies={[mockAnomaly]} feedbackMap={new Map()} onFeedback={handler} />,
    );
    fireEvent.click(screen.getByText("CONFIRM"));
    expect(handler).toHaveBeenCalledWith("a1", "confirmed");
  });

  it("shows verdict when feedback exists", () => {
    const map = new Map([["a1", "confirmed" as const]]);
    render(<AnomalyFeed anomalies={[mockAnomaly]} feedbackMap={map} onFeedback={vi.fn()} />);
    expect(screen.getByText("confirmed")).toBeTruthy();
    expect(screen.queryByText("CONFIRM")).toBeNull();
  });
});
```

**Step 3: Restyle AnomalyFeed component**

Replace `src/pages/AnomalyFeed.tsx`:
```tsx
import type { Anomaly, FeedbackVerdict } from "@finwatch/shared";

type Props = {
  anomalies: Anomaly[];
  feedbackMap: Map<string, FeedbackVerdict>;
  onFeedback: (id: string, verdict: FeedbackVerdict) => void;
};

const severityColorClass: Record<string, string> = {
  critical: "bg-severity-critical",
  high: "bg-severity-high",
  medium: "bg-severity-medium",
  low: "bg-severity-low",
};

export function AnomalyFeed({ anomalies, feedbackMap, onFeedback }: Props) {
  return (
    <div>
      <h2 className="text-text-muted text-xs uppercase tracking-widest mb-4">Anomaly Feed</h2>
      {anomalies.length === 0 ? (
        <p className="text-text-muted">No anomalies detected yet.</p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {anomalies.map((a) => {
            const feedback = feedbackMap.get(a.id);
            return (
              <div
                key={a.id}
                className="flex items-center gap-3 px-3 py-2 bg-bg-surface border border-border rounded-sm hover:bg-bg-elevated transition-opacity duration-150"
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${severityColorClass[a.severity] ?? "bg-text-muted"}`}
                />
                <span className="text-text-muted text-xs w-16 shrink-0">
                  {new Date(a.timestamp).toLocaleTimeString()}
                </span>
                <span className="text-accent text-xs font-bold w-14 shrink-0">
                  {a.symbol || a.source}
                </span>
                <span className="text-xs truncate flex-1">{a.description}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {feedback ? (
                    <span className="text-text-muted text-xs">{feedback}</span>
                  ) : (
                    <>
                      <button
                        onClick={() => onFeedback(a.id, "confirmed")}
                        className="text-[10px] px-1.5 py-0.5 border border-border rounded-sm text-text-muted hover:text-accent hover:border-accent cursor-pointer bg-transparent"
                      >
                        CONFIRM
                      </button>
                      <button
                        onClick={() => onFeedback(a.id, "false_positive")}
                        className="text-[10px] px-1.5 py-0.5 border border-border rounded-sm text-text-muted hover:text-severity-high hover:border-severity-high cursor-pointer bg-transparent"
                      >
                        FALSE+
                      </button>
                      <button
                        onClick={() => onFeedback(a.id, "needs_review")}
                        className="text-[10px] px-1.5 py-0.5 border border-border rounded-sm text-text-muted hover:text-severity-medium hover:border-severity-medium cursor-pointer bg-transparent"
                      >
                        REVIEW
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/pages/__tests__/AnomalyFeed.test.tsx`
Expected: 6 tests PASS.

**Step 5: Commit**

```bash
git add src/pages/AnomalyFeed.tsx src/pages/__tests__/AnomalyFeed.test.tsx
git commit -m "feat(ui): restyle AnomalyFeed with terminal rows and severity dots"
```

---

## Task 7: Restyle Agent Log Page

**Files:**
- Modify: `src/pages/AgentLog.tsx:1-67`
- Modify: `src/pages/__tests__/AgentLog.test.tsx`

**Step 1: Read existing AgentLog test**

Read `src/pages/__tests__/AgentLog.test.tsx` for current assertions.

**Step 2: Update AgentLog test for new markup**

Replace `src/pages/__tests__/AgentLog.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentLog } from "../AgentLog.js";

const idleStatus = { state: "idle", totalCycles: 0, totalAnomalies: 0, uptime: 0 };

describe("AgentLog", () => {
  it("renders heading", () => {
    render(<AgentLog status={idleStatus} log={[]} />);
    expect(screen.getByText("AGENT")).toBeTruthy();
  });

  it("shows status metrics", () => {
    render(
      <AgentLog
        status={{ state: "running", totalCycles: 10, totalAnomalies: 3, uptime: 120 }}
        log={[]}
      />,
    );
    expect(screen.getByText("RUNNING")).toBeTruthy();
    expect(screen.getByText("10")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("2m")).toBeTruthy();
  });

  it("shows empty log message", () => {
    render(<AgentLog status={idleStatus} log={[]} />);
    expect(screen.getByText(/no activity/i)).toBeTruthy();
  });

  it("renders log entries", () => {
    const log = [
      { type: "info", message: "Cycle started", timestamp: Date.now() },
      { type: "error", message: "Connection failed", timestamp: Date.now() },
    ];
    render(<AgentLog status={idleStatus} log={log} />);
    expect(screen.getByText(/cycle started/i)).toBeTruthy();
    expect(screen.getByText(/connection failed/i)).toBeTruthy();
  });
});
```

**Step 3: Restyle AgentLog component**

Replace `src/pages/AgentLog.tsx`:
```tsx
import type { AgentStatus, AgentActivity } from "@finwatch/shared";

type Props = { status: AgentStatus; log: AgentActivity[] };

const stateColorClass: Record<string, string> = {
  running: "text-state-running",
  idle: "text-state-idle",
  paused: "text-state-paused",
  error: "text-state-error",
};

export function AgentLog({ status, log }: Props) {
  return (
    <div>
      <h2 className="text-text-muted text-xs uppercase tracking-widest mb-4">Agent</h2>

      <div className="flex items-center gap-6 mb-4 text-xs">
        <span className="flex items-center gap-1.5">
          state:
          <span className={`font-bold ${stateColorClass[status.state] ?? "text-state-idle"}`}>
            {status.state.toUpperCase()}
          </span>
        </span>
        <span>
          cycles: <span className="text-text-primary">{status.totalCycles}</span>
        </span>
        <span>
          anomalies: <span className="text-text-primary">{status.totalAnomalies}</span>
        </span>
        <span>
          uptime: <span className="text-text-primary">{Math.floor(status.uptime / 60)}m</span>
        </span>
      </div>

      {log.length === 0 ? (
        <p className="text-text-muted text-xs">No activity yet.</p>
      ) : (
        <div className="max-h-[calc(100vh-12rem)] overflow-y-auto text-xs">
          {log.map((entry, i) => (
            <div key={i} className="py-1 border-b border-bg-elevated flex gap-2">
              <span className="text-text-muted w-20 shrink-0">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span
                className={
                  entry.type === "error" ? "text-severity-critical" : "text-text-muted"
                }
              >
                [{entry.type}]
              </span>
              <span>{entry.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/pages/__tests__/AgentLog.test.tsx`
Expected: 4 tests PASS.

**Step 5: Commit**

```bash
git add src/pages/AgentLog.tsx src/pages/__tests__/AgentLog.test.tsx
git commit -m "feat(ui): restyle AgentLog with terminal log output"
```

---

## Task 8: Restyle Source Health Page

**Files:**
- Modify: `src/pages/SourceHealth.tsx:1-42`
- Modify: `src/pages/__tests__/SourceHealth.test.tsx`

**Step 1: Read existing SourceHealth test**

Read `src/pages/__tests__/SourceHealth.test.tsx` for current assertions.

**Step 2: Update SourceHealth test for new markup**

Replace `src/pages/__tests__/SourceHealth.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourceHealth } from "../SourceHealth.js";

describe("SourceHealth", () => {
  it("renders heading", () => {
    render(<SourceHealth sources={{}} />);
    expect(screen.getByText("SOURCES")).toBeTruthy();
  });

  it("shows empty state", () => {
    render(<SourceHealth sources={{}} />);
    expect(screen.getByText(/no sources/i)).toBeTruthy();
  });

  it("renders source rows with status", () => {
    const sources = {
      yahoo: {
        sourceId: "yahoo",
        status: "healthy" as const,
        latencyMs: 42,
        failCount: 0,
        lastSeen: Date.now(),
      },
      polygon: {
        sourceId: "polygon",
        status: "degraded" as const,
        latencyMs: 350,
        failCount: 2,
        lastSeen: Date.now(),
      },
    };
    render(<SourceHealth sources={sources} />);
    expect(screen.getByText("yahoo")).toBeTruthy();
    expect(screen.getByText("HEALTHY")).toBeTruthy();
    expect(screen.getByText("polygon")).toBeTruthy();
    expect(screen.getByText("DEGRADED")).toBeTruthy();
  });
});
```

**Step 3: Restyle SourceHealth component**

Replace `src/pages/SourceHealth.tsx`:
```tsx
import type { SourceHealth as SH } from "@finwatch/shared";

type Props = { sources: Record<string, SH> };

const statusColorClass: Record<string, string> = {
  healthy: "text-severity-low",
  degraded: "text-severity-medium",
  offline: "text-severity-critical",
};

export function SourceHealth({ sources }: Props) {
  const entries = Object.values(sources);
  return (
    <div>
      <h2 className="text-text-muted text-xs uppercase tracking-widest mb-4">Sources</h2>
      {entries.length === 0 ? (
        <p className="text-text-muted text-xs">No sources configured.</p>
      ) : (
        <div>
          <div className="flex gap-4 px-3 py-1.5 text-xs text-text-muted border-b border-border">
            <span className="w-32">SOURCE</span>
            <span className="w-24">STATUS</span>
            <span className="w-20 text-right">LATENCY</span>
            <span className="w-16 text-right">FAILS</span>
            <span className="flex-1 text-right">LAST SEEN</span>
          </div>
          {entries.map((s, i) => (
            <div
              key={s.sourceId}
              className={`flex gap-4 px-3 py-1.5 text-xs ${
                i % 2 === 0 ? "bg-bg-surface" : "bg-bg-primary"
              }`}
            >
              <span className="w-32 font-bold">{s.sourceId}</span>
              <span className={`w-24 ${statusColorClass[s.status] ?? "text-text-muted"}`}>
                {s.status.toUpperCase()}
              </span>
              <span className="w-20 text-right">{s.latencyMs}ms</span>
              <span className="w-16 text-right">{s.failCount}</span>
              <span className="flex-1 text-right text-text-muted">
                {new Date(s.lastSeen).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/pages/__tests__/SourceHealth.test.tsx`
Expected: 3 tests PASS.

**Step 5: Commit**

```bash
git add src/pages/SourceHealth.tsx src/pages/__tests__/SourceHealth.test.tsx
git commit -m "feat(ui): restyle SourceHealth as terminal table"
```

---

## Task 9: Restyle Settings Page

**Files:**
- Modify: `src/pages/Settings.tsx:1-21`
- Modify: `src/pages/__tests__/Settings.test.tsx`

**Step 1: Read existing Settings test**

Read `src/pages/__tests__/Settings.test.tsx` for current assertions.

**Step 2: Update Settings test for new markup**

Replace `src/pages/__tests__/Settings.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Settings } from "../Settings.js";

describe("Settings", () => {
  it("renders heading", () => {
    render(<Settings config="{}" onSave={vi.fn()} />);
    expect(screen.getByText("SETTINGS")).toBeTruthy();
  });

  it("renders config textarea", () => {
    render(<Settings config='{"key":"val"}' onSave={vi.fn()} />);
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("calls onSave with current value", () => {
    const handler = vi.fn();
    render(<Settings config="{}" onSave={handler} />);
    fireEvent.click(screen.getByText("SAVE"));
    expect(handler).toHaveBeenCalledWith("{}");
  });
});
```

**Step 3: Restyle Settings component**

Replace `src/pages/Settings.tsx`:
```tsx
import { useState } from "react";

type Props = { config: string; onSave: (config: string) => void };

export function Settings({ config, onSave }: Props) {
  const [value, setValue] = useState(config);
  return (
    <div>
      <h2 className="text-text-muted text-xs uppercase tracking-widest mb-4">Settings</h2>
      <div className="bg-bg-surface border border-border rounded-sm p-1">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={20}
          className="w-full bg-bg-primary text-text-primary text-xs p-3 rounded-sm border-none outline-none resize-y font-mono"
        />
      </div>
      <button
        onClick={() => onSave(value)}
        className="mt-3 px-3 py-1.5 text-xs border border-border rounded-sm text-accent hover:bg-bg-elevated cursor-pointer bg-transparent font-mono"
      >
        SAVE
      </button>
    </div>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/pages/__tests__/Settings.test.tsx`
Expected: 3 tests PASS.

**Step 5: Commit**

```bash
git add src/pages/Settings.tsx src/pages/__tests__/Settings.test.tsx
git commit -m "feat(ui): restyle Settings as terminal editor"
```

---

## Task 10: Clean Up — Remove Old CSS and Inline Styles

**Files:**
- Delete: `src/App.css`
- Verify: No remaining inline `style={}` in any `src/` file

**Step 1: Delete App.css**

Run: `rm src/App.css`

**Step 2: Verify no file imports App.css**

Run: `grep -r "App.css" src/`
Expected: No results.

**Step 3: Verify no inline styles remain in pages**

Run: `grep -rn "style={{" src/pages/ src/components/ src/App.tsx`
Expected: No results.

**Step 4: Run full test suite**

Run: `pnpm test`
Expected: All tests pass.

**Step 5: Run build**

Run: `pnpm build`
Expected: Build succeeds with no errors.

**Step 6: Commit**

```bash
git add -u
git commit -m "chore(ui): remove App.css and verify no inline styles remain"
```
