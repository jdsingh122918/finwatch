import { useMemo, useState, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "./components/Sidebar";
import { StatusBar } from "./components/StatusBar";
import { useAgentEvents } from "./hooks/use-agent-events";
import { Dashboard } from "./pages/Dashboard";
import { AnomalyFeed } from "./pages/AnomalyFeed";
import { AgentLog } from "./pages/AgentLog";
import { SourceHealth } from "./pages/SourceHealth";
import { Settings } from "./pages/Settings";
import { BacktestConfigPage } from "./pages/BacktestConfig";
import { BacktestResults } from "./pages/BacktestResults";
import { createDataSlice } from "./store/data-slice";
import { createAnomalySlice } from "./store/anomaly-slice";
import { createAgentSlice } from "./store/agent-slice";
import { createTradingSlice } from "./store/trading-slice";
import { createBacktestSlice } from "./store/backtest-slice";
import type { SourceHealth as SH } from "@finwatch/shared";

const tabs = ["Dashboard", "Anomalies", "Agent", "Sources", "Backtest", "Settings"] as const;
type Tab = (typeof tabs)[number];

const dataStore = createDataSlice();
const anomalyStore = createAnomalySlice();
const agentStore = createAgentSlice();
const tradingStore = createTradingSlice();
const backtestStore = createBacktestSlice();

declare global {
  interface Window {
    __stores: {
      data: typeof dataStore;
      anomaly: typeof anomalyStore;
      agent: typeof agentStore;
      trading: typeof tradingStore;
      backtest: typeof backtestStore;
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
  backtest: backtestStore,
  sources: sourcesStore,
};

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("Dashboard");

  const dataState = useSyncExternalStore(dataStore.subscribe, dataStore.getState);
  const anomalyState = useSyncExternalStore(anomalyStore.subscribe, anomalyStore.getState);
  const agentState = useSyncExternalStore(agentStore.subscribe, agentStore.getState);
  const sourceState = useSyncExternalStore(sourcesStore.subscribe, sourcesStore.getState);
  const tradingState = useSyncExternalStore(tradingStore.subscribe, tradingStore.getState);
  const backtestState = useSyncExternalStore(backtestStore.subscribe, backtestStore.getState);

  const eventStores = useMemo(() => ({
    addTick: (tick: import("@finwatch/shared").DataTick) => dataStore.getState().addTick(tick),
    addAnomaly: (a: import("@finwatch/shared").Anomaly) => anomalyStore.getState().addAnomaly(a),
    addActivity: (a: import("@finwatch/shared").AgentActivity) => agentStore.getState().addActivity(a),
    setSources: (s: Record<string, SH>) => {
      sourcesStore.setState({ ...sourceState.sources, ...s });
    },
  }), [sourceState.sources]);

  useAgentEvents(eventStores);

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
        {activeTab === "Backtest" && (() => {
          const selectedRun = backtestState.activeRunId
            ? backtestState.runs.find((r) => r.id === backtestState.activeRunId)
            : null;
          return selectedRun ? (
            <BacktestResults
              result={selectedRun}
              onBack={() => backtestStore.getState().setActiveRunId(null)}
            />
          ) : (
            <BacktestConfigPage
              progress={backtestState.progress}
              onProgress={(p) => backtestStore.getState().setProgress(p)}
              onComplete={(id) => {
                backtestStore.getState().clearProgress();
                backtestStore.getState().setActiveRunId(id);
              }}
              runs={backtestState.runs.map((r) => ({
                id: r.id,
                status: r.status,
                startDate: r.config.startDate,
                endDate: r.config.endDate,
                totalReturnPct: r.metrics?.totalReturnPct,
              }))}
              onViewResult={(id) => backtestStore.getState().setActiveRunId(id)}
            />
          );
        })()}
        {activeTab === "Settings" && (
          <Settings
            agentRunning={agentState.status.state === "running"}
            onCredentialsSave={(keyId, secret) => {
              invoke("credentials_set", { mode: "paper", keyId, secretKey: secret });
            }}
            onConfigSave={(config) => {
              invoke("config_update", { patch: JSON.stringify(config) });
            }}
            onAgentStart={() => {
              invoke("agent_start", { config: {} });
            }}
            onAgentStop={() => {
              invoke("agent_stop");
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
