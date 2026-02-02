import type { AgentStatus, AgentActivity } from "@finwatch/shared";

type Props = { status: AgentStatus; log: AgentActivity[] };

const stateColors: Record<string, string> = {
  running: "#44ff44",
  idle: "#888",
  paused: "#ffcc00",
  error: "#ff4444",
};

export function AgentLog({ status, log }: Props) {
  return (
    <div>
      <h1>Agent Activity</h1>
      <div
        style={{
          display: "flex",
          gap: 16,
          marginBottom: 16,
          padding: 12,
          border: "1px solid #333",
          borderRadius: 8,
        }}
      >
        <span>
          State:{" "}
          <strong style={{ color: stateColors[status.state] }}>
            {status.state}
          </strong>
        </span>
        <span>Cycles: {status.totalCycles}</span>
        <span>Anomalies: {status.totalAnomalies}</span>
        <span>Uptime: {Math.floor(status.uptime / 60)}m</span>
      </div>
      {log.length === 0 ? (
        <p>No activity yet.</p>
      ) : (
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 13,
            maxHeight: 400,
            overflow: "auto",
          }}
        >
          {log.map((entry, i) => (
            <div
              key={i}
              style={{ padding: "4px 0", borderBottom: "1px solid #222" }}
            >
              <span style={{ opacity: 0.5 }}>
                {new Date(entry.timestamp).toLocaleTimeString()}
              </span>{" "}
              <span
                style={{ color: entry.type === "error" ? "#ff4444" : "#ccc" }}
              >
                [{entry.type}]
              </span>{" "}
              {entry.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
