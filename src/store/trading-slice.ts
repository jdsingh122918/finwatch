import { createStore } from "zustand/vanilla";
import type {
  TradeSuggestion,
  PortfolioPosition,
  TradeAuditEntry,
  TradingMode,
  SuggestionStatus,
} from "@finwatch/shared";

const MAX_HISTORY = 500;

type TradingState = {
  suggestions: TradeSuggestion[];
  positions: PortfolioPosition[];
  history: TradeAuditEntry[];
  mode: TradingMode;
  killSwitchActive: boolean;
  addSuggestion: (s: TradeSuggestion) => void;
  updateSuggestionStatus: (id: string, status: SuggestionStatus) => void;
  getPendingSuggestions: () => TradeSuggestion[];
  setPositions: (positions: PortfolioPosition[]) => void;
  addHistoryEntry: (entry: TradeAuditEntry) => void;
  setMode: (mode: TradingMode) => void;
  setKillSwitch: (active: boolean) => void;
  clear: () => void;
};

export type TradingSlice = ReturnType<typeof createTradingSlice>;

export function createTradingSlice() {
  return createStore<TradingState>((set, get) => ({
    suggestions: [],
    positions: [],
    history: [],
    mode: "paper",
    killSwitchActive: false,

    addSuggestion: (s) =>
      set((state) => ({ suggestions: [...state.suggestions, s] })),

    updateSuggestionStatus: (id, status) =>
      set((state) => ({
        suggestions: state.suggestions.map((s) =>
          s.id === id ? { ...s, status } : s,
        ),
      })),

    getPendingSuggestions: () =>
      get().suggestions.filter((s) => s.status === "pending"),

    setPositions: (positions) => set({ positions }),

    addHistoryEntry: (entry) =>
      set((state) => ({
        history: [...state.history, entry].slice(-MAX_HISTORY),
      })),

    setMode: (mode) => set({ mode }),

    setKillSwitch: (active) => set({ killSwitchActive: active }),

    clear: () =>
      set({
        suggestions: [],
        positions: [],
        history: [],
        mode: "paper",
        killSwitchActive: false,
      }),
  }));
}
