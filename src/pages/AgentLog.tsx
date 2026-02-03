import type { AgentStatus, AgentActivity } from "@finwatch/shared";

type Props = { status: AgentStatus; log: AgentActivity[] };

const stateColorClass: Record<string, string> = {
  running: "text-state-running",
  idle: "text-state-idle",
  paused: "text-state-paused",
  error: "text-state-error",
};

export function AgentLog({ status, log }: Props) {
  return (
    <div>
      <h2 className="text-text-muted text-xs uppercase tracking-widest mb-4">Agent</h2>

      <div className="flex items-center gap-6 mb-4 text-xs">
        <span className="flex items-center gap-1.5">
          state:
          <span className={`font-bold ${stateColorClass[status.state] ?? "text-state-idle"}`}>
            {status.state.toUpperCase()}
          </span>
        </span>
        <span>
          cycles: <span className="text-text-primary">{status.totalCycles}</span>
        </span>
        <span>
          anomalies: <span className="text-text-primary">{status.totalAnomalies}</span>
        </span>
        <span>
          uptime: <span className="text-text-primary">{Math.floor(status.uptime / 60)}m</span>
        </span>
      </div>

      {log.length === 0 ? (
        <p className="text-text-muted text-xs">No activity yet.</p>
      ) : (
        <div className="max-h-[calc(100vh-12rem)] overflow-y-auto text-xs">
          {log.map((entry, i) => (
            <div key={i} className="py-1 border-b border-bg-elevated flex gap-2">
              <span className="text-text-muted w-20 shrink-0">
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>
              <span
                className={
                  entry.type === "error" ? "text-severity-critical" : "text-text-muted"
                }
              >
                [{entry.type}]
              </span>
              <span>{entry.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
