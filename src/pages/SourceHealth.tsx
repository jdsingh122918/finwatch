import type { SourceHealth as SH } from "@finwatch/shared";

type Props = { sources: Record<string, SH> };

const statusColors: Record<string, string> = {
  healthy: "#44ff44",
  degraded: "#ffcc00",
  offline: "#ff4444",
};

export function SourceHealth({ sources }: Props) {
  const entries = Object.values(sources);
  return (
    <div>
      <h1>Source Health</h1>
      {entries.length === 0 ? (
        <p>No sources configured.</p>
      ) : (
        <div>
          {entries.map((s) => (
            <div
              key={s.sourceId}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: 8,
                borderBottom: "1px solid #333",
              }}
            >
              <span>{s.sourceId}</span>
              <span style={{ color: statusColors[s.status] || "#888" }}>
                {s.status}
              </span>
              <span>{s.latencyMs}ms</span>
              <span>fails: {s.failCount}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
