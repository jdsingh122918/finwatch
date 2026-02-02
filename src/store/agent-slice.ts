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
    setStatus: (update) =>
      set((state) => ({ status: { ...state.status, ...update } })),
    addActivity: (a) =>
      set((state) => ({
        activityLog: [...state.activityLog, a].slice(-MAX_LOG),
      })),
    clearLog: () => set({ activityLog: [] }),
  }));
}
