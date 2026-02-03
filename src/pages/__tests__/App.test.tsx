import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "../../App.js";

describe("App shell", () => {
  it("renders sidebar navigation items", () => {
    render(<App />);
    expect(screen.getByTitle("Dashboard")).toBeTruthy();
    expect(screen.getByTitle("Anomalies")).toBeTruthy();
    expect(screen.getByTitle("Agent")).toBeTruthy();
    expect(screen.getByTitle("Sources")).toBeTruthy();
    expect(screen.getByTitle("Settings")).toBeTruthy();
  });

  it("switches pages on sidebar click", () => {
    render(<App />);
    fireEvent.click(screen.getByTitle("Anomalies"));
    expect(screen.getByText("Anomaly Feed")).toBeTruthy();
  });

  it("renders status bar", () => {
    render(<App />);
    expect(screen.getByText("IDLE")).toBeTruthy();
    expect(screen.getByText("PAPER")).toBeTruthy();
  });
});
