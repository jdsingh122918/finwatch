import type {
  TradingMode,
  TradeSuggestion,
  PortfolioPosition,
  TradeAuditEntry,
} from "@finwatch/shared";
import { KillSwitch } from "../components/KillSwitch.js";
import { RiskMetrics } from "../components/RiskMetrics.js";
import { TradeSuggestions } from "../components/TradeSuggestions.js";
import { PositionsTable } from "../components/PositionsTable.js";
import { TradeHistory } from "../components/TradeHistory.js";

type Props = {
  mode: TradingMode;
  killSwitchActive: boolean;
  suggestions: TradeSuggestion[];
  positions: PortfolioPosition[];
  history: TradeAuditEntry[];
  onApprove: (id: string) => void;
  onDismiss: (id: string) => void;
  onKillSwitch: () => void;
};

export function TradingHub({
  mode,
  killSwitchActive,
  suggestions,
  positions,
  history,
  onApprove,
  onDismiss,
  onKillSwitch,
}: Props) {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-text-muted text-xs uppercase tracking-widest">Trading Hub</h2>
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-sm border ${
              mode === "live"
                ? "text-severity-critical border-severity-critical"
                : "text-accent border-accent"
            }`}
          >
            {mode.toUpperCase()}
          </span>
        </div>
        <KillSwitch active={killSwitchActive} onToggle={onKillSwitch} />
      </div>

      <div className="space-y-4">
        <RiskMetrics positions={positions} />

        <TradeSuggestions
          suggestions={suggestions}
          onApprove={onApprove}
          onDismiss={onDismiss}
        />

        <div className="bg-bg-surface border border-border rounded-sm p-3">
          <h3 className="text-text-muted text-[10px] uppercase tracking-widest mb-2">
            Open Positions
          </h3>
          <PositionsTable positions={positions} />
        </div>

        <TradeHistory entries={history} />
      </div>
    </div>
  );
}
