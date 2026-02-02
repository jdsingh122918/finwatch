import { describe, it, expect, beforeEach } from "vitest";
import { createAnomalySlice, AnomalySlice } from "../anomaly-slice.js";
import type { Anomaly } from "@finwatch/shared";

describe("anomalySlice", () => {
  let slice: AnomalySlice;
  beforeEach(() => {
    slice = createAnomalySlice();
  });

  const anomaly: Anomaly = {
    id: "a1",
    severity: "high",
    source: "yahoo",
    symbol: "AAPL",
    timestamp: 1000,
    description: "Volume spike",
    metrics: { volume: 5e6 },
    preScreenScore: 0.85,
    sessionId: "s1",
  };

  it("starts empty", () => {
    expect(slice.getState().anomalies).toHaveLength(0);
  });

  it("adds anomaly", () => {
    slice.getState().addAnomaly(anomaly);
    expect(slice.getState().anomalies).toHaveLength(1);
  });

  it("filters by severity", () => {
    slice.getState().addAnomaly(anomaly);
    slice.getState().addAnomaly({ ...anomaly, id: "a2", severity: "low" });
    expect(slice.getState().filterBySeverity("high")).toHaveLength(1);
  });

  it("tracks feedback submission", () => {
    slice.getState().addAnomaly(anomaly);
    slice.getState().addFeedback("a1", "confirmed");
    expect(slice.getState().feedbackMap.get("a1")).toBe("confirmed");
  });
});
