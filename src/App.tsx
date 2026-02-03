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
