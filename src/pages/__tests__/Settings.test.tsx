import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Settings } from "../Settings.js";

describe("Settings", () => {
  it("renders config JSON", () => {
    render(
      <Settings
        config='{"monitor":{"analysisIntervalMs":60000}}'
        onSave={vi.fn()}
      />,
    );
    expect(screen.getByText(/analysisIntervalMs/)).toBeTruthy();
  });

  it("calls onSave", () => {
    const onSave = vi.fn();
    render(<Settings config="{}" onSave={onSave} />);
    fireEvent.click(screen.getByText(/save/i));
    expect(onSave).toHaveBeenCalled();
  });
});
