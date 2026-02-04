import { createStore } from "zustand/vanilla";

export type Asset = {
  symbol: string;
  name: string;
  exchange: string;
  asset_class: string;
  status: string;
};

type WatchlistState = {
  assets: Asset[];
  watchlist: string[];
  pendingChanges: boolean;
  searchQuery: string;
  categoryFilter: string;
  loading: boolean;
  error: string | null;
  addSymbol: (symbol: string) => void;
  removeSymbol: (symbol: string) => void;
  setAssets: (assets: Asset[]) => void;
  setSearchQuery: (query: string) => void;
  setCategoryFilter: (filter: string) => void;
  syncFromConfig: (symbols: string[]) => void;
  markApplied: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
};

export type WatchlistSlice = ReturnType<typeof createWatchlistSlice>;

export function createWatchlistSlice() {
  return createStore<WatchlistState>((set) => ({
    assets: [],
    watchlist: [],
    pendingChanges: false,
    searchQuery: "",
    categoryFilter: "all",
    loading: false,
    error: null,
    addSymbol: (symbol) =>
      set((state) => {
        if (state.watchlist.includes(symbol)) return state;
        return { watchlist: [...state.watchlist, symbol], pendingChanges: true };
      }),
    removeSymbol: (symbol) =>
      set((state) => ({
        watchlist: state.watchlist.filter((s) => s !== symbol),
        pendingChanges: true,
      })),
    setAssets: (assets) => set({ assets }),
    setSearchQuery: (searchQuery) => set({ searchQuery }),
    setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
    syncFromConfig: (symbols) =>
      set({ watchlist: [...new Set(symbols)], pendingChanges: false }),
    markApplied: () => set({ pendingChanges: false }),
    setLoading: (loading) => set({ loading }),
    setError: (error) => set({ error, loading: false }),
  }));
}
