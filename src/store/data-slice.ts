import { createStore } from "zustand/vanilla";
import type { DataTick } from "@finwatch/shared";

const MAX_TICKS = 100;

type DataState = {
  ticks: DataTick[];
  addTick: (tick: DataTick) => void;
  clearTicks: () => void;
  latestBySymbol: () => Map<string, DataTick>;
};

export type DataSlice = ReturnType<typeof createDataSlice>;

export function createDataSlice() {
  return createStore<DataState>((set, get) => ({
    ticks: [],
    addTick: (tick) => {
      console.log("[data-slice] addTick called", tick.symbol, tick.sourceId);
      set((state) => ({
        ticks: [...state.ticks, tick].slice(-MAX_TICKS),
      }));
    },
    clearTicks: () => set({ ticks: [] }),
    latestBySymbol: () => {
      const map = new Map<string, DataTick>();
      for (const tick of get().ticks) {
        if (tick.symbol) {
          const existing = map.get(tick.symbol);
          if (!existing || tick.timestamp > existing.timestamp) {
            map.set(tick.symbol, tick);
          }
        }
      }
      return map;
    },
  }));
}
