import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { KillSwitch } from "../KillSwitch.js";

describe("KillSwitch", () => {
  it("renders kill switch button", () => {
    render(<KillSwitch active={false} onToggle={vi.fn()} />);
    expect(screen.getByText("KILL SWITCH")).toBeTruthy();
  });

  it("shows inactive state styling", () => {
    render(<KillSwitch active={false} onToggle={vi.fn()} />);
    const btn = screen.getByText("KILL SWITCH");
    expect(btn.className).toContain("border-border");
  });

  it("shows active state with critical styling", () => {
    render(<KillSwitch active={true} onToggle={vi.fn()} />);
    const btn = screen.getByText("KILL SWITCH");
    expect(btn.className).toContain("border-severity-critical");
  });

  it("calls onToggle when clicked", () => {
    const handler = vi.fn();
    render(<KillSwitch active={false} onToggle={handler} />);
    fireEvent.click(screen.getByText("KILL SWITCH"));
    expect(handler).toHaveBeenCalled();
  });
});
