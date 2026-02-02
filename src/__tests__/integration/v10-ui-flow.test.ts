// src/__tests__/integration/v10-ui-flow.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createDataSlice } from "../../store/data-slice.js";
import { createAnomalySlice } from "../../store/anomaly-slice.js";
import { createAgentSlice } from "../../store/agent-slice.js";
import type { DataTick, Anomaly, AgentActivity } from "@finwatch/shared";

describe("V10: Full UI Flow Integration", () => {
  let dataStore: ReturnType<typeof createDataSlice>;
  let anomalyStore: ReturnType<typeof createAnomalySlice>;
  let agentStore: ReturnType<typeof createAgentSlice>;

  beforeEach(() => {
    dataStore = createDataSlice();
    anomalyStore = createAnomalySlice();
    agentStore = createAgentSlice();
  });

  it("data tick flows into store and is accessible", () => {
    const tick: DataTick = {
      sourceId: "yahoo",
      timestamp: Date.now(),
      metrics: { close: 150.25, volume: 1000000 },
      metadata: {},
    };

    dataStore.getState().addTick(tick);

    expect(dataStore.getState().ticks).toHaveLength(1);
    expect(dataStore.getState().ticks[0]!.metrics.close).toBe(150.25);
  });

  it("anomaly appears in store after detection", () => {
    const anomaly: Anomaly = {
      id: "anomaly-1",
      severity: "high",
      source: "yahoo",
      symbol: "AAPL",
      timestamp: Date.now(),
      description: "Unusual price spike detected",
      metrics: { close: 500, volume: 10000000 },
      preScreenScore: 0.85,
      sessionId: "session-1",
    };

    anomalyStore.getState().addAnomaly(anomaly);

    expect(anomalyStore.getState().anomalies).toHaveLength(1);
    expect(anomalyStore.getState().anomalies[0]!.severity).toBe("high");
    expect(anomalyStore.getState().anomalies[0]!.description).toContain(
      "spike",
    );
  });

  it("agent activity log updates", () => {
    const activity: AgentActivity = {
      type: "anomaly_detected",
      message: "Detected price anomaly in AAPL",
      timestamp: Date.now(),
      data: { symbol: "AAPL", severity: "high" },
    };

    agentStore.getState().addActivity(activity);

    expect(agentStore.getState().activityLog).toHaveLength(1);
    expect(agentStore.getState().activityLog[0]!.type).toBe(
      "anomaly_detected",
    );
  });

  it("full flow: tick -> anomaly -> activity all update together", () => {
    const tick: DataTick = {
      sourceId: "yahoo",
      timestamp: Date.now(),
      metrics: { close: 500 },
      metadata: {},
    };

    const anomaly: Anomaly = {
      id: "a1",
      severity: "critical",
      source: "yahoo",
      timestamp: Date.now(),
      description: "Price spike",
      metrics: { close: 500 },
      preScreenScore: 0.9,
      sessionId: "s1",
    };

    const activity: AgentActivity = {
      type: "anomaly_detected",
      message: "Critical anomaly",
      timestamp: Date.now(),
    };

    // Simulate full pipeline
    dataStore.getState().addTick(tick);
    anomalyStore.getState().addAnomaly(anomaly);
    agentStore.getState().addActivity(activity);

    expect(dataStore.getState().ticks).toHaveLength(1);
    expect(anomalyStore.getState().anomalies).toHaveLength(1);
    expect(agentStore.getState().activityLog).toHaveLength(1);

    // Verify cross-store consistency
    expect(anomalyStore.getState().anomalies[0]!.severity).toBe("critical");
    expect(agentStore.getState().activityLog[0]!.type).toBe(
      "anomaly_detected",
    );
  });
});
