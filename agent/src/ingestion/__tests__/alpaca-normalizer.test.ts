import { describe, it, expect } from "vitest";
import type { DataTick } from "@finwatch/shared";
import {
  normalizeAlpacaBar,
  normalizeAlpacaTrade,
  normalizeAlpacaQuote,
} from "../alpaca-normalizer.js";

const SOURCE_ID = "alpaca-stream";

describe("normalizeAlpacaBar", () => {
  it("maps bar message to DataTick with OHLCV metrics", () => {
    const bar = {
      T: "b",
      S: "AAPL",
      o: 183.92,
      h: 185.09,
      l: 182.41,
      c: 184.40,
      v: 49120300,
      t: "2024-02-01T14:30:00Z",
    };
    const tick = normalizeAlpacaBar(SOURCE_ID, bar);

    expect(tick.sourceId).toBe(SOURCE_ID);
    expect(tick.symbol).toBe("AAPL");
    expect(tick.metrics).toEqual({
      open: 183.92,
      high: 185.09,
      low: 182.41,
      close: 184.40,
      volume: 49120300,
    });
    expect(tick.timestamp).toBeGreaterThan(0);
    expect(tick.raw).toBe(bar);
  });

  it("parses ISO timestamp correctly", () => {
    const bar = {
      T: "b",
      S: "TSLA",
      o: 200,
      h: 210,
      l: 195,
      c: 205,
      v: 1000000,
      t: "2024-06-15T20:00:00Z",
    };
    const tick = normalizeAlpacaBar(SOURCE_ID, bar);
    expect(tick.timestamp).toBe(new Date("2024-06-15T20:00:00Z").getTime());
  });

  it("uppercases symbol", () => {
    const bar = {
      T: "b",
      S: "aapl",
      o: 100,
      h: 110,
      l: 90,
      c: 105,
      v: 500,
      t: "2024-01-01T00:00:00Z",
    };
    const tick = normalizeAlpacaBar(SOURCE_ID, bar);
    expect(tick.symbol).toBe("AAPL");
  });

  it("includes alpaca message type in metadata", () => {
    const bar = {
      T: "b",
      S: "SPY",
      o: 450,
      h: 455,
      l: 448,
      c: 453,
      v: 80000000,
      t: "2024-01-01T00:00:00Z",
    };
    const tick = normalizeAlpacaBar(SOURCE_ID, bar);
    expect(tick.metadata).toEqual({ alpacaType: "bar" });
  });
});

describe("parseTimestamp validation", () => {
  it("throws on invalid timestamp", () => {
    const bar = {
      T: "b" as const,
      S: "AAPL",
      o: 100,
      h: 110,
      l: 90,
      c: 105,
      v: 500,
      t: "not-a-date",
    };
    expect(() => normalizeAlpacaBar(SOURCE_ID, bar)).toThrow(
      'Invalid timestamp: "not-a-date"',
    );
  });
});

describe("normalizeAlpacaTrade", () => {
  it("maps trade message to DataTick with price and size", () => {
    const trade = {
      T: "t",
      S: "AAPL",
      p: 184.50,
      s: 100,
      t: "2024-02-01T14:30:01Z",
    };
    const tick = normalizeAlpacaTrade(SOURCE_ID, trade);

    expect(tick.sourceId).toBe(SOURCE_ID);
    expect(tick.symbol).toBe("AAPL");
    expect(tick.metrics).toEqual({
      price: 184.50,
      size: 100,
    });
    expect(tick.timestamp).toBeGreaterThan(0);
    expect(tick.raw).toBe(trade);
  });

  it("includes alpaca message type in metadata", () => {
    const trade = {
      T: "t",
      S: "MSFT",
      p: 400,
      s: 50,
      t: "2024-01-01T00:00:00Z",
    };
    const tick = normalizeAlpacaTrade(SOURCE_ID, trade);
    expect(tick.metadata).toEqual({ alpacaType: "trade" });
  });
});

describe("normalizeAlpacaQuote", () => {
  it("maps quote message to DataTick with bid/ask and computed spread", () => {
    const quote = {
      T: "q",
      S: "AAPL",
      bp: 184.40,
      ap: 184.45,
      bs: 200,
      as: 150,
      t: "2024-02-01T14:30:02Z",
    };
    const tick = normalizeAlpacaQuote(SOURCE_ID, quote);

    expect(tick.sourceId).toBe(SOURCE_ID);
    expect(tick.symbol).toBe("AAPL");
    expect(tick.metrics.bidPrice).toBe(184.40);
    expect(tick.metrics.askPrice).toBe(184.45);
    expect(tick.metrics.bidSize).toBe(200);
    expect(tick.metrics.askSize).toBe(150);
    expect(tick.metrics.spread).toBeCloseTo(0.05, 10);
    expect(tick.raw).toBe(quote);
  });

  it("computes spread as askPrice - bidPrice", () => {
    const quote = {
      T: "q",
      S: "SPY",
      bp: 450.00,
      ap: 450.10,
      bs: 1000,
      as: 800,
      t: "2024-01-01T00:00:00Z",
    };
    const tick = normalizeAlpacaQuote(SOURCE_ID, quote);
    expect(tick.metrics.spread).toBeCloseTo(0.10, 10);
  });

  it("includes alpaca message type in metadata", () => {
    const quote = {
      T: "q",
      S: "GOOG",
      bp: 140,
      ap: 140.05,
      bs: 500,
      as: 400,
      t: "2024-01-01T00:00:00Z",
    };
    const tick = normalizeAlpacaQuote(SOURCE_ID, quote);
    expect(tick.metadata).toEqual({ alpacaType: "quote" });
  });
});
