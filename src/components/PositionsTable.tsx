import type { PortfolioPosition } from "@finwatch/shared";
import { formatPrice } from "../utils/format.js";

type Props = {
  positions: PortfolioPosition[];
};

export function PositionsTable({ positions }: Props) {
  if (positions.length === 0) {
    return <p className="text-text-muted text-xs">No open positions.</p>;
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-text-muted text-left border-b border-border">
          <th className="py-1.5 font-normal">Symbol</th>
          <th className="py-1.5 font-normal">Qty</th>
          <th className="py-1.5 font-normal">Entry</th>
          <th className="py-1.5 font-normal">Current</th>
          <th className="py-1.5 font-normal text-right">P&L</th>
        </tr>
      </thead>
      <tbody>
        {positions.map((p) => (
          <tr key={p.symbol} className="border-b border-border">
            <td className="py-1.5 text-accent font-bold">{p.symbol}</td>
            <td className="py-1.5">{p.qty}</td>
            <td className="py-1.5">{formatPrice(p.avgEntry)}</td>
            <td className="py-1.5">{formatPrice(p.currentPrice)}</td>
            <td
              className={`py-1.5 text-right ${
                p.unrealizedPnl > 0
                  ? "text-accent"
                  : p.unrealizedPnl < 0
                    ? "text-severity-critical"
                    : "text-text-muted"
              }`}
            >
              {p.unrealizedPnl < 0 ? `-${formatPrice(Math.abs(p.unrealizedPnl))}` : formatPrice(p.unrealizedPnl)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
