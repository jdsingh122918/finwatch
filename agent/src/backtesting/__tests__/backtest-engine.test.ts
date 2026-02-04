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
    const engine = new BacktestEngine(makeConfig(), {
      fetchData: vi.fn().mockResolvedValue([]),
      runAnalysis: vi.fn().mockResolvedValue([]),
    });
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
    expect(result.equityCurve.length).toBe(3); // 3 date groups
    expect(result.metrics).not.toBeNull();
    expect(typeof result.metrics!.totalTrades).toBe("number");
    expect(typeof result.metrics!.totalReturn).toBe("number");
    expect(typeof result.metrics!.winRate).toBe("number");
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

  it("handles analysis failure gracefully", async () => {
    const config = makeConfig();
    const ticks = makeTicks();
    const fetchData = vi.fn().mockResolvedValue(ticks);
    const runAnalysis = vi.fn().mockRejectedValue(new Error("LLM provider timeout"));

    const engine = new BacktestEngine(config, { fetchData, runAnalysis });
    const result = await engine.run();

    expect(result.status).toBe("failed");
    expect(result.error).toContain("LLM provider timeout");
  });

  it("filters anomalies below severity threshold", async () => {
    const config = makeConfig({ severityThreshold: "high" });
    const ticks = makeTicks();
    const fetchData = vi.fn().mockResolvedValue(ticks);

    const lowSeverityAnomaly: Anomaly = {
      id: "anom-low",
      severity: "low",
      source: "backtest",
      symbol: "AAPL",
      timestamp: ticks[2].timestamp,
      description: "Price spike detected",
      metrics: { close: 193, volume: 2000000 },
      preScreenScore: 0.85,
      sessionId: "bt-test",
    };
    const runAnalysis = vi.fn().mockResolvedValue([lowSeverityAnomaly]);

    const engine = new BacktestEngine(config, { fetchData, runAnalysis });
    const result = await engine.run();

    expect(result.status).toBe("completed");
    // No trades should be executed because the anomaly severity "low" is below the "high" threshold
    const sellTrades = result.trades.filter((t) => t.side === "sell");
    expect(sellTrades).toHaveLength(0);
  });

  it("filters anomalies below confidence threshold", async () => {
    const config = makeConfig({ confidenceThreshold: 0.8 });
    const ticks = makeTicks();
    const fetchData = vi.fn().mockResolvedValue(ticks);

    const lowConfidenceAnomaly: Anomaly = {
      id: "anom-lowconf",
      severity: "high",
      source: "backtest",
      symbol: "AAPL",
      timestamp: ticks[2].timestamp,
      description: "Price spike detected",
      metrics: { close: 193, volume: 2000000 },
      preScreenScore: 0.3,
      sessionId: "bt-test",
    };
    const runAnalysis = vi.fn().mockResolvedValue([lowConfidenceAnomaly]);

    const engine = new BacktestEngine(config, { fetchData, runAnalysis });
    const result = await engine.run();

    expect(result.status).toBe("completed");
    // No trades should be executed because preScreenScore 0.3 is below confidenceThreshold 0.8
    const sellTrades = result.trades.filter((t) => t.side === "sell");
    expect(sellTrades).toHaveLength(0);
  });

  it("returns completed with empty metrics for zero ticks", async () => {
    const config = makeConfig();
    const fetchData = vi.fn().mockResolvedValue([]);
    const runAnalysis = vi.fn();

    const engine = new BacktestEngine(config, { fetchData, runAnalysis });
    const result = await engine.run();

    expect(result.status).toBe("completed");
    expect(result.metrics).not.toBeNull();
    expect(result.metrics!.totalReturn).toBe(0);
    expect(result.metrics!.totalReturnPct).toBe(0);
    expect(result.metrics!.totalTrades).toBe(0);
    expect(result.metrics!.winRate).toBe(0);
    expect(result.metrics!.sharpeRatio).toBe(0);
    expect(result.metrics!.maxDrawdownPct).toBe(0);
    // runAnalysis should never be called when there are no ticks
    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it("handles multiple symbols correctly", async () => {
    const config = makeConfig({ symbols: ["AAPL", "TSLA"] });

    const ticks: DataTick[] = [
      { sourceId: "backtest", timestamp: new Date("2024-01-02").getTime(), symbol: "AAPL", metrics: { open: 180, high: 185, low: 178, close: 183, volume: 1000000 }, metadata: {} },
      { sourceId: "backtest", timestamp: new Date("2024-01-02").getTime(), symbol: "TSLA", metrics: { open: 240, high: 250, low: 235, close: 245, volume: 2000000 }, metadata: {} },
      { sourceId: "backtest", timestamp: new Date("2024-01-03").getTime(), symbol: "AAPL", metrics: { open: 183, high: 190, low: 182, close: 188, volume: 1500000 }, metadata: {} },
      { sourceId: "backtest", timestamp: new Date("2024-01-03").getTime(), symbol: "TSLA", metrics: { open: 245, high: 260, low: 243, close: 255, volume: 2500000 }, metadata: {} },
    ];

    const fetchData = vi.fn().mockResolvedValue(ticks);

    let callCount = 0;
    const runAnalysis = vi.fn().mockImplementation((dateTicks: DataTick[]) => {
      callCount++;
      // Day 1: volume drop -> BUY, Day 2: price spike -> SELL
      const description = callCount === 1 ? "Volume drop detected" : "Price spike detected";
      const anomalies: Anomaly[] = dateTicks.map((tick) => ({
        id: `anom-${tick.symbol}-${tick.timestamp}`,
        severity: "high" as const,
        source: "backtest",
        symbol: tick.symbol,
        timestamp: tick.timestamp,
        description,
        metrics: { close: tick.metrics.close, volume: tick.metrics.volume },
        preScreenScore: 0.85,
        sessionId: "bt-test",
      }));
      return Promise.resolve(anomalies);
    });

    const engine = new BacktestEngine(config, { fetchData, runAnalysis });
    const result = await engine.run();

    expect(result.status).toBe("completed");

    // Verify trades exist for both symbols
    const aaplTrades = result.trades.filter((t) => t.symbol === "AAPL");
    const tslaTrades = result.trades.filter((t) => t.symbol === "TSLA");
    expect(aaplTrades.length).toBeGreaterThan(0);
    expect(tslaTrades.length).toBeGreaterThan(0);
  });
});
