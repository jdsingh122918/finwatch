import { describe, it, expect, beforeEach } from "vitest";
import { createBacktestSlice } from "../backtest-slice.js";
import type { BacktestResult, BacktestProgress } from "@finwatch/shared";

const mockResult: BacktestResult = {
  id: "bt-001",
  config: {
    id: "bt-001",
    symbols: ["AAPL"],
    startDate: "2024-01-01",
    endDate: "2024-12-31",
    timeframe: "1Day",
    initialCapital: 100000,
    riskLimits: { maxPositionSize: 10000, maxExposure: 50000, maxDailyTrades: 5, maxLossPct: 2, cooldownMs: 60000 },
    severityThreshold: "high",
    confidenceThreshold: 0.7,
    preScreenerSensitivity: 0.5,
    tradeSizingStrategy: "pct_of_capital",
    modelId: "test-model",
  },
  status: "completed",
  metrics: null,
  trades: [],
  equityCurve: [],
  createdAt: Date.now(),
  completedAt: Date.now(),
  error: null,
};

describe("backtest-slice", () => {
  let slice: ReturnType<typeof createBacktestSlice>;

  beforeEach(() => {
    slice = createBacktestSlice();
  });

  it("starts with empty state", () => {
    const state = slice.getState();
    expect(state.runs).toEqual([]);
    expect(state.activeRunId).toBeNull();
    expect(state.progress).toBeNull();
    expect(state.comparisonIds).toEqual([]);
  });

  it("sets active run id", () => {
    slice.getState().setActiveRunId("bt-001");
    expect(slice.getState().activeRunId).toBe("bt-001");
  });

  it("sets progress", () => {
    const progress: BacktestProgress = {
      backtestId: "bt-001",
      ticksProcessed: 50,
      totalTicks: 200,
      anomaliesFound: 3,
      tradesExecuted: 1,
      currentDate: "2024-03-15",
    };
    slice.getState().setProgress(progress);
    expect(slice.getState().progress).toEqual(progress);
  });

  it("adds a completed run", () => {
    slice.getState().addRun(mockResult);
    expect(slice.getState().runs).toHaveLength(1);
    expect(slice.getState().runs[0].id).toBe("bt-001");
  });

  it("removes a run", () => {
    slice.getState().addRun(mockResult);
    slice.getState().removeRun("bt-001");
    expect(slice.getState().runs).toHaveLength(0);
  });

  it("sets comparison ids", () => {
    slice.getState().setComparisonIds(["bt-001", "bt-002"]);
    expect(slice.getState().comparisonIds).toEqual(["bt-001", "bt-002"]);
  });

  it("addRun replaces existing run with same id", () => {
    slice.getState().addRun(mockResult);
    expect(slice.getState().runs).toHaveLength(1);

    const updatedResult: BacktestResult = {
      ...mockResult,
      status: "failed",
      error: "timeout",
    };
    slice.getState().addRun(updatedResult);

    expect(slice.getState().runs).toHaveLength(1);
    expect(slice.getState().runs[0].id).toBe("bt-001");
    expect(slice.getState().runs[0].status).toBe("failed");
    expect(slice.getState().runs[0].error).toBe("timeout");
  });

  it("addRun prepends new runs to front", () => {
    slice.getState().addRun(mockResult);

    const secondResult: BacktestResult = {
      ...mockResult,
      id: "bt-002",
      config: { ...mockResult.config, id: "bt-002" },
    };
    slice.getState().addRun(secondResult);

    expect(slice.getState().runs).toHaveLength(2);
    expect(slice.getState().runs[0].id).toBe("bt-002");
    expect(slice.getState().runs[1].id).toBe("bt-001");
  });

  it("clears progress when run completes", () => {
    slice.getState().setProgress({
      backtestId: "bt-001",
      ticksProcessed: 50,
      totalTicks: 200,
      anomaliesFound: 3,
      tradesExecuted: 1,
      currentDate: "2024-03-15",
    });
    slice.getState().addRun(mockResult);
    slice.getState().clearProgress();
    expect(slice.getState().progress).toBeNull();
  });
});
