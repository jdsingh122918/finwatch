import type { TradeAuditEntry } from "@finwatch/shared";

type Props = {
  entries: TradeAuditEntry[];
};

const outcomeColor: Record<string, string> = {
  profit: "text-accent",
  loss: "text-severity-critical",
  pending: "text-severity-medium",
  cancelled: "text-text-muted",
};

export function TradeHistory({ entries }: Props) {
  return (
    <div>
      <h3 className="text-text-muted text-[10px] uppercase tracking-widest mb-2">
        Trade History
      </h3>
      {entries.length === 0 ? (
        <p className="text-text-muted text-xs">No trade history.</p>
      ) : (
        <table className="w-full text-xs">
          <thead>
            <tr className="text-text-muted text-left border-b border-border">
              <th className="py-1.5 font-normal">Time</th>
              <th className="py-1.5 font-normal">Symbol</th>
              <th className="py-1.5 font-normal">Side</th>
              <th className="py-1.5 font-normal">Qty</th>
              <th className="py-1.5 font-normal text-right">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-border">
                <td className="py-1.5 text-text-muted">
                  {new Date(e.timestamp).toLocaleTimeString()}
                </td>
                <td className="py-1.5 text-accent font-bold">{e.action.symbol}</td>
                <td className="py-1.5">{e.action.side.toUpperCase()}</td>
                <td className="py-1.5">{e.action.qty}</td>
                <td className={`py-1.5 text-right ${outcomeColor[e.outcome] ?? "text-text-muted"}`}>
                  {e.outcome}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
