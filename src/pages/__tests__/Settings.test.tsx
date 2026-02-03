import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Settings } from "../Settings.js";

describe("Settings", () => {
  it("renders heading", () => {
    render(<Settings config="{}" onSave={vi.fn()} />);
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("renders config textarea", () => {
    render(<Settings config='{"key":"val"}' onSave={vi.fn()} />);
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("calls onSave with current value", () => {
    const handler = vi.fn();
    render(<Settings config="{}" onSave={handler} />);
    fireEvent.click(screen.getByText("SAVE"));
    expect(handler).toHaveBeenCalledWith("{}");
  });
});
