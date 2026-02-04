type Props = {
  symbols: string[];
  onRemove: (symbol: string) => void;
  softLimit?: number;
};

export function SymbolChips({ symbols, onRemove, softLimit }: Props) {
  return (
    <div className="flex flex-wrap gap-1.5 items-center">
      {symbols.length === 0 && (
        <span className="text-text-muted text-xs">No symbols selected</span>
      )}
      {symbols.map((symbol) => (
        <span
          key={symbol}
          className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-bg-elevated border border-border rounded-sm text-accent font-mono"
        >
          {symbol}
          <button
            onClick={() => onRemove(symbol)}
            className="text-text-muted hover:text-severity-critical cursor-pointer bg-transparent border-none text-xs leading-none"
            aria-label={`Remove ${symbol}`}
          >
            ×
          </button>
        </span>
      ))}
      {softLimit !== undefined && symbols.length > 0 && (
        <span className={`text-xs ml-1 ${symbols.length > softLimit ? "text-severity-high" : "text-text-muted"}`}>
          {symbols.length}/{softLimit}
        </span>
      )}
    </div>
  );
}
