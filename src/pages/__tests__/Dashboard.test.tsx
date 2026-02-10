import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("lightweight-charts", () => ({
  createChart: vi.fn(() => ({
    addSeries: vi.fn(() => ({ setData: vi.fn(), update: vi.fn() })),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
    applyOptions: vi.fn(),
    resize: vi.fn(),
    remove: vi.fn(),
  })),
  ColorType: { Solid: "Solid" },
}));

import { Dashboard } from "../Dashboard.js";

describe("Dashboard", () => {
  it("renders dashboard heading", () => {
    render(<Dashboard ticks={[]} />);
    expect(screen.getByText("Market Data")).toBeTruthy();
  });

  it("shows empty state when no ticks", () => {
    render(<Dashboard ticks={[]} />);
    expect(screen.getByText(/waiting for data/i)).toBeTruthy();
  });

  it("renders tick data when available", () => {
    const ticks = [
      {
        sourceId: "yahoo",
        timestamp: 1000,
        symbol: "AAPL",
        metrics: { price: 150.25, volume: 1e6 },
        metadata: {},
      },
    ];
    render(<Dashboard ticks={ticks} />);
    expect(screen.getByText("AAPL")).toBeTruthy();
    expect(screen.getByText("$150.25")).toBeTruthy();
  });

  it("formats price with dollar sign and commas", () => {
    const ticks = [
      {
        sourceId: "yahoo",
        timestamp: 1000,
        symbol: "AAPL",
        metrics: { price: 1234.56 },
        metadata: {},
      },
    ];
    render(<Dashboard ticks={ticks} />);
    expect(screen.getByText("$1,234.56")).toBeTruthy();
  });

  it("formats volume with suffix", () => {
    const ticks = [
      {
        sourceId: "yahoo",
        timestamp: 1000,
        symbol: "AAPL",
        metrics: { volume: 2500000 },
        metadata: {},
      },
    ];
    render(<Dashboard ticks={ticks} />);
    expect(screen.getByText("2.50M")).toBeTruthy();
  });

  it("formats change with sign and percent", () => {
    const ticks = [
      {
        sourceId: "yahoo",
        timestamp: 1000,
        symbol: "AAPL",
        metrics: { change: 5.25 },
        metadata: {},
      },
    ];
    render(<Dashboard ticks={ticks} />);
    expect(screen.getByText("+5.25%")).toBeTruthy();
  });

  it("applies color class for negative change", () => {
    const ticks = [
      {
        sourceId: "yahoo",
        timestamp: 1000,
        symbol: "AAPL",
        metrics: { change: -3.1 },
        metadata: {},
      },
    ];
    const { container } = render(<Dashboard ticks={ticks} />);
    const changeEl = screen.getByText("-3.10%");
    expect(changeEl.className).toContain("text-severity-critical");
  });

  it("shows multiple symbols", () => {
    const ticks = [
      { sourceId: "yahoo", timestamp: 1, symbol: "AAPL", metrics: { price: 150 }, metadata: {} },
      { sourceId: "yahoo", timestamp: 2, symbol: "GOOGL", metrics: { price: 175 }, metadata: {} },
    ];
    render(<Dashboard ticks={ticks} />);
    expect(screen.getByText("AAPL")).toBeTruthy();
    expect(screen.getByText("GOOGL")).toBeTruthy();
  });

  it("renders chart view toggle", () => {
    const ticks = [
      { sourceId: "yahoo", timestamp: 1, symbol: "AAPL", metrics: { price: 150 }, metadata: {} },
    ];
    render(<Dashboard ticks={ticks} />);
    expect(screen.getByText("GRID")).toBeTruthy();
    expect(screen.getByText("CHART")).toBeTruthy();
  });

  it("switches to chart view when CHART clicked", () => {
    const ticks = [
      { sourceId: "yahoo", timestamp: 1, symbol: "AAPL", metrics: { price: 150 }, metadata: {} },
    ];
    render(<Dashboard ticks={ticks} />);
    fireEvent.click(screen.getByText("CHART"));
    expect(screen.getByTestId("price-chart")).toBeTruthy();
  });

  it("switches back to grid view when GRID clicked", () => {
    const ticks = [
      { sourceId: "yahoo", timestamp: 1, symbol: "AAPL", metrics: { price: 150 }, metadata: {} },
    ];
    render(<Dashboard ticks={ticks} />);
    fireEvent.click(screen.getByText("CHART"));
    fireEvent.click(screen.getByText("GRID"));
    expect(screen.getByText("$150.00")).toBeTruthy();
  });

  it("renders sparkline in symbol cards when multiple ticks exist", () => {
    const ticks = [
      { sourceId: "yahoo", timestamp: 1, symbol: "AAPL", metrics: { price: 150 }, metadata: {} },
      { sourceId: "yahoo", timestamp: 2, symbol: "AAPL", metrics: { price: 152 }, metadata: {} },
      { sourceId: "yahoo", timestamp: 3, symbol: "AAPL", metrics: { price: 151 }, metadata: {} },
    ];
    const { container } = render(<Dashboard ticks={ticks} />);
    const sparklineSvg = container.querySelector("svg polyline");
    expect(sparklineSvg).toBeTruthy();
  });
});
