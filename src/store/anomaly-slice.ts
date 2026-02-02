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
    addAnomaly: (a) =>
      set((state) => ({
        anomalies: [a, ...state.anomalies].slice(0, 500),
      })),
    addFeedback: (anomalyId, verdict) =>
      set((state) => {
        const newMap = new Map(state.feedbackMap);
        newMap.set(anomalyId, verdict);
        return { feedbackMap: newMap };
      }),
    filterBySeverity: (severity) =>
      get().anomalies.filter((a) => a.severity === severity),
    clear: () => set({ anomalies: [], feedbackMap: new Map() }),
  }));
}
