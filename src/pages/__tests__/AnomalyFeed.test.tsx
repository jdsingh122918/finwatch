import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AnomalyFeed } from "../AnomalyFeed.js";

const now = Date.now();

const mockAnomaly = {
  id: "a1",
  source: "yahoo",
  severity: "critical" as const,
  symbol: "AAPL",
  description: "Price spike detected",
  timestamp: now,
  metrics: { priceChange: 0.15, volume: 1000000 },
  preScreenScore: 0.85,
  sessionId: "test-session",
};

const mockAnomalies = [
  mockAnomaly,
  {
    id: "a2",
    source: "polygon",
    severity: "low" as const,
    symbol: "GOOGL",
    description: "Volume dip",
    timestamp: now - 3600_000, // 1 hour ago
    metrics: { volumeChange: -0.2 } as Record<string, number>,
    preScreenScore: 0.4,
    sessionId: "test-session",
  },
  {
    id: "a3",
    source: "yahoo",
    severity: "high" as const,
    symbol: "AAPL",
    description: "Unusual activity",
    timestamp: now - 7200_000, // 2 hours ago
    metrics: {} as Record<string, number>,
    preScreenScore: 0.6,
    sessionId: "test-session",
  },
];

describe("AnomalyFeed", () => {
  it("renders heading", () => {
    render(<AnomalyFeed anomalies={[]} feedbackMap={new Map()} onFeedback={vi.fn()} />);
    expect(screen.getByText("Anomaly Feed")).toBeTruthy();
  });

  it("shows empty state", () => {
    render(<AnomalyFeed anomalies={[]} feedbackMap={new Map()} onFeedback={vi.fn()} />);
    expect(screen.getByText(/no anomalies/i)).toBeTruthy();
  });

  it("renders anomaly with severity dot", () => {
    render(
      <AnomalyFeed anomalies={[mockAnomaly]} feedbackMap={new Map()} onFeedback={vi.fn()} />,
    );
    expect(screen.getByText("AAPL")).toBeTruthy();
    expect(screen.getByText(/price spike/i)).toBeTruthy();
  });

  it("renders feedback buttons", () => {
    render(
      <AnomalyFeed anomalies={[mockAnomaly]} feedbackMap={new Map()} onFeedback={vi.fn()} />,
    );
    expect(screen.getByText("CONFIRM")).toBeTruthy();
    expect(screen.getByText("FALSE+")).toBeTruthy();
    expect(screen.getByText("REVIEW")).toBeTruthy();
  });

  it("calls onFeedback when button clicked", () => {
    const handler = vi.fn();
    render(
      <AnomalyFeed anomalies={[mockAnomaly]} feedbackMap={new Map()} onFeedback={handler} />,
    );
    fireEvent.click(screen.getByText("CONFIRM"));
    expect(handler).toHaveBeenCalledWith("a1", "confirmed");
  });

  it("shows verdict when feedback exists", () => {
    const map = new Map([["a1", "confirmed" as const]]);
    render(<AnomalyFeed anomalies={[mockAnomaly]} feedbackMap={map} onFeedback={vi.fn()} />);
    expect(screen.getByText("confirmed")).toBeTruthy();
    expect(screen.queryByText("CONFIRM")).toBeNull();
  });

  it("renders severity filter buttons", () => {
    render(<AnomalyFeed anomalies={mockAnomalies} feedbackMap={new Map()} onFeedback={vi.fn()} />);
    expect(screen.getByText("ALL")).toBeTruthy();
    expect(screen.getByText("CRITICAL")).toBeTruthy();
    expect(screen.getByText("HIGH")).toBeTruthy();
    expect(screen.getByText("MEDIUM")).toBeTruthy();
    expect(screen.getByText("LOW")).toBeTruthy();
  });

  it("filters by severity when button clicked", () => {
    render(<AnomalyFeed anomalies={mockAnomalies} feedbackMap={new Map()} onFeedback={vi.fn()} />);
    fireEvent.click(screen.getByText("LOW"));
    expect(screen.getByText("GOOGL")).toBeTruthy();
    expect(screen.queryByText("Price spike detected")).toBeNull();
    expect(screen.queryByText("Unusual activity")).toBeNull();
  });

  it("renders symbol filter input", () => {
    render(<AnomalyFeed anomalies={mockAnomalies} feedbackMap={new Map()} onFeedback={vi.fn()} />);
    expect(screen.getByPlaceholderText("Filter symbol...")).toBeTruthy();
  });

  it("filters by symbol text input", () => {
    render(<AnomalyFeed anomalies={mockAnomalies} feedbackMap={new Map()} onFeedback={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("Filter symbol..."), { target: { value: "GOOGL" } });
    expect(screen.getByText("GOOGL")).toBeTruthy();
    expect(screen.queryByText("Price spike detected")).toBeNull();
  });

  it("renders time filter dropdown", () => {
    render(<AnomalyFeed anomalies={mockAnomalies} feedbackMap={new Map()} onFeedback={vi.fn()} />);
    expect(screen.getByDisplayValue("All Time")).toBeTruthy();
  });

  it("filters by time when dropdown changed", () => {
    render(<AnomalyFeed anomalies={mockAnomalies} feedbackMap={new Map()} onFeedback={vi.fn()} />);
    fireEvent.change(screen.getByDisplayValue("All Time"), { target: { value: "30m" } });
    // Only the most recent anomaly (mockAnomaly, now) should remain visible
    expect(screen.getByText("Price spike detected")).toBeTruthy();
    expect(screen.queryByText("Volume dip")).toBeNull();
    expect(screen.queryByText("Unusual activity")).toBeNull();
  });

  it("shows ALL severity button active by default", () => {
    render(<AnomalyFeed anomalies={mockAnomalies} feedbackMap={new Map()} onFeedback={vi.fn()} />);
    const allBtn = screen.getByText("ALL");
    expect(allBtn.className).toContain("text-accent");
  });

  it("resets to all when ALL clicked after filtering", () => {
    render(<AnomalyFeed anomalies={mockAnomalies} feedbackMap={new Map()} onFeedback={vi.fn()} />);
    fireEvent.click(screen.getByText("LOW"));
    expect(screen.queryByText("Price spike detected")).toBeNull();
    fireEvent.click(screen.getByText("ALL"));
    expect(screen.getByText("Price spike detected")).toBeTruthy();
    expect(screen.getByText("Volume dip")).toBeTruthy();
  });

  it("renders LIST and TIMELINE view toggles", () => {
    render(<AnomalyFeed anomalies={mockAnomalies} feedbackMap={new Map()} onFeedback={vi.fn()} />);
    expect(screen.getByText("LIST")).toBeTruthy();
    expect(screen.getByText("TIMELINE")).toBeTruthy();
  });

  it("switches to timeline view when TIMELINE clicked", () => {
    const { container } = render(<AnomalyFeed anomalies={mockAnomalies} feedbackMap={new Map()} onFeedback={vi.fn()} />);
    fireEvent.click(screen.getByText("TIMELINE"));
    expect(container.querySelector("svg circle")).toBeTruthy();
  });

  it("switches back to list view when LIST clicked", () => {
    render(<AnomalyFeed anomalies={mockAnomalies} feedbackMap={new Map()} onFeedback={vi.fn()} />);
    fireEvent.click(screen.getByText("TIMELINE"));
    fireEvent.click(screen.getByText("LIST"));
    expect(screen.getByText("Price spike detected")).toBeTruthy();
  });
});
