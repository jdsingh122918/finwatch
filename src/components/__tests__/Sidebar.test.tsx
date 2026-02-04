import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Sidebar } from "../Sidebar.js";

const tabs = ["Dashboard", "Watchlist", "Anomalies", "Agent", "Sources", "Backtest", "Settings"] as const;

describe("Sidebar", () => {
  it("renders all navigation items", () => {
    render(<Sidebar activeTab="Dashboard" onTabChange={vi.fn()} />);
    for (const tab of tabs) {
      expect(screen.getByTitle(tab)).toBeTruthy();
    }
  });

  it("calls onTabChange when icon is clicked", () => {
    const handler = vi.fn();
    render(<Sidebar activeTab="Dashboard" onTabChange={handler} />);
    fireEvent.click(screen.getByTitle("Anomalies"));
    expect(handler).toHaveBeenCalledWith("Anomalies");
  });

  it("marks active tab with accent styling", () => {
    render(<Sidebar activeTab="Agent" onTabChange={vi.fn()} />);
    const agentBtn = screen.getByTitle("Agent");
    expect(agentBtn.className).toContain("text-accent");
  });
});
