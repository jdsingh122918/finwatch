import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TradeSuggestions } from "../TradeSuggestions.js";
import type { TradeSuggestion } from "@finwatch/shared";

const suggestion: TradeSuggestion = {
  id: "s-001",
  action: {
    symbol: "AAPL",
    side: "buy",
    qty: 10,
    type: "market",
    rationale: "Anomaly detected in price pattern",
    confidence: 0.85,
    anomalyId: "a-001",
  },
  expiresAt: Date.now() + 300000,
  status: "pending",
};

describe("TradeSuggestions", () => {
  it("renders heading", () => {
    render(<TradeSuggestions suggestions={[]} onApprove={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText("Trade Suggestions")).toBeTruthy();
  });

  it("shows empty state", () => {
    render(<TradeSuggestions suggestions={[]} onApprove={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText(/no pending suggestions/i)).toBeTruthy();
  });

  it("renders suggestion details", () => {
    render(<TradeSuggestions suggestions={[suggestion]} onApprove={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText("AAPL")).toBeTruthy();
    expect(screen.getByText("BUY")).toBeTruthy();
    expect(screen.getByText("10")).toBeTruthy();
    expect(screen.getByText("85%")).toBeTruthy();
  });

  it("renders approve and dismiss buttons", () => {
    render(<TradeSuggestions suggestions={[suggestion]} onApprove={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText("APPROVE")).toBeTruthy();
    expect(screen.getByText("DISMISS")).toBeTruthy();
  });

  it("calls onApprove with suggestion id", () => {
    const handler = vi.fn();
    render(<TradeSuggestions suggestions={[suggestion]} onApprove={handler} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByText("APPROVE"));
    expect(handler).toHaveBeenCalledWith("s-001");
  });

  it("calls onDismiss with suggestion id", () => {
    const handler = vi.fn();
    render(<TradeSuggestions suggestions={[suggestion]} onApprove={vi.fn()} onDismiss={handler} />);
    fireEvent.click(screen.getByText("DISMISS"));
    expect(handler).toHaveBeenCalledWith("s-001");
  });

  it("shows rationale text", () => {
    render(<TradeSuggestions suggestions={[suggestion]} onApprove={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText("Anomaly detected in price pattern")).toBeTruthy();
  });
});
