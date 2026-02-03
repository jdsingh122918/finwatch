import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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
    expect(screen.getByText(/150.25/)).toBeTruthy();
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
});
