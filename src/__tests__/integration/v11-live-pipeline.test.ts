import { describe, it, expect } from "vitest";
import { createDataSlice } from "../../store/data-slice.js";
import { createAnomalySlice } from "../../store/anomaly-slice.js";
import { createAgentSlice } from "../../store/agent-slice.js";

describe("v11: live pipeline integration", () => {
  it("data store updates on simulated data:tick event", () => {
    const data = createDataSlice();
    const before = data.getState().ticks.length;

    data.getState().addTick({
      sourceId: "alpaca-stream",
      timestamp: Date.now(),
      symbol: "AAPL",
      metrics: { close: 185.50, volume: 1000000 },
      metadata: { source: "alpaca" },
    });

    expect(data.getState().ticks.length).toBe(before + 1);
    expect(data.getState().ticks[0]!.symbol).toBe("AAPL");
  });

  it("anomaly store updates on simulated anomaly:detected event", () => {
    const anomaly = createAnomalySlice();
    const before = anomaly.getState().anomalies.length;

    anomaly.getState().addAnomaly({
      id: "test-anomaly-1",
      severity: "high",
      description: "Unusual volume spike on AAPL",
      source: "alpaca-stream",
      timestamp: Date.now(),
      metrics: { volume: 5000000 },
      preScreenScore: 0.85,
      sessionId: "session-001",
    });

    expect(anomaly.getState().anomalies.length).toBe(before + 1);
    expect(anomaly.getState().anomalies[0]!.id).toBe("test-anomaly-1");
  });

  it("agent store updates on simulated agent:activity event", () => {
    const agent = createAgentSlice();

    agent.getState().addActivity({
      type: "cycle_end",
      message: "Cycle complete: 1 anomaly from 10 ticks",
      timestamp: Date.now(),
      data: { anomalyCount: 1, tickCount: 10 },
    });

    expect(agent.getState().activityLog.length).toBeGreaterThan(0);
    expect(agent.getState().activityLog[0]!.type).toBe("cycle_end");
  });

  it("multiple ticks accumulate correctly", () => {
    const data = createDataSlice();

    const symbols = ["AAPL", "TSLA", "MSFT"];
    for (const symbol of symbols) {
      data.getState().addTick({
        sourceId: "alpaca-stream",
        timestamp: Date.now(),
        symbol,
        metrics: { close: 150, volume: 500000 },
        metadata: {},
      });
    }

    expect(data.getState().ticks.length).toBe(3);
    const latest = data.getState().latestBySymbol();
    expect(latest.size).toBe(3);
  });

  it("anomaly feedback integrates with anomaly store", () => {
    const anomaly = createAnomalySlice();

    anomaly.getState().addAnomaly({
      id: "fb-test-1",
      severity: "medium",
      description: "Test anomaly",
      source: "test",
      timestamp: Date.now(),
      metrics: {},
      preScreenScore: 0.5,
      sessionId: "s1",
    });

    anomaly.getState().addFeedback("fb-test-1", "confirmed");

    expect(anomaly.getState().feedbackMap.get("fb-test-1")).toBe("confirmed");
  });
});
