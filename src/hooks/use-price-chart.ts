import { createChart, ColorType } from "lightweight-charts";
import type { IChartApi, ISeriesApi, SeriesType } from "lightweight-charts";
import type { DataTick } from "@finwatch/shared";

export type ChartContext = {
  chart: IChartApi;
  lineSeries: ISeriesApi<SeriesType>;
  volumeSeries: ISeriesApi<SeriesType>;
};

export function createPriceChart(container: HTMLElement): ChartContext {
  const chart = createChart(container, {
    width: container.clientWidth || 600,
    height: 300,
    layout: {
      background: { type: ColorType.Solid, color: "#0a0a0a" },
      textColor: "#666666",
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 10,
    },
    grid: {
      vertLines: { color: "#222222" },
      horzLines: { color: "#222222" },
    },
    crosshair: {
      vertLine: { color: "#444444", labelBackgroundColor: "#1a1a1a" },
      horzLine: { color: "#444444", labelBackgroundColor: "#1a1a1a" },
    },
    timeScale: {
      borderColor: "#222222",
      timeVisible: true,
      secondsVisible: false,
    },
    rightPriceScale: {
      borderColor: "#222222",
    },
  });

  const lineSeries = chart.addSeries({
    type: "Line",
    color: "#00ff88",
    lineWidth: 2,
    priceLineVisible: true,
    lastValueVisible: true,
  });

  const volumeSeries = chart.addSeries({
    type: "Histogram",
    color: "rgba(0, 255, 136, 0.15)",
    priceFormat: { type: "volume" },
    priceScaleId: "",
  });

  return { chart, lineSeries, volumeSeries };
}

export function updatePriceChart(ctx: ChartContext, tick: DataTick): void {
  const time = Math.floor(tick.timestamp / 1000);
  const price = tick.metrics.price ?? tick.metrics.close;
  if (price !== undefined) {
    ctx.lineSeries.update({ time: time as never, value: price });
  }
  const volume = tick.metrics.volume;
  if (volume !== undefined) {
    ctx.volumeSeries.update({ time: time as never, value: volume });
  }
}

export function setChartData(ctx: ChartContext, ticks: DataTick[]): void {
  const sorted = [...ticks].sort((a, b) => a.timestamp - b.timestamp);
  const lineData = [];
  const volumeData = [];
  for (const tick of sorted) {
    const time = Math.floor(tick.timestamp / 1000);
    const price = tick.metrics.price ?? tick.metrics.close;
    if (price !== undefined) {
      lineData.push({ time: time as never, value: price });
    }
    const volume = tick.metrics.volume;
    if (volume !== undefined) {
      volumeData.push({ time: time as never, value: volume, color: "rgba(0, 255, 136, 0.15)" });
    }
  }
  ctx.lineSeries.setData(lineData);
  if (volumeData.length > 0) {
    ctx.volumeSeries.setData(volumeData);
  }
  ctx.chart.timeScale().fitContent();
}

export function destroyPriceChart(ctx: ChartContext): void {
  ctx.chart.remove();
}
