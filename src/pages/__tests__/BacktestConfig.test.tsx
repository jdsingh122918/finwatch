import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BacktestConfigPage } from "../BacktestConfig.js";

// ---------------------------------------------------------------------------
// Default props
// ---------------------------------------------------------------------------

const defaultProps = {
  progress: null,
  onProgress: vi.fn(),
  onComplete: vi.fn(),
  runs: [] as { id: string; status: string; startDate: string; endDate: string; totalReturnPct?: number }[],
  onViewResult: vi.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BacktestConfigPage", () => {
  it("renders all form fields", () => {
    render(<BacktestConfigPage {...defaultProps} />);

    expect(screen.getByText(/Symbols/i)).toBeTruthy();
    expect(screen.getByText(/Start Date/i)).toBeTruthy();
    expect(screen.getByText(/End Date/i)).toBeTruthy();
    expect(screen.getByText(/Initial Capital/i)).toBeTruthy();
    expect(screen.getByText(/Sizing Strategy/i)).toBeTruthy();
    expect(screen.getByText(/Max Position Size/i)).toBeTruthy();
    expect(screen.getByText(/Max Exposure/i)).toBeTruthy();
    expect(screen.getByText(/Max Daily Trades/i)).toBeTruthy();
    expect(screen.getByText(/Max Loss/i)).toBeTruthy();
    expect(screen.getByText(/Severity Threshold/i)).toBeTruthy();
    expect(screen.getByText(/Pre-Screener Sensitivity/i)).toBeTruthy();
    expect(screen.getByText(/Confidence Threshold/i)).toBeTruthy();
    expect(screen.getByText(/LLM Model/i)).toBeTruthy();
  });

  it("renders start button", () => {
    render(<BacktestConfigPage {...defaultProps} />);

    expect(screen.getByText("Start Backtest")).toBeTruthy();
  });

  it("displays progress section only when running", () => {
    const progress = {
      backtestId: "bt-123",
      ticksProcessed: 50,
      totalTicks: 100,
      anomaliesFound: 3,
      tradesExecuted: 2,
      currentDate: "2024-06-15",
    };
    render(<BacktestConfigPage {...defaultProps} progress={progress} />);

    // running starts as false, so progress section should NOT render even if progress is provided
    expect(screen.queryByText(/50 \/ 100 ticks/)).toBeNull();
  });

  it("displays recent runs", () => {
    const runs = [
      { id: "bt-run-abc123", status: "completed", startDate: "2024-01-01", endDate: "2024-06-30", totalReturnPct: 4.5 },
      { id: "bt-run-def456", status: "failed", startDate: "2024-03-01", endDate: "2024-09-30" },
    ];
    render(<BacktestConfigPage {...defaultProps} runs={runs} />);

    expect(screen.getByText("bt-run-abc12")).toBeTruthy();
    expect(screen.getByText("bt-run-def45")).toBeTruthy();
  });

  it("renders validation section", () => {
    render(<BacktestConfigPage {...defaultProps} />);

    // All form fields should be present
    expect(screen.getByText(/Symbols/i)).toBeTruthy();
    expect(screen.getByText(/Start Date/i)).toBeTruthy();
    expect(screen.getByText(/End Date/i)).toBeTruthy();

    // Start button should be present
    expect(screen.getByText("Start Backtest")).toBeTruthy();
  });

  it("renders daily and hourly timeframe buttons", () => {
    render(<BacktestConfigPage {...defaultProps} />);

    expect(screen.getByText("Daily")).toBeTruthy();
    expect(screen.getByText("Hourly")).toBeTruthy();
  });
});
