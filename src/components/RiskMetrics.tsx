import type { PortfolioPosition } from "@finwatch/shared";
import { formatPrice } from "../utils/format.js";

type Props = {
  positions: PortfolioPosition[];
};

export function RiskMetrics({ positions }: Props) {
  const totalExposure = positions.reduce(
    (sum, p) => sum + Math.abs(p.qty) * p.currentPrice,
    0,
  );
  const unrealizedPnl = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);
  const largest = positions.length > 0
    ? positions.reduce((max, p) =>
        Math.abs(p.qty) * p.currentPrice > Math.abs(max.qty) * max.currentPrice ? p : max,
      )
    : null;

  const metrics = [
    { label: "Total Exposure", value: formatPrice(totalExposure) },
    { label: "Unrealized P&L", value: formatPrice(unrealizedPnl), pnl: unrealizedPnl },
    { label: "Largest Position", value: largest?.symbol ?? "-" },
    { label: "Open Positions", value: String(positions.length) },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {metrics.map((m) => (
        <div key={m.label} className="bg-bg-surface border border-border rounded-sm p-3">
          <div className="text-text-muted text-[10px] uppercase tracking-widest mb-1">
            {m.label}
          </div>
          <div
            className={`text-sm font-bold ${
              m.pnl !== undefined
                ? m.pnl > 0
                  ? "text-accent"
                  : m.pnl < 0
                    ? "text-severity-critical"
                    : "text-text-primary"
                : "text-text-primary"
            }`}
          >
            {m.value}
          </div>
        </div>
      ))}
    </div>
  );
}
