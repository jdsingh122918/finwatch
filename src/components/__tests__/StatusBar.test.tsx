import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBar } from "../StatusBar.js";

describe("StatusBar", () => {
  it("renders agent state", () => {
    render(
      <StatusBar
        agentState="running"
        totalCycles={42}
        totalAnomalies={5}
        tickCount={100}
        symbolCount={3}
        tradingMode="paper"
        killSwitchActive={false}
      />,
    );
    expect(screen.getByText("RUNNING")).toBeTruthy();
  });

  it("renders trading mode", () => {
    render(
      <StatusBar
        agentState="idle"
        totalCycles={0}
        totalAnomalies={0}
        tickCount={0}
        symbolCount={0}
        tradingMode="paper"
        killSwitchActive={false}
      />,
    );
    expect(screen.getByText("PAPER")).toBeTruthy();
  });

  it("shows kill switch when active", () => {
    render(
      <StatusBar
        agentState="idle"
        totalCycles={0}
        totalAnomalies={0}
        tickCount={0}
        symbolCount={0}
        tradingMode="live"
        killSwitchActive={true}
      />,
    );
    expect(screen.getByText("KILL SWITCH")).toBeTruthy();
  });
});
