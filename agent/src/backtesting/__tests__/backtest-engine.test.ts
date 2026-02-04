import { describe, it, expect, vi } from "vitest";
import type { BacktestConfig, DataTick, Anomaly } from "@finwatch/shared";
import { BacktestEngine } from "../backtest-engine.js";

function makeConfig(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  return {
    id: "bt-test",
    symbols: ["AAPL"],
    startDate: "2024-01-01",
    endDate: "2024-01-10",
    timeframe: "1Day",
    initialCapital: 100000,
    riskLimits: {
      maxPositionSize: 50000,
      maxExposure: 80000,
      maxDailyTrades: 10,
      maxLossPct: 5,
      cooldownMs: 0,
    },
    severityThreshold: "high",
    confidenceThreshold: 0.5,
    preScreenerSensitivity: 0.5,
    tradeSizingStrategy: "fixed_qty",
    modelId: "test-model",
    ...overrides,
  };
}

function makeTicks(): DataTick[] {
  return [
    { sourceId: "backtest", timestamp: new Date("2024-01-02").getTime(), symbol: "AAPL", metrics: { open: 180, high: 185, low: 178, close: 183, volume: 1000000 }, metadata: {} },
    { sourceId: "backtest", timestamp: new Date("2024-01-03").getTime(), symbol: "AAPL", metrics: { open: 183, high: 190, low: 182, close: 188, volume: 1500000 }, metadata: {} },
    { sourceId: "backtest", timestamp: new Date("2024-01-04").getTime(), symbol: "AAPL", metrics: { open: 188, high: 195, low: 187, close: 193, volume: 2000000 }, metadata: {} },
  ];
}

describe("BacktestEngine", () => {
  it("constructs with valid config", () => {
    const engine = new BacktestEngine(makeConfig());
    expect(engine).toBeDefined();
  });

  it("runs a backtest with mock data fetcher and analysis", async () => {
    const config = makeConfig();
    const ticks = makeTicks();

    const fetchData = vi.fn().mockResolvedValue(ticks);

    const anomaly: Anomaly = {
      id: "anom-1",
      severity: "high",
      source: "backtest",
      symbol: "AAPL",
      timestamp: ticks[2].timestamp,
      description: "Price spike detected",
      metrics: { close: 193, volume: 2000000 },
      preScreenScore: 0.85,
      sessionId: "bt-test",
    };
    const runAnalysis = vi.fn().mockResolvedValue([anomaly]);

    const progressEvents: unknown[] = [];
    const onProgress = vi.fn((p) => progressEvents.push(p));

    const engine = new BacktestEngine(config, { fetchData, runAnalysis });
    engine.onProgress = onProgress;

    const result = await engine.run();

    expect(result.status).toBe("completed");
    expect(result.config).toEqual(config);
    expect(fetchData).toHaveBeenCalled();
    expect(runAnalysis).toHaveBeenCalled();
    expect(result.equityCurve.length).toBeGreaterThan(0);
    expect(result.metrics).not.toBeNull();
    expect(onProgress).toHaveBeenCalled();
  });

  it("can be cancelled", async () => {
    const config = makeConfig();
    const fetchData = vi.fn().mockResolvedValue(makeTicks());
    const runAnalysis = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 100))
    );

    const engine = new BacktestEngine(config, { fetchData, runAnalysis });

    const runPromise = engine.run();
    engine.cancel();

    const result = await runPromise;
    expect(result.status).toBe("cancelled");
  });

  it("returns failed status on data fetch error", async () => {
    const config = makeConfig();
    const fetchData = vi.fn().mockRejectedValue(new Error("API error"));
    const runAnalysis = vi.fn();

    const engine = new BacktestEngine(config, { fetchData, runAnalysis });
    const result = await engine.run();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("API error");
  });
});
