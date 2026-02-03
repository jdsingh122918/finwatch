import { useState, useSyncExternalStore } from "react";
import { Dashboard } from "./pages/Dashboard";
import { AnomalyFeed } from "./pages/AnomalyFeed";
import { AgentLog } from "./pages/AgentLog";
import { SourceHealth } from "./pages/SourceHealth";
import { Settings } from "./pages/Settings";
import { createDataSlice } from "./store/data-slice";
import { createAnomalySlice } from "./store/anomaly-slice";
import { createAgentSlice } from "./store/agent-slice";
import type { SourceHealth as SH } from "@finwatch/shared";

const tabs = ["Dashboard", "Anomalies", "Agent", "Sources", "Settings"] as const;
type Tab = (typeof tabs)[number];

// Create store instances
const dataStore = createDataSlice();
const anomalyStore = createAnomalySlice();
const agentStore = createAgentSlice();

// Expose stores on window for testing
declare global {
  interface Window {
    __stores: {
      data: typeof dataStore;
      anomaly: typeof anomalyStore;
      agent: typeof agentStore;
      sources: { getState: () => { sources: Record<string, SH> }; setState: (s: Record<string, SH>) => void; subscribe: (fn: () => void) => () => void };
    };
  }
}

// Simple sources store (no zustand needed)
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
    return () => { sourcesListeners.delete(fn); };
  },
};

window.__stores = { data: dataStore, anomaly: anomalyStore, agent: agentStore, sources: sourcesStore };

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("Dashboard");

  const dataState = useSyncExternalStore(dataStore.subscribe, dataStore.getState);
  const anomalyState = useSyncExternalStore(anomalyStore.subscribe, anomalyStore.getState);
  const agentState = useSyncExternalStore(agentStore.subscribe, agentStore.getState);
  const sourceState = useSyncExternalStore(sourcesStore.subscribe, sourcesStore.getState);

  return (
    <div
      style={{
        padding: 16,
        color: "#eee",
        background: "#111",
        minHeight: "100vh",
      }}
    >
      <nav
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 16,
          borderBottom: "1px solid #333",
          paddingBottom: 8,
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "8px 16px",
              background: activeTab === tab ? "#333" : "transparent",
              color: "#eee",
              border: "none",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            {tab}
          </button>
        ))}
      </nav>

      {activeTab === "Dashboard" && <Dashboard ticks={dataState.ticks} />}
      {activeTab === "Anomalies" && (
        <AnomalyFeed
          anomalies={anomalyState.anomalies}
          feedbackMap={anomalyState.feedbackMap}
          onFeedback={(id, v) => anomalyState.addFeedback(id, v)}
        />
      )}
      {activeTab === "Agent" && (
        <AgentLog
          status={agentState.status}
          log={agentState.activityLog}
        />
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
    </div>
  );
}
