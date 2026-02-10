import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RiskMetrics } from "../RiskMetrics.js";
import type { PortfolioPosition } from "@finwatch/shared";

const positions: PortfolioPosition[] = [
  { symbol: "AAPL", qty: 10, avgEntry: 180, currentPrice: 190, unrealizedPnl: 100 },
  { symbol: "GOOGL", qty: 5, avgEntry: 150, currentPrice: 145, unrealizedPnl: -25 },
];

describe("RiskMetrics", () => {
  it("renders all four metric cards", () => {
    render(<RiskMetrics positions={positions} />);
    expect(screen.getByText("Total Exposure")).toBeTruthy();
    expect(screen.getByText("Unrealized P&L")).toBeTruthy();
    expect(screen.getByText("Largest Position")).toBeTruthy();
    expect(screen.getByText("Open Positions")).toBeTruthy();
  });

  it("calculates total exposure", () => {
    render(<RiskMetrics positions={positions} />);
    // AAPL: 10 * 190 = 1900, GOOGL: 5 * 145 = 725 -> total 2625
    expect(screen.getByText("$2,625.00")).toBeTruthy();
  });

  it("calculates unrealized P&L", () => {
    render(<RiskMetrics positions={positions} />);
    // 100 + (-25) = 75
    expect(screen.getByText("$75.00")).toBeTruthy();
  });

  it("shows largest position symbol", () => {
    render(<RiskMetrics positions={positions} />);
    // AAPL: 10*190=1900 > GOOGL: 5*145=725
    expect(screen.getByText("AAPL")).toBeTruthy();
  });

  it("shows open positions count", () => {
    render(<RiskMetrics positions={positions} />);
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("shows empty state when no positions", () => {
    render(<RiskMetrics positions={[]} />);
    const zeroPrices = screen.getAllByText("$0.00");
    expect(zeroPrices.length).toBe(2); // Total Exposure + Unrealized P&L
    expect(screen.getByText("0")).toBeTruthy();
  });
});
