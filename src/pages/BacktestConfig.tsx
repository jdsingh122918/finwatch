import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTauriEvent } from "../hooks/use-tauri-event";
import { BacktestConfigSchema } from "@finwatch/shared";
import type { BacktestConfig, BacktestProgress } from "@finwatch/shared";

type Props = {
  progress: BacktestProgress | null;
  onProgress: (p: BacktestProgress) => void;
  onComplete: (backtestId: string) => void;
  runs: { id: string; status: string; startDate: string; endDate: string; totalReturnPct?: number }[];
  onViewResult: (id: string) => void;
};

export function BacktestConfigPage({ progress, onProgress, onComplete, runs, onViewResult }: Props) {
  const [symbols, setSymbols] = useState("AAPL,TSLA,MSFT");
  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");
  const [timeframe, setTimeframe] = useState<"1Day" | "1Hour">("1Day");
  const [initialCapital, setInitialCapital] = useState(100000);
  const [sizingStrategy, setSizingStrategy] = useState<"fixed_qty" | "pct_of_capital" | "kelly">("pct_of_capital");
  const [maxPositionSize, setMaxPositionSize] = useState(10000);
  const [maxExposure, setMaxExposure] = useState(50000);
  const [maxDailyTrades, setMaxDailyTrades] = useState(5);
  const [maxLossPct, setMaxLossPct] = useState(2);
  const [preScreenerSensitivity, setPreScreenerSensitivity] = useState(0.5);
  const [severityThreshold, setSeverityThreshold] = useState<"low" | "medium" | "high" | "critical">("high");
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.7);
  const [modelId, setModelId] = useState("claude-3-5-haiku-20241022");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentIdRef = useRef<string | null>(null);

  useTauriEvent<BacktestProgress>("backtest:progress", onProgress);
  useTauriEvent<{ backtestId: string; status: string; metrics?: object; trades?: object[]; equityCurve?: object[]; error?: string }>(
    "backtest:complete",
    async (payload) => {
      setRunning(false);
      try {
        await invoke("backtest_update_status", {
          backtestId: payload.backtestId,
          status: payload.status,
          metrics: payload.metrics ? JSON.stringify(payload.metrics) : null,
          error: payload.error ?? null,
        });
      } catch (e) {
        console.error("Failed to update backtest status:", e);
      }
      onComplete(payload.backtestId);
    },
  );

  const handleStart = async () => {
    setError(null);
    const id = `bt-${Date.now()}`;
    const config: BacktestConfig = {
      id,
      symbols: symbols.split(",").map((s) => s.trim()).filter(Boolean),
      startDate,
      endDate,
      timeframe,
      initialCapital,
      riskLimits: {
        maxPositionSize,
        maxExposure,
        maxDailyTrades,
        maxLossPct,
        cooldownMs: 0,
      },
      severityThreshold,
      confidenceThreshold,
      preScreenerSensitivity,
      tradeSizingStrategy: sizingStrategy,
      modelId,
    };

    const parseResult = BacktestConfigSchema.safeParse(config);
    if (!parseResult.success) {
      setError(parseResult.error.issues.map((i: { path: (string | number)[]; message: string }) => `${i.path.join(".")}: ${i.message}`).join("; "));
      return;
    }

    try {
      currentIdRef.current = id;
      setRunning(true);
      await invoke("backtest_start", { config: JSON.stringify(config) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-lg text-accent font-bold tracking-wide">BACKTEST</h1>

      {/* Data Selection */}
      <section className="space-y-3">
        <h2 className="text-text-secondary text-xs uppercase tracking-widest">Data Selection</h2>
        <label className="block">
          <span className="text-text-muted text-xs">Symbols (comma-separated)</span>
          <input value={symbols} onChange={(e) => setSymbols(e.target.value)} disabled={running}
            className="mt-1 w-full bg-bg-elevated border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:border-accent focus:outline-none" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-text-muted text-xs">Start Date</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={running}
              className="mt-1 w-full bg-bg-elevated border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:border-accent focus:outline-none" />
          </label>
          <label className="block">
            <span className="text-text-muted text-xs">End Date</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={running}
              className="mt-1 w-full bg-bg-elevated border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:border-accent focus:outline-none" />
          </label>
        </div>
        <div className="flex gap-2">
          {(["1Day", "1Hour"] as const).map((tf) => (
            <button key={tf} onClick={() => setTimeframe(tf)} disabled={running}
              className={`px-3 py-1.5 rounded text-xs font-mono border cursor-pointer ${timeframe === tf ? "border-accent text-accent bg-bg-elevated" : "border-border text-text-muted hover:text-text-primary"}`}>
              {tf === "1Day" ? "Daily" : "Hourly"}
            </button>
          ))}
        </div>
      </section>

      {/* Portfolio Settings */}
      <section className="space-y-3">
        <h2 className="text-text-secondary text-xs uppercase tracking-widest">Portfolio</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-text-muted text-xs">Initial Capital ($)</span>
            <input type="number" value={initialCapital} onChange={(e) => { const parsed = parseFloat(e.target.value); if (!isNaN(parsed)) setInitialCapital(parsed); }} disabled={running}
              className="mt-1 w-full bg-bg-elevated border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:border-accent focus:outline-none" />
          </label>
          <label className="block">
            <span className="text-text-muted text-xs">Sizing Strategy</span>
            <select value={sizingStrategy} onChange={(e) => setSizingStrategy(e.target.value as typeof sizingStrategy)} disabled={running}
              className="mt-1 w-full bg-bg-elevated border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:border-accent focus:outline-none">
              <option value="fixed_qty">Fixed Quantity</option>
              <option value="pct_of_capital">% of Capital</option>
              <option value="kelly">Kelly Criterion</option>
            </select>
          </label>
        </div>
      </section>

      {/* Risk Limits */}
      <section className="space-y-3">
        <h2 className="text-text-secondary text-xs uppercase tracking-widest">Risk Limits</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-text-muted text-xs">Max Position Size ($)</span>
            <input type="number" value={maxPositionSize} onChange={(e) => { const parsed = parseFloat(e.target.value); if (!isNaN(parsed)) setMaxPositionSize(parsed); }} disabled={running}
              className="mt-1 w-full bg-bg-elevated border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:border-accent focus:outline-none" />
          </label>
          <label className="block">
            <span className="text-text-muted text-xs">Max Exposure ($)</span>
            <input type="number" value={maxExposure} onChange={(e) => { const parsed = parseFloat(e.target.value); if (!isNaN(parsed)) setMaxExposure(parsed); }} disabled={running}
              className="mt-1 w-full bg-bg-elevated border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:border-accent focus:outline-none" />
          </label>
          <label className="block">
            <span className="text-text-muted text-xs">Max Daily Trades</span>
            <input type="number" value={maxDailyTrades} onChange={(e) => { const parsed = parseFloat(e.target.value); if (!isNaN(parsed)) setMaxDailyTrades(parsed); }} disabled={running}
              className="mt-1 w-full bg-bg-elevated border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:border-accent focus:outline-none" />
          </label>
          <label className="block">
            <span className="text-text-muted text-xs">Max Loss (%)</span>
            <input type="number" value={maxLossPct} onChange={(e) => { const parsed = parseFloat(e.target.value); if (!isNaN(parsed)) setMaxLossPct(parsed); }} disabled={running}
              className="mt-1 w-full bg-bg-elevated border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:border-accent focus:outline-none" />
          </label>
        </div>
      </section>

      {/* Detection Settings */}
      <section className="space-y-3">
        <h2 className="text-text-secondary text-xs uppercase tracking-widest">Detection</h2>
        <label className="block">
          <span className="text-text-muted text-xs">Pre-Screener Sensitivity: {preScreenerSensitivity.toFixed(2)}</span>
          <input type="range" min="0" max="1" step="0.05" value={preScreenerSensitivity} onChange={(e) => setPreScreenerSensitivity(Number(e.target.value))} disabled={running}
            className="mt-1 w-full accent-accent" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-text-muted text-xs">Severity Threshold</span>
            <select value={severityThreshold} onChange={(e) => setSeverityThreshold(e.target.value as typeof severityThreshold)} disabled={running}
              className="mt-1 w-full bg-bg-elevated border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:border-accent focus:outline-none">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label className="block">
            <span className="text-text-muted text-xs">Confidence Threshold: {confidenceThreshold.toFixed(2)}</span>
            <input type="range" min="0" max="1" step="0.05" value={confidenceThreshold} onChange={(e) => setConfidenceThreshold(Number(e.target.value))} disabled={running}
              className="mt-1 w-full accent-accent" />
          </label>
        </div>
        <label className="block">
          <span className="text-text-muted text-xs">LLM Model</span>
          <input value={modelId} onChange={(e) => setModelId(e.target.value)} disabled={running}
            className="mt-1 w-full bg-bg-elevated border border-border rounded px-3 py-2 text-text-primary font-mono text-sm focus:border-accent focus:outline-none" />
        </label>
      </section>

      {/* Run Controls */}
      <div className="flex gap-3 items-center">
        <button onClick={handleStart} disabled={running}
          className="px-4 py-2 bg-accent text-bg-primary font-bold rounded text-sm hover:opacity-90 disabled:opacity-50 cursor-pointer">
          {running ? "Running..." : "Start Backtest"}
        </button>
        {running && (
          <button onClick={async () => {
              try { if (currentIdRef.current) await invoke("backtest_cancel", { backtestId: currentIdRef.current }); }
              catch { /* best-effort */ }
              setRunning(false);
            }}
            className="px-4 py-2 border border-severity-high text-severity-high rounded text-sm hover:bg-severity-high/10 cursor-pointer">
            Cancel
          </button>
        )}
      </div>

      {error && <p className="text-severity-high text-xs">{error}</p>}

      {/* Progress */}
      {progress && running && (
        <div className="bg-bg-elevated border border-border rounded p-4 space-y-2">
          <div className="flex justify-between text-xs text-text-muted">
            <span>Progress: {progress.ticksProcessed} / {progress.totalTicks} ticks</span>
            <span>{progress.currentDate}</span>
          </div>
          <div className="w-full bg-bg-primary rounded-full h-2">
            <div className="bg-accent h-2 rounded-full transition-all"
              style={{ width: `${progress.totalTicks > 0 ? (progress.ticksProcessed / progress.totalTicks) * 100 : 0}%` }} />
          </div>
          <div className="flex gap-4 text-xs text-text-muted">
            <span>Anomalies: {progress.anomaliesFound}</span>
            <span>Trades: {progress.tradesExecuted}</span>
          </div>
        </div>
      )}

      {/* Recent Runs */}
      {runs.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-text-secondary text-xs uppercase tracking-widest">Recent Runs</h2>
          <div className="border border-border rounded overflow-hidden">
            {runs.map((run) => (
              <button key={run.id} onClick={() => onViewResult(run.id)}
                className="w-full flex justify-between items-center px-4 py-2 hover:bg-bg-elevated text-left border-b border-border last:border-b-0 cursor-pointer">
                <span className="text-xs font-mono text-text-primary">{run.id.slice(0, 12)}</span>
                <span className="text-xs text-text-muted">{run.startDate} → {run.endDate}</span>
                <span className={`text-xs font-mono ${run.status === "completed" ? "text-accent" : run.status === "failed" ? "text-severity-high" : "text-text-muted"}`}>
                  {run.status}
                </span>
                {run.totalReturnPct !== undefined && (
                  <span className={`text-xs font-mono ${run.totalReturnPct >= 0 ? "text-accent" : "text-severity-high"}`}>
                    {run.totalReturnPct >= 0 ? "+" : ""}{run.totalReturnPct.toFixed(2)}%
                  </span>
                )}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
