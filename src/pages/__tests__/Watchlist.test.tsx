import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Watchlist } from "../Watchlist.js";
import type { Asset } from "../../store/watchlist-slice.js";

describe("Watchlist", () => {
  const assets: Asset[] = [
    { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", asset_class: "us_equity", status: "active" },
    { symbol: "TSLA", name: "Tesla Inc.", exchange: "NASDAQ", asset_class: "us_equity", status: "active" },
    { symbol: "BTC/USD", name: "Bitcoin", exchange: "CRYPTO", asset_class: "crypto", status: "active" },
  ];

  const defaultProps = {
    assets,
    watchlist: ["AAPL"],
    pendingChanges: false,
    searchQuery: "",
    categoryFilter: "all",
    loading: false,
    error: null as string | null,
    onAddSymbol: vi.fn(),
    onRemoveSymbol: vi.fn(),
    onSearchChange: vi.fn(),
    onCategoryChange: vi.fn(),
    onApplyChanges: vi.fn(),
    onFetchAssets: vi.fn(),
  };

  it("renders heading", () => {
    render(<Watchlist {...defaultProps} />);
    expect(screen.getByText("Watchlist")).toBeDefined();
  });

  it("renders search input", () => {
    render(<Watchlist {...defaultProps} />);
    expect(screen.getByPlaceholderText(/search/i)).toBeDefined();
  });

  it("renders asset rows", () => {
    render(<Watchlist {...defaultProps} />);
    expect(screen.getByText("AAPL")).toBeDefined();
    expect(screen.getByText("TSLA")).toBeDefined();
    expect(screen.getByText("BTC/USD")).toBeDefined();
  });

  it("shows watchlisted items as checked", () => {
    render(<Watchlist {...defaultProps} watchlist={["AAPL"]} />);
    const checkboxes = screen.getAllByRole("checkbox");
    const aaplCheckbox = checkboxes.find((cb) => {
      const row = cb.closest("tr");
      return row?.textContent?.includes("AAPL");
    });
    expect(aaplCheckbox).toBeDefined();
    expect((aaplCheckbox as HTMLInputElement).checked).toBe(true);
  });

  it("calls onAddSymbol when unchecked symbol is clicked", () => {
    const handler = vi.fn();
    render(<Watchlist {...defaultProps} watchlist={[]} onAddSymbol={handler} />);
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]); // AAPL
    expect(handler).toHaveBeenCalledWith("AAPL");
  });

  it("calls onRemoveSymbol when checked symbol is clicked", () => {
    const handler = vi.fn();
    render(<Watchlist {...defaultProps} watchlist={["AAPL"]} onRemoveSymbol={handler} />);
    const checkboxes = screen.getAllByRole("checkbox");
    const aaplCheckbox = checkboxes.find((cb) => {
      const row = cb.closest("tr");
      return row?.textContent?.includes("AAPL");
    });
    fireEvent.click(aaplCheckbox!);
    expect(handler).toHaveBeenCalledWith("AAPL");
  });

  it("shows Apply Changes button when pendingChanges is true", () => {
    render(<Watchlist {...defaultProps} pendingChanges={true} />);
    expect(screen.getByText(/apply changes/i)).toBeDefined();
  });

  it("hides Apply Changes button when pendingChanges is false", () => {
    render(<Watchlist {...defaultProps} pendingChanges={false} />);
    expect(screen.queryByText(/apply changes/i)).toBeNull();
  });

  it("filters assets by search query", () => {
    render(<Watchlist {...defaultProps} searchQuery="apple" />);
    expect(screen.getByText("AAPL")).toBeDefined();
    expect(screen.queryByText("TSLA")).toBeNull();
  });

  it("filters assets by category", () => {
    render(<Watchlist {...defaultProps} categoryFilter="crypto" />);
    expect(screen.getByText("BTC/USD")).toBeDefined();
    expect(screen.queryByText("AAPL")).toBeNull();
  });

  it("shows loading state", () => {
    render(<Watchlist {...defaultProps} assets={[]} loading={true} />);
    expect(screen.getByText(/loading/i)).toBeDefined();
  });

  it("shows error state with retry", () => {
    const handler = vi.fn();
    render(<Watchlist {...defaultProps} assets={[]} error="API failed" onFetchAssets={handler} />);
    expect(screen.getByText(/api failed/i)).toBeDefined();
    fireEvent.click(screen.getByText(/retry/i));
    expect(handler).toHaveBeenCalled();
  });

  it("shows soft limit warning when over 20 symbols", () => {
    const manySymbols = Array.from({ length: 21 }, (_, i) => `SYM${i}`);
    render(<Watchlist {...defaultProps} watchlist={manySymbols} />);
    expect(screen.getByText(/monitoring many symbols/i)).toBeDefined();
  });

  it("sorts watchlisted items to top", () => {
    render(<Watchlist {...defaultProps} watchlist={["TSLA"]} />);
    const rows = screen.getAllByRole("row");
    // First data row (index 1, after header) should be the watched one
    expect(rows[1].textContent).toContain("TSLA");
  });
});
