import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { DataTick, Anomaly, AgentActivity, SourceHealth } from "@finwatch/shared";

type Stores = {
  addTick: (tick: DataTick) => void;
  addAnomaly: (anomaly: Anomaly) => void;
  addActivity: (activity: AgentActivity) => void;
  setSources: (update: Record<string, SourceHealth>) => void;
};

export function useAgentEvents(stores: Stores): void {
  useEffect(() => {
    const unlisteners: (() => void)[] = [];

    console.log("[useAgentEvents] Setting up Tauri event listeners");

    listen<DataTick>("data:tick", (e) => {
      console.log("[useAgentEvents] data:tick received", e.payload.symbol, e.payload.sourceId);
      stores.addTick(e.payload);
    }).then((fn) => unlisteners.push(fn));

    listen<Anomaly>("anomaly:detected", (e) => {
      console.log("[useAgentEvents] anomaly:detected received");
      stores.addAnomaly(e.payload);
    }).then((fn) => unlisteners.push(fn));

    listen<AgentActivity>("agent:activity", (e) => {
      console.log("[useAgentEvents] agent:activity received", e.payload.type, e.payload.message);
      stores.addActivity(e.payload);
    }).then((fn) => unlisteners.push(fn));

    listen<SourceHealth>("source:health-change", (e) => {
      console.log("[useAgentEvents] source:health-change received", e.payload.sourceId, e.payload.status);
      stores.setSources({ [e.payload.sourceId]: e.payload });
    }).then((fn) => unlisteners.push(fn));

    return () => {
      console.log("[useAgentEvents] Cleaning up event listeners");
      unlisteners.forEach((fn) => fn());
    };
  }, [stores]);
}
