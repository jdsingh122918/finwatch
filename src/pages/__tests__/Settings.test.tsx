import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Settings } from "../Settings.js";

describe("Settings", () => {
  const defaultProps = {
    onCredentialsSave: vi.fn(),
    onConfigSave: vi.fn(),
    onAgentStart: vi.fn(),
    onAgentStop: vi.fn(),
    agentRunning: false,
    watchlist: [] as string[],
    pendingChanges: false,
    onRemoveSymbol: vi.fn(),
    onNavigateWatchlist: vi.fn(),
    onApplyChanges: vi.fn(),
  };

  it("renders heading", () => {
    render(<Settings {...defaultProps} />);
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("renders Alpaca credential fields", () => {
    render(<Settings {...defaultProps} />);
    expect(screen.getByLabelText("API Key")).toBeDefined();
    expect(screen.getByLabelText("API Secret")).toBeDefined();
  });

  it("renders LLM provider fields", () => {
    render(<Settings {...defaultProps} />);
    expect(screen.getByLabelText(/anthropic api key/i)).toBeDefined();
    expect(screen.getByLabelText(/openrouter api key/i)).toBeDefined();
  });

  it("renders symbol chips", () => {
    render(<Settings {...defaultProps} watchlist={["AAPL", "TSLA"]} />);
    expect(screen.getByText("AAPL")).toBeDefined();
    expect(screen.getByText("TSLA")).toBeDefined();
  });

  it("renders Manage Watchlist link", () => {
    render(<Settings {...defaultProps} watchlist={[]} />);
    expect(screen.getByText(/manage watchlist/i)).toBeDefined();
  });

  it("calls onRemoveSymbol when chip x clicked", () => {
    const handler = vi.fn();
    render(<Settings {...defaultProps} watchlist={["AAPL"]} onRemoveSymbol={handler} />);
    fireEvent.click(screen.getByLabelText("Remove AAPL"));
    expect(handler).toHaveBeenCalledWith("AAPL");
  });

  it("shows Apply Changes when pendingChanges is true", () => {
    render(<Settings {...defaultProps} pendingChanges={true} />);
    expect(screen.getByText(/apply changes/i)).toBeDefined();
  });

  it("calls onCredentialsSave when Save Credentials clicked", () => {
    const handler = vi.fn();
    render(<Settings {...defaultProps} onCredentialsSave={handler} />);
    const keyInput = screen.getByLabelText("API Key");
    const secretInput = screen.getByLabelText("API Secret");
    fireEvent.change(keyInput, { target: { value: "PKTEST" } });
    fireEvent.change(secretInput, { target: { value: "SECRET" } });
    fireEvent.click(screen.getByText(/save credentials/i));
    expect(handler).toHaveBeenCalledWith("PKTEST", "SECRET");
  });

  it("renders agent start button when not running", () => {
    render(<Settings {...defaultProps} agentRunning={false} />);
    expect(screen.getByText(/start agent/i)).toBeDefined();
  });

  it("renders agent stop button when running", () => {
    render(<Settings {...defaultProps} agentRunning={true} />);
    expect(screen.getByText(/stop agent/i)).toBeDefined();
  });
});
