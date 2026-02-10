import { describe, it, expect, vi, beforeEach } from "vitest";

const mockLineSeries = {
  setData: vi.fn(),
  update: vi.fn(),
};

const mockVolumeSeries = {
  setData: vi.fn(),
  update: vi.fn(),
};

const mockTimeScale = {
  fitContent: vi.fn(),
};

const mockChart = {
  addSeries: vi.fn((opts: { type: string }) => {
    if (opts.type === "Histogram") return mockVolumeSeries;
    return mockLineSeries;
  }),
  timeScale: vi.fn(() => mockTimeScale),
  applyOptions: vi.fn(),
  resize: vi.fn(),
  remove: vi.fn(),
};

vi.mock("lightweight-charts", () => ({
  createChart: vi.fn(() => mockChart),
  ColorType: { Solid: "Solid" },
}));

import { createChart } from "lightweight-charts";
import { createPriceChart, updatePriceChart, destroyPriceChart } from "../use-price-chart.js";
import type { DataTick } from "@finwatch/shared";

describe("usePriceChart helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a chart with terminal theme", () => {
    const container = document.createElement("div");
    const result = createPriceChart(container);
    expect(createChart).toHaveBeenCalledWith(container, expect.objectContaining({
      width: expect.any(Number),
      height: expect.any(Number),
    }));
    expect(result.chart).toBe(mockChart);
    expect(result.lineSeries).toBe(mockLineSeries);
  });

  it("updates line series with new tick data", () => {
    const container = document.createElement("div");
    const ctx = createPriceChart(container);
    const tick: DataTick = {
      sourceId: "yahoo",
      timestamp: 1700000000000,
      symbol: "AAPL",
      metrics: { price: 150.25 },
      metadata: {},
    };
    updatePriceChart(ctx, tick);
    expect(mockLineSeries.update).toHaveBeenCalledWith(
      expect.objectContaining({ value: 150.25 }),
    );
  });

  it("updates volume series when volume present", () => {
    const container = document.createElement("div");
    const ctx = createPriceChart(container);
    const tick: DataTick = {
      sourceId: "yahoo",
      timestamp: 1700000000000,
      symbol: "AAPL",
      metrics: { price: 150.25, volume: 1000000 },
      metadata: {},
    };
    updatePriceChart(ctx, tick);
    expect(mockVolumeSeries.update).toHaveBeenCalledWith(
      expect.objectContaining({ value: 1000000 }),
    );
  });

  it("cleans up chart on destroy", () => {
    const container = document.createElement("div");
    const ctx = createPriceChart(container);
    destroyPriceChart(ctx);
    expect(mockChart.remove).toHaveBeenCalled();
  });
});
