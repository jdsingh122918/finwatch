import type { SourceHealth as SH } from "@finwatch/shared";

type Props = { sources: Record<string, SH> };

const statusColorClass: Record<string, string> = {
  healthy: "text-severity-low",
  degraded: "text-severity-medium",
  offline: "text-severity-critical",
};

export function SourceHealth({ sources }: Props) {
  const entries = Object.values(sources);
  return (
    <div>
      <h2 className="text-text-muted text-xs uppercase tracking-widest mb-4">Sources</h2>
      {entries.length === 0 ? (
        <p className="text-text-muted text-xs">No sources configured.</p>
      ) : (
        <div>
          <div className="flex gap-4 px-3 py-1.5 text-xs text-text-muted border-b border-border">
            <span className="w-32">SOURCE</span>
            <span className="w-24">STATUS</span>
            <span className="w-20 text-right">LATENCY</span>
            <span className="w-16 text-right">FAILS</span>
            <span className="flex-1 text-right">LAST SEEN</span>
          </div>
          {entries.map((s, i) => (
            <div
              key={s.sourceId}
              className={`flex gap-4 px-3 py-1.5 text-xs ${
                i % 2 === 0 ? "bg-bg-surface" : "bg-bg-primary"
              }`}
            >
              <span className="w-32 font-bold">{s.sourceId}</span>
              <span className={`w-24 ${statusColorClass[s.status] ?? "text-text-muted"}`}>
                {s.status.toUpperCase()}
              </span>
              <span className="w-20 text-right">{s.latencyMs}ms</span>
              <span className="w-16 text-right">{s.failCount}</span>
              <span className="flex-1 text-right text-text-muted">
                {new Date(s.lastSuccess).toLocaleTimeString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
