import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnomalyTimeline } from "../AnomalyTimeline.js";
import type { Anomaly } from "@finwatch/shared";

const now = Date.now();

const anomalies: Anomaly[] = [
  {
    id: "a1",
    severity: "critical",
    source: "yahoo",
    symbol: "AAPL",
    timestamp: now - 3600_000,
    description: "Price spike",
    metrics: {},
    preScreenScore: 0.9,
    sessionId: "s1",
  },
  {
    id: "a2",
    severity: "low",
    source: "polygon",
    symbol: "GOOGL",
    timestamp: now - 1800_000,
    description: "Volume dip",
    metrics: {},
    preScreenScore: 0.3,
    sessionId: "s1",
  },
  {
    id: "a3",
    severity: "high",
    source: "yahoo",
    symbol: "TSLA",
    timestamp: now,
    description: "Unusual activity",
    metrics: {},
    preScreenScore: 0.7,
    sessionId: "s1",
  },
];

describe("AnomalyTimeline", () => {
  it("renders an SVG element", () => {
    const { container } = render(<AnomalyTimeline anomalies={anomalies} />);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("renders a circle for each anomaly", () => {
    const { container } = render(<AnomalyTimeline anomalies={anomalies} />);
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBe(3);
  });

  it("uses severity colors for dots", () => {
    const { container } = render(<AnomalyTimeline anomalies={anomalies} />);
    const circles = container.querySelectorAll("circle");
    // First anomaly is critical (#ef4444), sorted by time
    const fills = Array.from(circles).map((c) => c.getAttribute("fill"));
    expect(fills).toContain("#ef4444"); // critical
    expect(fills).toContain("#22c55e"); // low
    expect(fills).toContain("#f97316"); // high
  });

  it("shows empty state when no anomalies", () => {
    render(<AnomalyTimeline anomalies={[]} />);
    expect(screen.getByText(/no anomalies to display/i)).toBeTruthy();
  });

  it("positions dots along timeline (left to right by time)", () => {
    const { container } = render(<AnomalyTimeline anomalies={anomalies} />);
    const circles = container.querySelectorAll("circle");
    const xPositions = Array.from(circles).map((c) => Number(c.getAttribute("cx")));
    // Should be sorted left to right (earliest to latest)
    for (let i = 1; i < xPositions.length; i++) {
      expect(xPositions[i]!).toBeGreaterThanOrEqual(xPositions[i - 1]!);
    }
  });
});
