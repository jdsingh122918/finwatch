import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BacktestResults } from "../BacktestResults.js";
import type {
  BacktestConfig,
  BacktestMetrics,
  BacktestResult,
} from "@finwatch/shared";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const mockConfig: BacktestConfig = {
  id: "bt-test",
  symbols: ["AAPL"],
  startDate: "2024-01-01",
  endDate: "2024-12-31",
  timeframe: "1Day",
  initialCapital: 100000,
  riskLimits: {
    maxPositionSize: 10000,
    maxExposure: 50000,
    maxDailyTrades: 5,
    maxLossPct: 2,
    cooldownMs: 60000,
  },
  severityThreshold: "high",
  confidenceThreshold: 0.7,
  preScreenerSensitivity: 0.5,
  tradeSizingStrategy: "pct_of_capital",
  modelId: "test-model",
};

const mockMetrics: BacktestMetrics = {
  totalReturn: 5000,
  totalReturnPct: 5.0,
  sharpeRatio: 1.5,
  sortinoRatio: 2.0,
  maxDrawdownPct: 8.5,
  maxDrawdownDuration: 15,
  recoveryFactor: 0.59,
  winRate: 0.65,
  totalTrades: 20,
  profitFactor: 1.8,
  avgWinLossRatio: 1.5,
  maxConsecutiveWins: 5,
  maxConsecutiveLosses: 3,
  largestWin: 2000,
  largestLoss: -1000,
  avgTradeDuration: 48,
  monthlyReturns: [{ month: "2024-01", return: 2.5 }],
  perSymbol: {},
};

function buildResult(overrides: Partial<BacktestResult> = {}): BacktestResult {
  return {
    id: "bt-test-001",
    config: mockConfig,
    status: "completed",
    metrics: mockMetrics,
    trades: [],
    equityCurve: [
      { date: "2024-01-01", value: 100000 },
      { date: "2024-06-01", value: 103000 },
      { date: "2024-12-31", value: 105000 },
    ],
    createdAt: Date.now(),
    completedAt: Date.now(),
    error: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BacktestResults", () => {
  it("renders summary cards when metrics present", () => {
    const result = buildResult();
    render(<BacktestResults result={result} onBack={vi.fn()} />);

    expect(screen.getByText("Summary")).toBeTruthy();
    expect(screen.getByText("Total Return")).toBeTruthy();
    expect(screen.getByText("Sharpe Ratio")).toBeTruthy();
    expect(screen.getByText("Win Rate")).toBeTruthy();
  });

  it("renders no-metrics message when metrics null", () => {
    const result = buildResult({ metrics: null, status: "completed" });
    render(<BacktestResults result={result} onBack={vi.fn()} />);

    expect(screen.getByText("No metrics available.")).toBeTruthy();
  });

  it("renders equity curve with valid data", () => {
    const result = buildResult({
      equityCurve: [
        { date: "2024-01-01", value: 100000 },
        { date: "2024-06-01", value: 103000 },
        { date: "2024-12-31", value: 105000 },
      ],
    });
    const { container } = render(
      <BacktestResults result={result} onBack={vi.fn()} />,
    );

    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
    const polyline = container.querySelector("polyline");
    expect(polyline).toBeTruthy();
  });

  it("handles single-point curve", () => {
    const result = buildResult({
      equityCurve: [{ date: "2024-01-01", value: 100000 }],
    });
    render(<BacktestResults result={result} onBack={vi.fn()} />);

    expect(screen.getByText("Not enough data for chart.")).toBeTruthy();
  });

  it("fmtPct displays correctly", () => {
    const result = buildResult({
      metrics: {
        ...mockMetrics,
        totalReturnPct: 5.0,
        monthlyReturns: [{ month: "2024-01", return: 5.0 }],
      },
    });
    render(<BacktestResults result={result} onBack={vi.fn()} />);

    expect(screen.getByText("+5.00%")).toBeTruthy();
  });

  it("fmtRatio displays correctly for win rate", () => {
    const result = buildResult({
      metrics: { ...mockMetrics, winRate: 0.65 },
    });
    render(<BacktestResults result={result} onBack={vi.fn()} />);

    expect(screen.getByText("+65.00%")).toBeTruthy();
  });

  it("export buttons are rendered", () => {
    const result = buildResult();
    render(<BacktestResults result={result} onBack={vi.fn()} />);

    expect(screen.getByText("Export JSON")).toBeTruthy();
    expect(screen.getByText("Export CSV")).toBeTruthy();
  });
});
