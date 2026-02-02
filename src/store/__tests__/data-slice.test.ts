import { describe, it, expect, beforeEach } from "vitest";
import { createDataSlice, DataSlice } from "../data-slice.js";
import type { DataTick } from "@finwatch/shared";

describe("dataSlice", () => {
  let slice: DataSlice;

  beforeEach(() => {
    slice = createDataSlice();
  });

  const tick: DataTick = {
    sourceId: "yahoo",
    timestamp: 1000,
    symbol: "AAPL",
    metrics: { price: 150, volume: 1e6 },
    metadata: {},
  };

  it("starts with empty ticks", () => {
    expect(slice.getState().ticks).toHaveLength(0);
  });

  it("adds a tick", () => {
    slice.getState().addTick(tick);
    expect(slice.getState().ticks).toHaveLength(1);
    expect(slice.getState().ticks[0].symbol).toBe("AAPL");
  });

  it("limits ticks to maxSize", () => {
    for (let i = 0; i < 200; i++)
      slice.getState().addTick({ ...tick, timestamp: i });
    expect(slice.getState().ticks.length).toBeLessThanOrEqual(100);
  });

  it("gets latest tick per symbol", () => {
    slice.getState().addTick({ ...tick, timestamp: 1, symbol: "AAPL" });
    slice.getState().addTick({ ...tick, timestamp: 2, symbol: "GOOGL" });
    slice.getState().addTick({ ...tick, timestamp: 3, symbol: "AAPL" });
    const latest = slice.getState().latestBySymbol();
    expect(latest.get("AAPL")?.timestamp).toBe(3);
    expect(latest.get("GOOGL")?.timestamp).toBe(2);
  });

  it("clears all ticks", () => {
    slice.getState().addTick(tick);
    slice.getState().clearTicks();
    expect(slice.getState().ticks).toHaveLength(0);
  });
});
