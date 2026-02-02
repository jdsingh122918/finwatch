import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AnomalyFeed } from "../AnomalyFeed.js";
import type { Anomaly, FeedbackVerdict } from "@finwatch/shared";

const anomaly: Anomaly = {
  id: "a1",
  severity: "high",
  source: "yahoo",
  symbol: "AAPL",
  timestamp: 1000,
  description: "Volume spike detected",
  metrics: { volume: 5e6 },
  preScreenScore: 0.85,
  sessionId: "s1",
};

describe("AnomalyFeed", () => {
  it("renders anomaly description", () => {
    render(
      <AnomalyFeed
        anomalies={[anomaly]}
        feedbackMap={new Map()}
        onFeedback={vi.fn()}
      />,
    );
    expect(screen.getByText(/Volume spike detected/)).toBeTruthy();
  });

  it("shows severity badge", () => {
    render(
      <AnomalyFeed
        anomalies={[anomaly]}
        feedbackMap={new Map()}
        onFeedback={vi.fn()}
      />,
    );
    expect(screen.getByText(/high/i)).toBeTruthy();
  });

  it("calls onFeedback when button clicked", () => {
    const onFeedback = vi.fn();
    render(
      <AnomalyFeed
        anomalies={[anomaly]}
        feedbackMap={new Map()}
        onFeedback={onFeedback}
      />,
    );
    fireEvent.click(screen.getByText(/confirm/i));
    expect(onFeedback).toHaveBeenCalledWith("a1", "confirmed");
  });

  it("shows empty state", () => {
    render(
      <AnomalyFeed
        anomalies={[]}
        feedbackMap={new Map()}
        onFeedback={vi.fn()}
      />,
    );
    expect(screen.getByText(/no anomalies/i)).toBeTruthy();
  });

  it("shows feedback status for submitted anomalies", () => {
    const map = new Map<string, FeedbackVerdict>([["a1", "confirmed"]]);
    render(
      <AnomalyFeed
        anomalies={[anomaly]}
        feedbackMap={map}
        onFeedback={vi.fn()}
      />,
    );
    expect(screen.getByText(/confirmed/i)).toBeTruthy();
  });
});
