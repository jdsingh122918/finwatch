import { describe, it, expect, beforeEach } from "vitest";
import { createAgentSlice, AgentSlice } from "../agent-slice.js";
import type { AgentActivity } from "@finwatch/shared";

describe("agentSlice", () => {
  let slice: AgentSlice;
  beforeEach(() => {
    slice = createAgentSlice();
  });

  it("starts idle", () => {
    expect(slice.getState().status.state).toBe("idle");
  });

  it("updates status", () => {
    slice
      .getState()
      .setStatus({ state: "running", totalCycles: 1, totalAnomalies: 0, uptime: 10 });
    expect(slice.getState().status.state).toBe("running");
  });

  it("appends activity log", () => {
    const activity: AgentActivity = {
      type: "cycle_start",
      message: "Cycle 1 started",
      timestamp: 1000,
    };
    slice.getState().addActivity(activity);
    expect(slice.getState().activityLog).toHaveLength(1);
  });

  it("limits activity log size", () => {
    for (let i = 0; i < 300; i++) {
      slice
        .getState()
        .addActivity({ type: "cycle_start", message: `Cycle ${i}`, timestamp: i });
    }
    expect(slice.getState().activityLog.length).toBeLessThanOrEqual(200);
  });
});
