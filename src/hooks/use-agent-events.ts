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

    listen<DataTick>("data:tick", (e) => stores.addTick(e.payload))
      .then((fn) => unlisteners.push(fn));

    listen<Anomaly>("anomaly:detected", (e) => stores.addAnomaly(e.payload))
      .then((fn) => unlisteners.push(fn));

    listen<AgentActivity>("agent:activity", (e) => stores.addActivity(e.payload))
      .then((fn) => unlisteners.push(fn));

    listen<SourceHealth>("source:health-change", (e) => {
      stores.setSources({ [e.payload.sourceId]: e.payload });
    }).then((fn) => unlisteners.push(fn));

    return () => unlisteners.forEach((fn) => fn());
  }, [stores]);
}
