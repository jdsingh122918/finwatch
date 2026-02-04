import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AgentLog } from "../AgentLog.js";
import type { AgentStatus } from "@finwatch/shared";

const idleStatus: AgentStatus = { state: "idle", totalCycles: 0, totalAnomalies: 0, uptime: 0 };

describe("AgentLog", () => {
  it("renders heading", () => {
    render(<AgentLog status={idleStatus} log={[]} />);
    expect(screen.getByText("Agent")).toBeTruthy();
  });

  it("shows status metrics", () => {
    render(
      <AgentLog
        status={{ state: "running", totalCycles: 10, totalAnomalies: 3, uptime: 120 }}
        log={[]}
      />,
    );
    expect(screen.getByText("RUNNING")).toBeTruthy();
    expect(screen.getByText("10")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("2m")).toBeTruthy();
  });

  it("shows empty log message", () => {
    render(<AgentLog status={idleStatus} log={[]} />);
    expect(screen.getByText(/no activity/i)).toBeTruthy();
  });

  it("renders log entries", () => {
    const log = [
      { type: "cycle_start" as const, message: "Cycle started", timestamp: Date.now() },
      { type: "error" as const, message: "Connection failed", timestamp: Date.now() },
    ];
    render(<AgentLog status={idleStatus} log={log} />);
    expect(screen.getByText(/cycle started/i)).toBeTruthy();
    expect(screen.getByText(/connection failed/i)).toBeTruthy();
  });
});
