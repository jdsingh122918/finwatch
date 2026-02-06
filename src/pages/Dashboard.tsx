import type { DataTick } from "@finwatch/shared";

type Props = { ticks: DataTick[] };

export function Dashboard({ ticks }: Props) {
  console.log("[Dashboard] Rendering with", ticks.length, "ticks");

  const latestBySymbol = new Map<string, DataTick>();
  for (const tick of ticks) {
    if (tick.symbol) {
      const existing = latestBySymbol.get(tick.symbol);
      if (!existing || tick.timestamp > existing.timestamp)
        latestBySymbol.set(tick.symbol, tick);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-text-muted text-xs uppercase tracking-widest">Market Data</h2>
        <span className="text-text-muted text-xs">
          {latestBySymbol.size} symbols
        </span>
      </div>
      {ticks.length === 0 ? (
        <p className="text-text-muted">Waiting for data sources...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from(latestBySymbol.entries()).map(([symbol, tick]) => (
            <div
              key={symbol}
              className="bg-bg-surface border border-border rounded-sm p-3"
            >
              <div className="text-accent font-bold mb-2">{symbol}</div>
              {Object.entries(tick.metrics).map(([key, val]) => (
                <div key={key} className="flex justify-between text-xs py-0.5">
                  <span className="text-text-muted">{key}</span>
                  <span>{typeof val === "number" ? val.toLocaleString() : String(val)}</span>
                </div>
              ))}
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
