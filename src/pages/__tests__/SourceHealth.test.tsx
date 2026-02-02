import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SourceHealth } from "../SourceHealth.js";

describe("SourceHealth", () => {
  it("renders source statuses", () => {
    const sources = {
      yahoo: {
        sourceId: "yahoo",
        status: "healthy" as const,
        lastSuccess: 1000,
        failCount: 0,
        latencyMs: 50,
      },
    };
    render(<SourceHealth sources={sources} />);
    expect(screen.getByText(/yahoo/)).toBeTruthy();
    expect(screen.getByText(/healthy/i)).toBeTruthy();
  });

  it("shows empty state", () => {
    render(<SourceHealth sources={{}} />);
    expect(screen.getByText(/no sources/i)).toBeTruthy();
  });
});
