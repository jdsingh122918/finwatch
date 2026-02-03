type Props = {
  agentState: string;
  totalCycles: number;
  totalAnomalies: number;
  tickCount: number;
  symbolCount: number;
  tradingMode: string;
  killSwitchActive: boolean;
};

const stateColorClass: Record<string, string> = {
  running: "bg-state-running",
  idle: "bg-state-idle",
  paused: "bg-state-paused",
  error: "bg-state-error",
};

export function StatusBar({
  agentState,
  totalCycles,
  totalAnomalies,
  tickCount,
  symbolCount,
  tradingMode,
  killSwitchActive,
}: Props) {
  return (
    <footer className="fixed bottom-0 left-0 right-0 h-7 bg-bg-primary border-t border-border flex items-center px-3 text-xs font-mono text-text-muted z-20">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${stateColorClass[agentState] ?? "bg-state-idle"}`}
          />
          <span>{agentState.toUpperCase()}</span>
        </span>
        <span>cycles:{totalCycles}</span>
        <span>anomalies:{totalAnomalies}</span>
      </div>
      <div className="flex-1 text-center">
        <span>ticks:{tickCount}</span>
        <span className="ml-4">symbols:{symbolCount}</span>
      </div>
      <div className="flex items-center gap-4">
        <span
          className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold ${
            tradingMode === "live"
              ? "bg-severity-critical/20 text-severity-critical"
              : "bg-accent/10 text-accent"
          }`}
        >
          {tradingMode.toUpperCase()}
        </span>
        {killSwitchActive && (
          <span className="text-severity-critical font-bold">KILL SWITCH</span>
        )}
      </div>
    </footer>
  );
}
