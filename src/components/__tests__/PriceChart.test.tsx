import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockLineSeries = { setData: vi.fn(), update: vi.fn() };
const mockVolumeSeries = { setData: vi.fn(), update: vi.fn() };
const mockTimeScale = { fitContent: vi.fn() };
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

import { PriceChart } from "../PriceChart.js";
import type { DataTick } from "@finwatch/shared";

const ticks: DataTick[] = [
  { sourceId: "yahoo", timestamp: 1700000000000, symbol: "AAPL", metrics: { price: 150 }, metadata: {} },
  { sourceId: "yahoo", timestamp: 1700000060000, symbol: "AAPL", metrics: { price: 151 }, metadata: {} },
  { sourceId: "yahoo", timestamp: 1700000000000, symbol: "GOOGL", metrics: { price: 140 }, metadata: {} },
];

describe("PriceChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders chart container", () => {
    const { container } = render(<PriceChart ticks={ticks} />);
    expect(container.querySelector("[data-testid='price-chart']")).toBeTruthy();
  });

  it("renders symbol selector", () => {
    render(<PriceChart ticks={ticks} />);
    expect(screen.getByDisplayValue("AAPL")).toBeTruthy();
  });

  it("lists all unique symbols in selector", () => {
    render(<PriceChart ticks={ticks} />);
    const options = screen.getAllByRole("option");
    const values = options.map((o) => (o as HTMLOptionElement).value);
    expect(values).toContain("AAPL");
    expect(values).toContain("GOOGL");
  });

  it("switches symbol on dropdown change", () => {
    render(<PriceChart ticks={ticks} />);
    fireEvent.change(screen.getByDisplayValue("AAPL"), { target: { value: "GOOGL" } });
    expect(screen.getByDisplayValue("GOOGL")).toBeTruthy();
  });

  it("shows empty state when no ticks", () => {
    render(<PriceChart ticks={[]} />);
    expect(screen.getByText(/no chart data/i)).toBeTruthy();
  });
});
