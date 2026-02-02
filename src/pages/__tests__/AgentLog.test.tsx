import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentLog } from "../AgentLog.js";
import type { AgentActivity, AgentStatus } from "@finwatch/shared";

describe("AgentLog", () => {
  const status: AgentStatus = {
    state: "running",
    totalCycles: 5,
    totalAnomalies: 2,
    uptime: 3600,
  };
  const log: AgentActivity[] = [
    { type: "cycle_start", message: "Cycle 1 started", timestamp: 1000 },
    {
      type: "anomaly_detected",
      message: "AAPL volume spike",
      timestamp: 2000,
    },
  ];

  it("renders status", () => {
    render(<AgentLog status={status} log={log} />);
    expect(screen.getByText(/running/i)).toBeTruthy();
  });

  it("renders log entries", () => {
    render(<AgentLog status={status} log={log} />);
    expect(screen.getByText(/Cycle 1 started/)).toBeTruthy();
    expect(screen.getByText(/AAPL volume spike/)).toBeTruthy();
  });

  it("shows empty state", () => {
    render(
      <AgentLog
        status={{
          state: "idle",
          totalCycles: 0,
          totalAnomalies: 0,
          uptime: 0,
        }}
        log={[]}
      />,
    );
    expect(screen.getByText(/no activity/i)).toBeTruthy();
  });
});
