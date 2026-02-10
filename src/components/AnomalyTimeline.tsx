import type { Anomaly } from "@finwatch/shared";

type Props = {
  anomalies: Anomaly[];
  width?: number;
  height?: number;
};

const severityColor: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#eab308",
  low: "#22c55e",
};

export function AnomalyTimeline({
  anomalies,
  width = 600,
  height = 40,
}: Props) {
  if (anomalies.length === 0) {
    return <p className="text-text-muted text-xs">No anomalies to display.</p>;
  }

  const sorted = [...anomalies].sort((a, b) => a.timestamp - b.timestamp);
  const minTime = sorted[0]!.timestamp;
  const maxTime = sorted[sorted.length - 1]!.timestamp;
  const timeRange = maxTime - minTime || 1;

  const padding = 12;
  const usableWidth = width - padding * 2;
  const cy = height / 2;

  return (
    <svg width={width} height={height} className="w-full">
      {/* baseline */}
      <line
        x1={padding}
        y1={cy}
        x2={width - padding}
        y2={cy}
        stroke="#222222"
        strokeWidth={1}
      />
      {sorted.map((a) => {
        const cx = padding + ((a.timestamp - minTime) / timeRange) * usableWidth;
        return (
          <circle
            key={a.id}
            cx={cx}
            cy={cy}
            r={4}
            fill={severityColor[a.severity] ?? "#666666"}
          >
            <title>{`${a.symbol || a.source}: ${a.description}`}</title>
          </circle>
        );
      })}
    </svg>
  );
}
