import type { TradeSuggestion } from "@finwatch/shared";

type Props = {
  suggestions: TradeSuggestion[];
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
};

export function TradeSuggestions({ suggestions, onApprove, onDismiss }: Props) {
  const pending = suggestions.filter((s) => s.status === "pending");

  return (
    <div>
      <h3 className="text-text-muted text-[10px] uppercase tracking-widest mb-2">
        Trade Suggestions
      </h3>
      {pending.length === 0 ? (
        <p className="text-text-muted text-xs">No pending suggestions.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {pending.map((s) => (
            <div
              key={s.id}
              className="bg-bg-surface border border-border rounded-sm p-3"
            >
              <div className="flex items-center gap-3 mb-1">
                <span className="text-accent font-bold text-xs">{s.action.symbol}</span>
                <span
                  className={`text-[10px] font-bold ${
                    s.action.side === "buy" ? "text-accent" : "text-severity-high"
                  }`}
                >
                  {s.action.side.toUpperCase()}
                </span>
                <span className="text-xs">{s.action.qty}</span>
                <span className="text-text-muted text-[10px]">
                  {Math.round(s.action.confidence * 100)}%
                </span>
              </div>
              <p className="text-text-muted text-xs mb-2">{s.action.rationale}</p>
              <div className="flex gap-2">
                <button
                  onClick={() => onApprove(s.id)}
                  className="text-[10px] px-2 py-0.5 border border-accent rounded-sm text-accent hover:bg-bg-elevated cursor-pointer bg-transparent font-mono"
                >
                  APPROVE
                </button>
                <button
                  onClick={() => onDismiss(s.id)}
                  className="text-[10px] px-2 py-0.5 border border-border rounded-sm text-text-muted hover:text-text-primary cursor-pointer bg-transparent font-mono"
                >
                  DISMISS
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
