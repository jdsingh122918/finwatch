import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TradingHub } from "../TradingHub.js";

describe("TradingHub", () => {
  const defaultProps = {
    mode: "paper" as const,
    killSwitchActive: false,
    suggestions: [],
    positions: [],
    history: [],
    onApprove: vi.fn(),
    onDismiss: vi.fn(),
    onKillSwitch: vi.fn(),
  };

  it("renders page heading", () => {
    render(<TradingHub {...defaultProps} />);
    expect(screen.getByText("Trading Hub")).toBeTruthy();
  });

  it("shows trading mode badge", () => {
    render(<TradingHub {...defaultProps} mode="paper" />);
    expect(screen.getByText("PAPER")).toBeTruthy();
  });

  it("shows live mode badge", () => {
    render(<TradingHub {...defaultProps} mode="live" />);
    expect(screen.getByText("LIVE")).toBeTruthy();
  });

  it("renders kill switch", () => {
    render(<TradingHub {...defaultProps} />);
    expect(screen.getByText("KILL SWITCH")).toBeTruthy();
  });

  it("renders risk metrics section", () => {
    render(<TradingHub {...defaultProps} />);
    expect(screen.getByText("Total Exposure")).toBeTruthy();
  });

  it("renders trade suggestions section", () => {
    render(<TradingHub {...defaultProps} />);
    expect(screen.getByText("Trade Suggestions")).toBeTruthy();
  });

  it("renders positions section", () => {
    render(<TradingHub {...defaultProps} />);
    expect(screen.getByText(/no open positions/i)).toBeTruthy();
  });

  it("renders trade history section", () => {
    render(<TradingHub {...defaultProps} />);
    expect(screen.getByText("Trade History")).toBeTruthy();
  });
});
