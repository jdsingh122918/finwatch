import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PositionsTable } from "../PositionsTable.js";
import type { PortfolioPosition } from "@finwatch/shared";

const positions: PortfolioPosition[] = [
  { symbol: "AAPL", qty: 10, avgEntry: 180.5, currentPrice: 190.25, unrealizedPnl: 97.5 },
  { symbol: "GOOGL", qty: 5, avgEntry: 150.0, currentPrice: 145.0, unrealizedPnl: -25.0 },
];

describe("PositionsTable", () => {
  it("renders table headers", () => {
    render(<PositionsTable positions={positions} />);
    expect(screen.getByText("Symbol")).toBeTruthy();
    expect(screen.getByText("Qty")).toBeTruthy();
    expect(screen.getByText("Entry")).toBeTruthy();
    expect(screen.getByText("Current")).toBeTruthy();
    expect(screen.getByText("P&L")).toBeTruthy();
  });

  it("renders position rows", () => {
    render(<PositionsTable positions={positions} />);
    expect(screen.getByText("AAPL")).toBeTruthy();
    expect(screen.getByText("GOOGL")).toBeTruthy();
  });

  it("formats prices", () => {
    render(<PositionsTable positions={positions} />);
    expect(screen.getByText("$180.50")).toBeTruthy();
    expect(screen.getByText("$190.25")).toBeTruthy();
  });

  it("colors positive P&L green", () => {
    render(<PositionsTable positions={positions} />);
    const pnl = screen.getByText("$97.50");
    expect(pnl.className).toContain("text-accent");
  });

  it("colors negative P&L red", () => {
    render(<PositionsTable positions={positions} />);
    const pnl = screen.getByText("-$25.00");
    expect(pnl.className).toContain("text-severity-critical");
  });

  it("shows empty state when no positions", () => {
    render(<PositionsTable positions={[]} />);
    expect(screen.getByText(/no open positions/i)).toBeTruthy();
  });
});
