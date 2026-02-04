import { useState, useMemo, useCallback } from "react";
import type { BacktestResult, BacktestTrade, BacktestMetrics } from "@finwatch/shared";

type Props = {
  result: BacktestResult;
  onBack: () => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number, decimals = 2): string {
  return n.toFixed(decimals);
}

/** Format a value already in percentage form (e.g., 5.0 -> "+5.00%") */
function fmtPct(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

/** Format a 0-1 ratio as percentage (e.g., 0.65 -> "+65.00%") */
function fmtRatio(n: number): string {
  return `${n >= 0 ? "+" : ""}${(n * 100).toFixed(2)}%`;
}

function fmtCurrency(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function downloadFile(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type SortKey = keyof Pick<
  BacktestTrade,
  "timestamp" | "symbol" | "side" | "qty" | "fillPrice" | "realizedPnl"
>;
type SortDir = "asc" | "desc";

function MetricCard({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="bg-bg-elevated border border-border rounded p-4 flex flex-col gap-1">
      <span className="text-text-muted text-[10px] uppercase tracking-widest">
        {label}
      </span>
      <span className={`text-lg font-bold font-mono ${valueClass ?? "text-text-primary"}`}>
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Equity Curve
// ---------------------------------------------------------------------------

function EquityCurve({
  curve,
  trades,
  initialCapital,
}: {
  curve: { date: string; value: number }[];
  trades: BacktestTrade[];
  initialCapital: number;
}) {
  if (curve.length < 2) {
    return <p className="text-text-muted text-xs">Not enough data for chart.</p>;
  }

  const W = 800;
  const H = 300;
  const PAD_X = 50;
  const PAD_Y = 30;
  const plotW = W - PAD_X * 2;
  const plotH = H - PAD_Y * 2;

  const values = curve.map((p) => p.value);
  const minVal = Math.min(...values) * 0.98;
  const maxVal = Math.max(...values) * 1.02;
  const range = maxVal - minVal || 1;

  const x = (i: number) => PAD_X + (i / (curve.length - 1)) * plotW;
  const y = (v: number) => PAD_Y + plotH - ((v - minVal) / range) * plotH;

  // Equity polyline
  const points = curve.map((p, i) => `${x(i)},${y(p.value)}`).join(" ");

  // Drawdown regions: shade from peak to current when below peak
  const drawdownPolygons: string[] = [];
  const firstPoint = curve[0]!;
  let peak = firstPoint.value;
  let ddStart: number | null = null;

  for (let i = 0; i < curve.length; i++) {
    const pt = curve[i]!;
    if (pt.value > peak) peak = pt.value;
    const inDrawdown = pt.value < peak;

    if (inDrawdown && ddStart === null) {
      ddStart = i > 0 ? i - 1 : i;
    }
    if ((!inDrawdown || i === curve.length - 1) && ddStart !== null) {
      const end = inDrawdown ? i : i - 1;
      // Build polygon: top edge = equity line, bottom edge = peak line
      const topEdge: string[] = [];
      const bottomEdge: string[] = [];
      for (let j = ddStart; j <= end; j++) {
        const jp = curve[j]!;
        topEdge.push(`${x(j)},${y(jp.value)}`);
        bottomEdge.push(`${x(j)},${y(peak)}`);
      }
      bottomEdge.reverse();
      drawdownPolygons.push([...topEdge, ...bottomEdge].join(" "));
      ddStart = null;
    }
  }

  // Map trades to curve indices for markers
  const lastPoint = curve[curve.length - 1]!;
  const curveStartTs = new Date(firstPoint.date).getTime();
  const curveEndTs = new Date(lastPoint.date).getTime();
  const curveSpan = curveEndTs - curveStartTs || 1;

  const tradeMarkers = trades.map((t) => {
    const frac = (t.timestamp - curveStartTs) / curveSpan;
    const idx = Math.round(frac * (curve.length - 1));
    const clampedIdx = Math.max(0, Math.min(curve.length - 1, idx));
    const cx = x(clampedIdx);
    const curvePoint = curve[clampedIdx]!;
    const cy = y(curvePoint.value);
    return { cx, cy, side: t.side, id: t.id };
  });

  // Y-axis labels
  const yTicks = 5;
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => {
    const val = minVal + (range * i) / yTicks;
    return { val, py: y(val) };
  });

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full h-auto"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Grid lines */}
      {yLabels.map((yl) => (
        <line
          key={yl.val}
          x1={PAD_X}
          y1={yl.py}
          x2={W - PAD_X}
          y2={yl.py}
          stroke="#222222"
          strokeWidth="0.5"
        />
      ))}

      {/* Y-axis labels */}
      {yLabels.map((yl) => (
        <text
          key={`label-${yl.val}`}
          x={PAD_X - 6}
          y={yl.py + 3}
          textAnchor="end"
          fill="#666666"
          fontSize="8"
          fontFamily="monospace"
        >
          {fmtCurrency(yl.val)}
        </text>
      ))}

      {/* Drawdown shading */}
      {drawdownPolygons.map((poly, i) => (
        <polygon
          key={`dd-${i}`}
          points={poly}
          fill="rgba(239,68,68,0.15)"
          stroke="none"
        />
      ))}

      {/* Initial capital reference line */}
      <line
        x1={PAD_X}
        y1={y(initialCapital)}
        x2={W - PAD_X}
        y2={y(initialCapital)}
        stroke="#666666"
        strokeWidth="0.5"
        strokeDasharray="4 4"
      />

      {/* Equity line */}
      <polyline
        points={points}
        stroke="#00ff88"
        fill="none"
        strokeWidth="2"
        strokeLinejoin="round"
      />

      {/* Trade markers */}
      {tradeMarkers.map((tm) =>
        tm.side === "buy" ? (
          <polygon
            key={tm.id}
            points={`${tm.cx},${tm.cy - 5} ${tm.cx - 4},${tm.cy + 3} ${tm.cx + 4},${tm.cy + 3}`}
            fill="#00ff88"
            opacity="0.8"
          />
        ) : (
          <polygon
            key={tm.id}
            points={`${tm.cx},${tm.cy + 5} ${tm.cx - 4},${tm.cy - 3} ${tm.cx + 4},${tm.cy - 3}`}
            fill="#ef4444"
            opacity="0.8"
          />
        ),
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Trade Table
// ---------------------------------------------------------------------------

function TradeTable({ trades }: { trades: BacktestTrade[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const handleSort = useCallback(
    (key: SortKey) => {
      if (key === sortKey) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir("asc");
      }
    },
    [sortKey],
  );

  const sorted = useMemo(() => {
    const copy = [...trades];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const aVal = av ?? 0;
      const bVal = bv ?? 0;
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDir === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      return sortDir === "asc"
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
    return copy;
  }, [trades, sortKey, sortDir]);

  const columns: { key: SortKey; label: string; align: string }[] = [
    { key: "timestamp", label: "DATE", align: "text-left" },
    { key: "symbol", label: "SYMBOL", align: "text-left" },
    { key: "side", label: "SIDE", align: "text-left" },
    { key: "qty", label: "QTY", align: "text-right" },
    { key: "fillPrice", label: "PRICE", align: "text-right" },
    { key: "realizedPnl", label: "P&L", align: "text-right" },
  ];

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ^" : " v") : "";

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs font-mono">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`py-2 px-2 ${col.align} text-text-muted cursor-pointer select-none hover:text-accent uppercase tracking-widest text-[10px] font-normal`}
                onClick={() => handleSort(col.key)}
              >
                {col.label}
                {arrow(col.key)}
              </th>
            ))}
            <th className="py-2 px-2 text-left text-text-muted uppercase tracking-widest text-[10px] font-normal">
              RATIONALE
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((trade) => (
            <tr
              key={trade.id}
              className="border-b border-border/50 hover:bg-bg-elevated/50"
            >
              <td className="py-1.5 px-2 text-text-muted">
                {fmtDateTime(trade.timestamp)}
              </td>
              <td className="py-1.5 px-2 text-accent font-bold">
                {trade.symbol}
              </td>
              <td className="py-1.5 px-2">
                <span
                  className={
                    trade.side === "buy"
                      ? "text-severity-low"
                      : "text-severity-critical"
                  }
                >
                  {trade.side.toUpperCase()}
                </span>
              </td>
              <td className="py-1.5 px-2 text-right">{trade.qty}</td>
              <td className="py-1.5 px-2 text-right">
                {fmtCurrency(trade.fillPrice)}
              </td>
              <td
                className={`py-1.5 px-2 text-right font-bold ${
                  trade.realizedPnl === null
                    ? "text-text-muted"
                    : trade.realizedPnl >= 0
                      ? "text-severity-low"
                      : "text-severity-critical"
                }`}
              >
                {trade.realizedPnl !== null
                  ? fmtCurrency(trade.realizedPnl)
                  : "--"}
              </td>
              <td className="py-1.5 px-2 text-text-muted truncate max-w-[200px]">
                {trade.rationale}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-Symbol Breakdown
// ---------------------------------------------------------------------------

function PerSymbolBreakdown({
  perSymbol,
}: {
  perSymbol: Record<string, Omit<BacktestMetrics, "perSymbol">>;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = useCallback((sym: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym);
      else next.add(sym);
      return next;
    });
  }, []);

  const symbols = Object.keys(perSymbol).sort();

  return (
    <div className="flex flex-col gap-1">
      {symbols.map((sym) => {
        const m = perSymbol[sym];
        if (!m) return null;
        const isOpen = expanded.has(sym);
        return (
          <div key={sym} className="border border-border rounded">
            <button
              className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-bg-elevated/50 cursor-pointer bg-transparent border-0 text-text-primary"
              onClick={() => toggle(sym)}
            >
              <span className="flex items-center gap-3">
                <span className="text-accent font-bold">{sym}</span>
                <span className="text-text-muted">
                  {m.totalTrades} trades
                </span>
                <span
                  className={
                    m.totalReturnPct >= 0
                      ? "text-severity-low"
                      : "text-severity-critical"
                  }
                >
                  {fmtPct(m.totalReturnPct)}
                </span>
              </span>
              <span className="text-text-muted">{isOpen ? "[-]" : "[+]"}</span>
            </button>
            {isOpen && (
              <div className="px-3 pb-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <Stat label="Return" value={fmtCurrency(m.totalReturn)} />
                <Stat label="Return %" value={fmtPct(m.totalReturnPct)} />
                <Stat label="Sharpe" value={fmt(m.sharpeRatio)} />
                <Stat label="Sortino" value={fmt(m.sortinoRatio)} />
                <Stat label="Max DD" value={fmtPct(-m.maxDrawdownPct)} />
                <Stat label="Win Rate" value={fmtRatio(m.winRate)} />
                <Stat label="Profit Factor" value={fmt(m.profitFactor)} />
                <Stat label="Avg W/L" value={fmt(m.avgWinLossRatio)} />
                <Stat label="Largest Win" value={fmtCurrency(m.largestWin)} />
                <Stat label="Largest Loss" value={fmtCurrency(m.largestLoss)} />
                <Stat label="Consec. Wins" value={String(m.maxConsecutiveWins)} />
                <Stat label="Consec. Losses" value={String(m.maxConsecutiveLosses)} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-text-muted text-[10px] uppercase tracking-widest">
        {label}
      </span>
      <span className="font-mono text-text-primary">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Monthly Returns Heatmap
// ---------------------------------------------------------------------------

function MonthlyReturnsHeatmap({
  monthlyReturns,
}: {
  monthlyReturns: { month: string; return: number }[];
}) {
  if (monthlyReturns.length === 0) {
    return <p className="text-text-muted text-xs">No monthly data.</p>;
  }

  const maxAbs = Math.max(
    ...monthlyReturns.map((m) => Math.abs(m.return)),
    0.001,
  );

  return (
    <div className="grid grid-cols-4 gap-1">
      {monthlyReturns.map((m) => {
        const intensity = Math.min(Math.abs(m.return) / maxAbs, 1);
        const alpha = 0.15 + intensity * 0.6;
        const bgColor =
          m.return >= 0
            ? `rgba(34, 197, 94, ${alpha})`
            : `rgba(239, 68, 68, ${alpha})`;
        return (
          <div
            key={m.month}
            className="rounded p-2 text-center text-xs font-mono border border-border"
            style={{ backgroundColor: bgColor }}
          >
            <div className="text-text-muted text-[10px]">{m.month}</div>
            <div
              className={
                m.return >= 0
                  ? "text-severity-low font-bold"
                  : "text-severity-critical font-bold"
              }
            >
              {fmtPct(m.return)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Export Helpers
// ---------------------------------------------------------------------------

function exportJson(result: BacktestResult) {
  const json = JSON.stringify(result, null, 2);
  downloadFile(json, `backtest-${result.id}.json`, "application/json");
}

function exportCsv(result: BacktestResult) {
  const headers = [
    "id",
    "symbol",
    "side",
    "qty",
    "fillPrice",
    "realizedPnl",
    "timestamp",
    "rationale",
  ];
  const rows = result.trades.map((t: BacktestTrade) =>
    [
      t.id,
      t.symbol,
      t.side,
      t.qty,
      t.fillPrice,
      t.realizedPnl ?? "",
      new Date(t.timestamp).toISOString(),
      `"${t.rationale.replace(/"/g, '""')}"`,
    ].join(","),
  );
  const csv = [headers.join(","), ...rows].join("\n");
  downloadFile(csv, `backtest-${result.id}.csv`, "text/csv");
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function BacktestResults({ result, onBack }: Props) {
  const metrics = result.metrics;

  const summaryCards = useMemo(() => {
    if (!metrics) return null;
    return [
      {
        label: "Total Return",
        value: fmtCurrency(metrics.totalReturn),
        cls:
          metrics.totalReturn >= 0
            ? "text-severity-low"
            : "text-severity-critical",
      },
      {
        label: "Sharpe Ratio",
        value: fmt(metrics.sharpeRatio),
        cls:
          metrics.sharpeRatio >= 1
            ? "text-severity-low"
            : metrics.sharpeRatio >= 0
              ? "text-severity-medium"
              : "text-severity-critical",
      },
      {
        label: "Max Drawdown",
        value: fmtPct(-metrics.maxDrawdownPct),
        cls: "text-severity-high",
      },
      {
        label: "Win Rate",
        value: fmtRatio(metrics.winRate),
        cls:
          metrics.winRate >= 0.5
            ? "text-severity-low"
            : "text-severity-high",
      },
      {
        label: "Total Trades",
        value: String(metrics.totalTrades),
        cls: "text-accent",
      },
      {
        label: "Profit Factor",
        value: fmt(metrics.profitFactor),
        cls:
          metrics.profitFactor >= 1
            ? "text-severity-low"
            : "text-severity-critical",
      },
    ];
  }, [metrics]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="text-xs px-3 py-1.5 border border-border rounded text-text-muted hover:text-accent hover:border-accent cursor-pointer bg-transparent font-mono"
          >
            &lt; BACK
          </button>
          <div>
            <h2 className="text-text-muted text-xs uppercase tracking-widest">
              Backtest Results
            </h2>
            <span className="text-text-muted text-[10px] font-mono">
              {result.config.symbols.join(", ")} | {result.config.startDate} -
              {" "}{result.config.endDate} | {result.config.timeframe}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportJson(result)}
            className="text-[10px] px-2 py-1 border border-border rounded text-text-muted hover:text-accent hover:border-accent cursor-pointer bg-transparent font-mono uppercase"
          >
            Export JSON
          </button>
          <button
            onClick={() => exportCsv(result)}
            className="text-[10px] px-2 py-1 border border-border rounded text-text-muted hover:text-accent hover:border-accent cursor-pointer bg-transparent font-mono uppercase"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Error / no metrics fallback */}
      {result.error && (
        <div className="bg-bg-elevated border border-severity-critical rounded p-4 text-severity-critical text-xs font-mono">
          Error: {result.error}
        </div>
      )}

      {!metrics ? (
        <p className="text-text-muted text-xs">
          {result.status === "running"
            ? "Backtest in progress..."
            : "No metrics available."}
        </p>
      ) : (
        <>
          {/* Summary cards */}
          <section>
            <h3 className="text-text-muted text-[10px] uppercase tracking-widest mb-3">
              Summary
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {summaryCards?.map((card) => (
                <MetricCard
                  key={card.label}
                  label={card.label}
                  value={card.value}
                  valueClass={card.cls}
                />
              ))}
            </div>
          </section>

          {/* Equity curve */}
          <section>
            <h3 className="text-text-muted text-[10px] uppercase tracking-widest mb-3">
              Equity Curve
            </h3>
            <div className="bg-bg-elevated border border-border rounded p-4">
              <EquityCurve
                curve={result.equityCurve}
                trades={result.trades}
                initialCapital={result.config.initialCapital}
              />
            </div>
          </section>

          {/* Monthly returns heatmap */}
          <section>
            <h3 className="text-text-muted text-[10px] uppercase tracking-widest mb-3">
              Monthly Returns
            </h3>
            <div className="bg-bg-elevated border border-border rounded p-4">
              <MonthlyReturnsHeatmap monthlyReturns={metrics.monthlyReturns} />
            </div>
          </section>

          {/* Per-symbol breakdown */}
          {metrics.perSymbol &&
            Object.keys(metrics.perSymbol).length > 0 && (
              <section>
                <h3 className="text-text-muted text-[10px] uppercase tracking-widest mb-3">
                  Per-Symbol Breakdown
                </h3>
                <PerSymbolBreakdown perSymbol={metrics.perSymbol} />
              </section>
            )}

          {/* Trade table */}
          <section>
            <h3 className="text-text-muted text-[10px] uppercase tracking-widest mb-3">
              Trades ({metrics.totalTrades})
            </h3>
            <div className="bg-bg-elevated border border-border rounded p-4">
              <TradeTable trades={result.trades} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
