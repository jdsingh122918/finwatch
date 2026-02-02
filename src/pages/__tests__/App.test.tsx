import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "../../App.js";

describe("App shell", () => {
  it("renders navigation tabs", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "Dashboard" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Anomalies" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Agent" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sources" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
  });

  it("switches pages on tab click", () => {
    render(<App />);
    fireEvent.click(screen.getByText("Anomalies"));
    expect(screen.getByText("Anomaly Feed")).toBeTruthy();
  });
});
