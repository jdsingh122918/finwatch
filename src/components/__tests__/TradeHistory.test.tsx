import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TradeHistory } from "../TradeHistory.js";
import type { TradeAuditEntry } from "@finwatch/shared";

const entries: TradeAuditEntry[] = [
  {
    id: "t-001",
    action: {
      symbol: "AAPL",
      side: "buy",
      qty: 10,
      type: "market",
      rationale: "Pattern",
      confidence: 0.85,
      anomalyId: "a-001",
    },
    anomalyId: "a-001",
    outcome: "profit",
    limitsChecked: ["maxPositionSize"],
    timestamp: Date.now() - 60000,
  },
  {
    id: "t-002",
    action: {
      symbol: "GOOGL",
      side: "sell",
      qty: 5,
      type: "limit",
      rationale: "Exit",
      confidence: 0.6,
      anomalyId: "a-002",
    },
    anomalyId: "a-002",
    outcome: "loss",
    limitsChecked: [],
    timestamp: Date.now(),
  },
];

describe("TradeHistory", () => {
  it("renders heading", () => {
    render(<TradeHistory entries={[]} />);
    expect(screen.getByText("Trade History")).toBeTruthy();
  });

  it("shows empty state", () => {
    render(<TradeHistory entries={[]} />);
    expect(screen.getByText(/no trade history/i)).toBeTruthy();
  });

  it("renders table headers", () => {
    render(<TradeHistory entries={entries} />);
    expect(screen.getByText("Time")).toBeTruthy();
    expect(screen.getByText("Symbol")).toBeTruthy();
    expect(screen.getByText("Side")).toBeTruthy();
    expect(screen.getByText("Qty")).toBeTruthy();
    expect(screen.getByText("Outcome")).toBeTruthy();
  });

  it("renders trade rows", () => {
    render(<TradeHistory entries={entries} />);
    expect(screen.getByText("AAPL")).toBeTruthy();
    expect(screen.getByText("GOOGL")).toBeTruthy();
  });

  it("shows outcome with appropriate color", () => {
    render(<TradeHistory entries={entries} />);
    const profit = screen.getByText("profit");
    expect(profit.className).toContain("text-accent");
    const loss = screen.getByText("loss");
    expect(loss.className).toContain("text-severity-critical");
  });
});
