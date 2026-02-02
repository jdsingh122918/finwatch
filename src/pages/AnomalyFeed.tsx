import type { Anomaly, FeedbackVerdict } from "@finwatch/shared";

type Props = {
  anomalies: Anomaly[];
  feedbackMap: Map<string, FeedbackVerdict>;
  onFeedback: (id: string, verdict: FeedbackVerdict) => void;
};

const severityColors: Record<string, string> = {
  critical: "#ff4444",
  high: "#ff8800",
  medium: "#ffcc00",
  low: "#88cc00",
};

export function AnomalyFeed({ anomalies, feedbackMap, onFeedback }: Props) {
  if (anomalies.length === 0)
    return (
      <div>
        <h1>Anomaly Feed</h1>
        <p>No anomalies detected yet.</p>
      </div>
    );

  return (
    <div>
      <h1>Anomaly Feed</h1>
      {anomalies.map((a) => {
        const feedback = feedbackMap.get(a.id);
        return (
          <div
            key={a.id}
            style={{
              border: "1px solid #333",
              borderRadius: 8,
              padding: 12,
              marginBottom: 8,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span
                style={{
                  color: severityColors[a.severity] || "#fff",
                  fontWeight: "bold",
                }}
              >
                {a.severity.toUpperCase()}
              </span>
              <span>{a.symbol || a.source}</span>
              <small>{new Date(a.timestamp).toLocaleString()}</small>
            </div>
            <p>{a.description}</p>
            {feedback ? (
              <span style={{ opacity: 0.7 }}>Feedback: {feedback}</span>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => onFeedback(a.id, "confirmed")}>
                  Confirm
                </button>
                <button onClick={() => onFeedback(a.id, "false_positive")}>
                  False Positive
                </button>
                <button onClick={() => onFeedback(a.id, "needs_review")}>
                  Needs Review
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
