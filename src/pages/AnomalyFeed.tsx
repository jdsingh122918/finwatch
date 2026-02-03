import type { Anomaly, FeedbackVerdict } from "@finwatch/shared";

type Props = {
  anomalies: Anomaly[];
  feedbackMap: Map<string, FeedbackVerdict>;
  onFeedback: (id: string, verdict: FeedbackVerdict) => void;
};

const severityColorClass: Record<string, string> = {
  critical: "bg-severity-critical",
  high: "bg-severity-high",
  medium: "bg-severity-medium",
  low: "bg-severity-low",
};

export function AnomalyFeed({ anomalies, feedbackMap, onFeedback }: Props) {
  return (
    <div>
      <h2 className="text-text-muted text-xs uppercase tracking-widest mb-4">Anomaly Feed</h2>
      {anomalies.length === 0 ? (
        <p className="text-text-muted">No anomalies detected yet.</p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {anomalies.map((a) => {
            const feedback = feedbackMap.get(a.id);
            return (
              <div
                key={a.id}
                className="flex items-center gap-3 px-3 py-2 bg-bg-surface border border-border rounded-sm hover:bg-bg-elevated transition-opacity duration-150"
              >
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${severityColorClass[a.severity] ?? "bg-text-muted"}`}
                />
                <span className="text-text-muted text-xs w-16 shrink-0">
                  {new Date(a.timestamp).toLocaleTimeString()}
                </span>
                <span className="text-accent text-xs font-bold w-14 shrink-0">
                  {a.symbol || a.source}
                </span>
                <span className="text-xs truncate flex-1">{a.description}</span>
                <div className="flex items-center gap-2 shrink-0">
                  {feedback ? (
                    <span className="text-text-muted text-xs">{feedback}</span>
                  ) : (
                    <>
                      <button
                        onClick={() => onFeedback(a.id, "confirmed")}
                        className="text-[10px] px-1.5 py-0.5 border border-border rounded-sm text-text-muted hover:text-accent hover:border-accent cursor-pointer bg-transparent"
                      >
                        CONFIRM
                      </button>
                      <button
                        onClick={() => onFeedback(a.id, "false_positive")}
                        className="text-[10px] px-1.5 py-0.5 border border-border rounded-sm text-text-muted hover:text-severity-high hover:border-severity-high cursor-pointer bg-transparent"
                      >
                        FALSE+
                      </button>
                      <button
                        onClick={() => onFeedback(a.id, "needs_review")}
                        className="text-[10px] px-1.5 py-0.5 border border-border rounded-sm text-text-muted hover:text-severity-medium hover:border-severity-medium cursor-pointer bg-transparent"
                      >
                        REVIEW
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
