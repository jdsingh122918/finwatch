import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AnomalyFeed } from "../AnomalyFeed.js";

const mockAnomaly = {
  id: "a1",
  source: "yahoo",
  severity: "critical" as const,
  symbol: "AAPL",
  description: "Price spike detected",
  timestamp: Date.now(),
  metrics: { priceChange: 0.15, volume: 1000000 },
  preScreenScore: 0.85,
  sessionId: "test-session",
};

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
});
