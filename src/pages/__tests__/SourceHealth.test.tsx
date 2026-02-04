import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourceHealth } from "../SourceHealth.js";

describe("SourceHealth", () => {
  it("renders heading", () => {
    render(<SourceHealth sources={{}} />);
    expect(screen.getByText("Sources")).toBeTruthy();
  });

  it("shows empty state", () => {
    render(<SourceHealth sources={{}} />);
    expect(screen.getByText(/no sources/i)).toBeTruthy();
  });

  it("renders source rows with status", () => {
    const sources = {
      yahoo: {
        sourceId: "yahoo",
        status: "healthy" as const,
        latencyMs: 42,
        failCount: 0,
        lastSuccess: Date.now(),
      },
      polygon: {
        sourceId: "polygon",
        status: "degraded" as const,
        latencyMs: 350,
        failCount: 2,
        lastSuccess: Date.now(),
      },
    };
    render(<SourceHealth sources={sources} />);
    expect(screen.getByText("yahoo")).toBeTruthy();
    expect(screen.getByText("HEALTHY")).toBeTruthy();
    expect(screen.getByText("polygon")).toBeTruthy();
    expect(screen.getByText("DEGRADED")).toBeTruthy();
  });
});
