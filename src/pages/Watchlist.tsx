import { useEffect } from "react";
import type { Asset } from "../store/watchlist-slice.js";

const SOFT_LIMIT = 20;

type Props = {
  assets: Asset[];
  watchlist: string[];
  pendingChanges: boolean;
  searchQuery: string;
  categoryFilter: string;
  loading: boolean;
  error: string | null;
  onAddSymbol: (symbol: string) => void;
  onRemoveSymbol: (symbol: string) => void;
  onSearchChange: (query: string) => void;
  onCategoryChange: (filter: string) => void;
  onApplyChanges: () => void;
  onFetchAssets: () => void;
};

export function Watchlist({
  assets,
  watchlist,
  pendingChanges,
  searchQuery,
  categoryFilter,
  loading,
  error,
  onAddSymbol,
  onRemoveSymbol,
  onSearchChange,
  onCategoryChange,
  onApplyChanges,
  onFetchAssets,
}: Props) {
  // Auto-fetch assets on mount when empty
  useEffect(() => {
    if (assets.length === 0 && !loading && !error) {
      onFetchAssets();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const watchlistSet = new Set(watchlist);

  // Derive unique categories from assets
  const categories = ["all", ...new Set(assets.map((a) => a.asset_class))];

  // Filter assets
  const filtered = assets.filter((asset) => {
    const matchesSearch =
      searchQuery === "" ||
      asset.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      categoryFilter === "all" || asset.asset_class === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  // Sort: watchlisted first, then alphabetical
  const sorted = [...filtered].sort((a, b) => {
    const aWatched = watchlistSet.has(a.symbol) ? 0 : 1;
    const bWatched = watchlistSet.has(b.symbol) ? 0 : 1;
    if (aWatched !== bWatched) return aWatched - bWatched;
    return a.symbol.localeCompare(b.symbol);
  });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-text-muted text-xs uppercase tracking-widest">Watchlist</h2>
        <span className={`text-xs px-2 py-0.5 rounded-sm border ${
          watchlist.length > SOFT_LIMIT
            ? "border-severity-high text-severity-high"
            : "border-border text-text-muted"
        }`}>
          {watchlist.length}/{SOFT_LIMIT}
        </span>
        {pendingChanges && (
          <button
            onClick={onApplyChanges}
            className="ml-auto px-3 py-1 text-xs bg-accent text-bg-primary rounded-sm cursor-pointer border-none font-mono font-bold hover:opacity-90"
          >
            APPLY CHANGES
          </button>
        )}
      </div>

      {/* Soft limit warning */}
      {watchlist.length > SOFT_LIMIT && (
        <div className="mb-3 px-3 py-2 text-xs border border-severity-high rounded-sm text-severity-high bg-bg-surface">
          Monitoring many symbols may increase API load and slow anomaly detection.
        </div>
      )}

      {/* Filter bar */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          placeholder="Search symbols..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex-1 bg-bg-primary text-text-primary text-xs p-2 rounded-sm border border-border outline-none font-mono focus:border-accent"
        />
        <select
          value={categoryFilter}
          onChange={(e) => onCategoryChange(e.target.value)}
          className="bg-bg-primary text-text-primary text-xs p-2 rounded-sm border border-border outline-none font-mono focus:border-accent"
        >
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat === "all" ? "All Classes" : cat.replace("_", " ").toUpperCase()}
            </option>
          ))}
        </select>
      </div>

      {/* Loading state */}
      {loading && assets.length === 0 && (
        <div className="text-text-muted text-xs py-8 text-center">Loading assets...</div>
      )}

      {/* Error state */}
      {error && assets.length === 0 && (
        <div className="text-severity-critical text-xs py-8 text-center">
          <p>{error}</p>
          <button
            onClick={onFetchAssets}
            className="mt-2 px-3 py-1 text-xs border border-border rounded-sm text-accent hover:bg-bg-elevated cursor-pointer bg-transparent font-mono"
          >
            RETRY
          </button>
        </div>
      )}

      {/* Asset table */}
      {sorted.length > 0 && (
        <div className="overflow-y-auto" style={{ maxHeight: "calc(100vh - 200px)" }}>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-text-muted text-left border-b border-border">
                <th className="py-2 px-2 w-8"></th>
                <th className="py-2 px-2">Symbol</th>
                <th className="py-2 px-2">Name</th>
                <th className="py-2 px-2">Exchange</th>
                <th className="py-2 px-2">Class</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((asset) => {
                const isWatched = watchlistSet.has(asset.symbol);
                return (
                  <tr
                    key={asset.symbol}
                    className={`border-b border-border/50 hover:bg-bg-elevated ${
                      isWatched ? "border-l-2 border-l-accent" : "border-l-2 border-l-transparent"
                    }`}
                  >
                    <td className="py-1.5 px-2">
                      <input
                        type="checkbox"
                        checked={isWatched}
                        onChange={() =>
                          isWatched
                            ? onRemoveSymbol(asset.symbol)
                            : onAddSymbol(asset.symbol)
                        }
                        className="accent-accent cursor-pointer"
                      />
                    </td>
                    <td className="py-1.5 px-2 text-accent font-bold">{asset.symbol}</td>
                    <td className="py-1.5 px-2 text-text-primary">{asset.name}</td>
                    <td className="py-1.5 px-2 text-text-muted">{asset.exchange}</td>
                    <td className="py-1.5 px-2 text-text-muted">{asset.asset_class}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && assets.length === 0 && (
        <div className="text-text-muted text-xs py-8 text-center">
          <p>No assets loaded.</p>
          <button
            onClick={onFetchAssets}
            className="mt-2 px-3 py-1 text-xs border border-border rounded-sm text-accent hover:bg-bg-elevated cursor-pointer bg-transparent font-mono"
          >
            LOAD ASSETS
          </button>
        </div>
      )}
    </div>
  );
}
