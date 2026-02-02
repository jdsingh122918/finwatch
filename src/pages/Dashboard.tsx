import type { DataTick } from "@finwatch/shared";

type Props = { ticks: DataTick[] };

export function Dashboard({ ticks }: Props) {
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
      <h1>Dashboard</h1>
      {ticks.length === 0 ? (
        <p>No data yet. Waiting for data sources...</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
            gap: "12px",
          }}
        >
          {Array.from(latestBySymbol.entries()).map(([symbol, tick]) => (
            <div
              key={symbol}
              style={{
                border: "1px solid #333",
                borderRadius: 8,
                padding: 12,
              }}
            >
              <h3>{symbol}</h3>
              {Object.entries(tick.metrics).map(([key, val]) => (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                  }}
                >
                  <span>{key}</span>
                  <span>
                    {typeof val === "number" ? val.toLocaleString() : val}
                  </span>
                </div>
              ))}
              <small style={{ opacity: 0.6 }}>
                {new Date(tick.timestamp).toLocaleTimeString()}
              </small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
