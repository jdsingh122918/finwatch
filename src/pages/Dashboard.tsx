import { useState } from "react";
import type { DataTick } from "@finwatch/shared";
import { formatPrice, formatVolume, formatChange, getChangeColor } from "../utils/format.js";
import { PriceChart } from "../components/PriceChart.js";
import { Sparkline } from "../components/Sparkline.js";

type Props = { ticks: DataTick[] };
type ViewMode = "grid" | "chart";

function formatMetric(key: string, value: number): { text: string; className?: string } {
  const k = key.toLowerCase();
  if (k === "price" || k === "close" || k === "open" || k === "high" || k === "low") {
    return { text: formatPrice(value) };
  }
  if (k === "volume") {
    return { text: formatVolume(value) };
  }
  if (k === "change" || k === "changepct" || k === "change_pct") {
    return { text: formatChange(value), className: getChangeColor(value) };
  }
  return { text: typeof value === "number" ? value.toLocaleString() : String(value) };
}

export function Dashboard({ ticks }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  const latestBySymbol = new Map<string, DataTick>();
  const priceHistory = new Map<string, number[]>();
  for (const tick of ticks) {
    if (tick.symbol) {
      const existing = latestBySymbol.get(tick.symbol);
      if (!existing || tick.timestamp > existing.timestamp)
        latestBySymbol.set(tick.symbol, tick);
      const price = tick.metrics.price ?? tick.metrics.close;
      if (price !== undefined) {
        const hist = priceHistory.get(tick.symbol) ?? [];
        hist.push(price);
        priceHistory.set(tick.symbol, hist.slice(-20));
      }
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-text-muted text-xs uppercase tracking-widest">Market Data</h2>
        <div className="flex items-center gap-2">
          <span className="text-text-muted text-xs">{latestBySymbol.size} symbols</span>
          {ticks.length > 0 && (
            <div className="flex gap-1">
              {(["grid", "chart"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`text-[10px] px-2 py-0.5 border rounded-sm cursor-pointer bg-transparent font-mono ${
                    viewMode === mode
                      ? "text-accent border-accent"
                      : "text-text-muted border-border hover:text-text-primary"
                  }`}
                >
                  {mode.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {ticks.length === 0 ? (
        <p className="text-text-muted">Waiting for data sources...</p>
      ) : viewMode === "chart" ? (
        <PriceChart ticks={ticks} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from(latestBySymbol.entries()).map(([symbol, tick]) => (
            <div
              key={symbol}
              className="bg-bg-surface border border-border rounded-sm p-3"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-accent font-bold">{symbol}</span>
                {(priceHistory.get(symbol)?.length ?? 0) > 1 && (
                  <Sparkline data={priceHistory.get(symbol)!} />
                )}
              </div>
              {Object.entries(tick.metrics).map(([key, val]) => {
                const fmt = formatMetric(key, val);
                return (
                  <div key={key} className="flex justify-between text-xs py-0.5">
                    <span className="text-text-muted">{key}</span>
                    <span className={fmt.className}>{fmt.text}</span>
                  </div>
                );
              })}
              <div className="text-text-muted text-xs mt-2">
                {new Date(tick.timestamp).toLocaleTimeString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
