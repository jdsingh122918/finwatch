import { useState } from "react";
import { Dashboard } from "./pages/Dashboard";
import { AnomalyFeed } from "./pages/AnomalyFeed";
import { AgentLog } from "./pages/AgentLog";
import { SourceHealth } from "./pages/SourceHealth";
import { Settings } from "./pages/Settings";
import type { FeedbackVerdict } from "@finwatch/shared";

const tabs = ["Dashboard", "Anomalies", "Agent", "Sources", "Settings"] as const;
type Tab = (typeof tabs)[number];

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>("Dashboard");

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

      {activeTab === "Dashboard" && <Dashboard ticks={[]} />}
      {activeTab === "Anomalies" && (
        <AnomalyFeed
          anomalies={[]}
          feedbackMap={new Map()}
          onFeedback={(id: string, v: FeedbackVerdict) => {
            console.log(id, v);
          }}
        />
      )}
      {activeTab === "Agent" && (
        <AgentLog
          status={{ state: "idle", totalCycles: 0, totalAnomalies: 0, uptime: 0 }}
          log={[]}
        />
      )}
      {activeTab === "Sources" && <SourceHealth sources={{}} />}
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
