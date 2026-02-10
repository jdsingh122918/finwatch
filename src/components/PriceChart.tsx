import { useEffect, useRef, useMemo, useState } from "react";
import type { DataTick } from "@finwatch/shared";
import {
  createPriceChart,
  setChartData,
  updatePriceChart,
  destroyPriceChart,
  type ChartContext,
} from "../hooks/use-price-chart.js";

type Props = {
  ticks: DataTick[];
};

export function PriceChart({ ticks }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ChartContext | null>(null);
  const prevTickCount = useRef(0);

  const symbols = useMemo(() => {
    const set = new Set<string>();
    for (const t of ticks) {
      if (t.symbol) set.add(t.symbol);
    }
    return Array.from(set).sort();
  }, [ticks]);

  const [selectedSymbol, setSelectedSymbol] = useState<string>("");

  // Auto-select first symbol
  useEffect(() => {
    if (!selectedSymbol && symbols.length > 0) {
      setSelectedSymbol(symbols[0]!);
    }
  }, [symbols, selectedSymbol]);

  const symbolTicks = useMemo(
    () => ticks.filter((t) => t.symbol === selectedSymbol),
    [ticks, selectedSymbol],
  );

  // Create chart on mount, destroy on unmount
  useEffect(() => {
    if (!containerRef.current) return;
    const ctx = createPriceChart(containerRef.current);
    chartRef.current = ctx;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        ctx.chart.resize(entry.contentRect.width, 300);
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      destroyPriceChart(ctx);
      chartRef.current = null;
    };
  }, []);

  // Load full data when symbol changes
  useEffect(() => {
    if (chartRef.current && symbolTicks.length > 0) {
      setChartData(chartRef.current, symbolTicks);
      prevTickCount.current = symbolTicks.length;
    }
  }, [selectedSymbol, symbolTicks.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Incremental updates for new ticks
  useEffect(() => {
    if (!chartRef.current) return;
    if (symbolTicks.length > prevTickCount.current) {
      const newTicks = symbolTicks.slice(prevTickCount.current);
      for (const tick of newTicks) {
        updatePriceChart(chartRef.current, tick);
      }
      prevTickCount.current = symbolTicks.length;
    }
  }, [symbolTicks]);

  if (ticks.length === 0) {
    return <p className="text-text-muted text-xs">No chart data available.</p>;
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <select
          value={selectedSymbol}
          onChange={(e) => setSelectedSymbol(e.target.value)}
          className="bg-bg-primary text-text-primary text-xs px-2 py-0.5 rounded-sm border border-border outline-none font-mono focus:border-accent"
        >
          {symbols.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
      <div
        ref={containerRef}
        data-testid="price-chart"
        className="w-full h-[300px] bg-bg-primary rounded-sm border border-border"
      />
    </div>
  );
}
