import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SymbolChips } from "../SymbolChips.js";

describe("SymbolChips", () => {
  it("renders each symbol as a chip", () => {
    render(<SymbolChips symbols={["AAPL", "TSLA"]} onRemove={() => {}} />);
    expect(screen.getByText("AAPL")).toBeDefined();
    expect(screen.getByText("TSLA")).toBeDefined();
  });

  it("calls onRemove when × is clicked", () => {
    const handler = vi.fn();
    render(<SymbolChips symbols={["AAPL", "TSLA"]} onRemove={handler} />);
    const removeButtons = screen.getAllByRole("button");
    fireEvent.click(removeButtons[0]);
    expect(handler).toHaveBeenCalledWith("AAPL");
  });

  it("renders empty state when no symbols", () => {
    render(<SymbolChips symbols={[]} onRemove={() => {}} />);
    expect(screen.getByText(/no symbols/i)).toBeDefined();
  });

  it("shows count when provided", () => {
    render(
      <SymbolChips symbols={["AAPL", "TSLA"]} onRemove={() => {}} softLimit={20} />
    );
    expect(screen.getByText("2/20")).toBeDefined();
  });
});
