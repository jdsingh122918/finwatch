import { useMemo, useState } from "react";
import type { Anomaly, FeedbackVerdict, Severity } from "@finwatch/shared";
import { AnomalyTimeline } from "../components/AnomalyTimeline.js";

type AnomalyViewMode = "list" | "timeline";

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

const severityLevels: Array<Severity | "all"> = ["all", "critical", "high", "medium", "low"];

const timeOptions = [
  { label: "All Time", value: "" },
  { label: "Last 30m", value: "30m" },
  { label: "Last 1h", value: "1h" },
  { label: "Last 4h", value: "4h" },
  { label: "Last 24h", value: "24h" },
];

function parseTimeFilter(value: string): number {
  if (!value) return 0;
  const units: Record<string, number> = { m: 60_000, h: 3600_000 };
  const match = value.match(/^(\d+)([mh])$/);
  if (!match) return 0;
  return Number(match[1]) * (units[match[2]!] ?? 0);
}

export function AnomalyFeed({ anomalies, feedbackMap, onFeedback }: Props) {
  const [severityFilter, setSeverityFilter] = useState<Severity | "all">("all");
  const [symbolFilter, setSymbolFilter] = useState("");
  const [timeFilter, setTimeFilter] = useState("");
  const [viewMode, setViewMode] = useState<AnomalyViewMode>("list");

  const filtered = useMemo(() => {
    const now = Date.now();
    const sinceMs = parseTimeFilter(timeFilter);
    const cutoff = sinceMs > 0 ? now - sinceMs : 0;
    const sym = symbolFilter.trim().toUpperCase();

    return anomalies.filter((a) => {
      if (severityFilter !== "all" && a.severity !== severityFilter) return false;
      if (sym && !(a.symbol ?? "").toUpperCase().includes(sym)) return false;
      if (cutoff > 0 && a.timestamp < cutoff) return false;
      return true;
    });
  }, [anomalies, severityFilter, symbolFilter, timeFilter]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-text-muted text-xs uppercase tracking-widest">Anomaly Feed</h2>
        <div className="flex gap-1">
          {(["list", "timeline"] as const).map((mode) => (
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
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <div className="flex gap-1">
          {severityLevels.map((level) => (
            <button
              key={level}
              onClick={() => setSeverityFilter(level)}
              className={`text-[10px] px-2 py-0.5 border rounded-sm cursor-pointer bg-transparent font-mono ${
                severityFilter === level
                  ? "text-accent border-accent"
                  : "text-text-muted border-border hover:text-text-primary"
              }`}
            >
              {level.toUpperCase()}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Filter symbol..."
          value={symbolFilter}
          onChange={(e) => setSymbolFilter(e.target.value)}
          className="bg-bg-primary text-text-primary text-xs px-2 py-0.5 rounded-sm border border-border outline-none font-mono w-28 focus:border-accent"
        />
        <select
          value={timeFilter}
          onChange={(e) => setTimeFilter(e.target.value)}
          className="bg-bg-primary text-text-primary text-xs px-2 py-0.5 rounded-sm border border-border outline-none font-mono focus:border-accent"
        >
          {timeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {anomalies.length === 0 ? (
        <p className="text-text-muted">No anomalies detected yet.</p>
      ) : viewMode === "timeline" ? (
        <AnomalyTimeline anomalies={filtered} />
      ) : filtered.length === 0 ? (
        <p className="text-text-muted">No anomalies match filters.</p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {filtered.map((a) => {
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
