import { createStore } from "zustand/vanilla";
import type { BacktestResult, BacktestProgress } from "@finwatch/shared";

type BacktestState = {
  runs: BacktestResult[];
  activeRunId: string | null;
  progress: BacktestProgress | null;
  comparisonIds: string[];

  setActiveRunId: (id: string | null) => void;
  setProgress: (progress: BacktestProgress) => void;
  clearProgress: () => void;
  addRun: (result: BacktestResult) => void;
  removeRun: (id: string) => void;
  setComparisonIds: (ids: string[]) => void;
  setRuns: (runs: BacktestResult[]) => void;
};

export type BacktestSlice = ReturnType<typeof createBacktestSlice>;

export function createBacktestSlice() {
  return createStore<BacktestState>((set) => ({
    runs: [],
    activeRunId: null,
    progress: null,
    comparisonIds: [],

    setActiveRunId: (id) => set({ activeRunId: id }),

    setProgress: (progress) => set({ progress }),

    clearProgress: () => set({ progress: null }),

    addRun: (result) =>
      set((state) => ({
        runs: [result, ...state.runs.filter((r) => r.id !== result.id)],
      })),

    removeRun: (id) =>
      set((state) => ({
        runs: state.runs.filter((r) => r.id !== id),
        comparisonIds: state.comparisonIds.filter((cid) => cid !== id),
      })),

    setComparisonIds: (ids) => set({ comparisonIds: ids }),

    setRuns: (runs) => set({ runs }),
  }));
}
