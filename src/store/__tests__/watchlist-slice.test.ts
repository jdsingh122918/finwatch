import { describe, it, expect, beforeEach, vi } from "vitest";
import { createWatchlistSlice, type WatchlistSlice } from "../watchlist-slice.js";

// Mock Tauri invoke
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("watchlistSlice", () => {
  let slice: WatchlistSlice;

  beforeEach(() => {
    slice = createWatchlistSlice();
  });

  it("starts with empty assets and watchlist", () => {
    const state = slice.getState();
    expect(state.assets).toHaveLength(0);
    expect(state.watchlist).toHaveLength(0);
    expect(state.pendingChanges).toBe(false);
  });

  it("adds a symbol to watchlist", () => {
    slice.getState().addSymbol("AAPL");
    expect(slice.getState().watchlist).toContain("AAPL");
    expect(slice.getState().pendingChanges).toBe(true);
  });

  it("removes a symbol from watchlist", () => {
    slice.getState().addSymbol("AAPL");
    slice.getState().addSymbol("TSLA");
    slice.getState().removeSymbol("AAPL");
    expect(slice.getState().watchlist).not.toContain("AAPL");
    expect(slice.getState().watchlist).toContain("TSLA");
  });

  it("does not add duplicate symbols", () => {
    slice.getState().addSymbol("AAPL");
    slice.getState().addSymbol("AAPL");
    expect(slice.getState().watchlist).toHaveLength(1);
  });

  it("sets search query", () => {
    slice.getState().setSearchQuery("app");
    expect(slice.getState().searchQuery).toBe("app");
  });

  it("sets category filter", () => {
    slice.getState().setCategoryFilter("crypto");
    expect(slice.getState().categoryFilter).toBe("crypto");
  });

  it("sets assets", () => {
    const assets = [
      { symbol: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", asset_class: "us_equity", status: "active" },
    ];
    slice.getState().setAssets(assets);
    expect(slice.getState().assets).toHaveLength(1);
    expect(slice.getState().assets[0]!.symbol).toBe("AAPL");
  });

  it("syncs watchlist from config", () => {
    slice.getState().syncFromConfig(["AAPL", "TSLA"]);
    expect(slice.getState().watchlist).toEqual(["AAPL", "TSLA"]);
    expect(slice.getState().pendingChanges).toBe(false);
  });

  it("marks applied after applyChanges resets pending", () => {
    slice.getState().addSymbol("AAPL");
    expect(slice.getState().pendingChanges).toBe(true);
    slice.getState().markApplied();
    expect(slice.getState().pendingChanges).toBe(false);
  });

  it("tracks loading and error state", () => {
    slice.getState().setLoading(true);
    expect(slice.getState().loading).toBe(true);
    slice.getState().setError("API failed");
    expect(slice.getState().error).toBe("API failed");
    expect(slice.getState().loading).toBe(false);
  });
});
