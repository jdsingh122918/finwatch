import { describe, it, expect } from "vitest";
import type { DataTick } from "@finwatch/shared";
import { normalizeTick, normalizeBatch, NormalizationError } from "../normalizer.js";

function makeTick(overrides: Partial<DataTick> = {}): DataTick {
  return {
    sourceId: "test-source",
    timestamp: 1706745600,
    symbol: "AAPL",
    metrics: { close: 184.4 },
    metadata: {},
    ...overrides,
  };
}

describe("normalizeTick", () => {
  it("passes through a valid tick unchanged", () => {
    const tick = makeTick({
      metrics: { open: 183.92, high: 185.09, low: 182.41, close: 184.4, volume: 49120300 },
    });
    const result = normalizeTick(tick);
    expect(result.sourceId).toBe("test-source");
    expect(result.timestamp).toBe(1706745600);
    expect(result.metrics.close).toBe(184.4);
  });

  it("maps aliased metric names to canonical names", () => {
    const tick = makeTick({
      metrics: { price: 184.4, vol: 49120300 },
    });
    const result = normalizeTick(tick);
    expect(result.metrics.close).toBe(184.4);
    expect(result.metrics.volume).toBe(49120300);
    expect(result.metrics).not.toHaveProperty("price");
    expect(result.metrics).not.toHaveProperty("vol");
  });

  it("normalizes 'last' to 'close'", () => {
    const tick = makeTick({ metrics: { last: 184.4 } });
    const result = normalizeTick(tick);
    expect(result.metrics.close).toBe(184.4);
  });

  it("normalizes 'adj_close' and 'adjclose' to 'adjustedClose'", () => {
    const tick1 = makeTick({ metrics: { adj_close: 184.4 } });
    expect(normalizeTick(tick1).metrics.adjustedClose).toBe(184.4);

    const tick2 = makeTick({ metrics: { adjclose: 185.0 } });
    expect(normalizeTick(tick2).metrics.adjustedClose).toBe(185.0);
  });

  it("preserves non-aliased metric names as-is", () => {
    const tick = makeTick({
      metrics: { close: 184.4, rsi: 65.3, macd: 1.2 },
    });
    const result = normalizeTick(tick);
    expect(result.metrics.rsi).toBe(65.3);
    expect(result.metrics.macd).toBe(1.2);
  });

  it("throws NormalizationError for missing sourceId", () => {
    const tick = makeTick({ sourceId: "" });
    expect(() => normalizeTick(tick)).toThrow(NormalizationError);
    expect(() => normalizeTick(tick)).toThrow("sourceId is required");
  });

  it("throws NormalizationError for missing timestamp", () => {
    const tick = makeTick({ timestamp: 0 });
    expect(() => normalizeTick(tick)).toThrow(NormalizationError);
    expect(() => normalizeTick(tick)).toThrow("timestamp must be positive");
  });

  it("throws NormalizationError for negative timestamp", () => {
    const tick = makeTick({ timestamp: -1 });
    expect(() => normalizeTick(tick)).toThrow(NormalizationError);
  });

  it("throws NormalizationError for empty metrics", () => {
    const tick = makeTick({ metrics: {} });
    expect(() => normalizeTick(tick)).toThrow(NormalizationError);
    expect(() => normalizeTick(tick)).toThrow("at least one metric");
  });

  it("throws NormalizationError for non-finite metric value", () => {
    const tick = makeTick({ metrics: { close: NaN } });
    expect(() => normalizeTick(tick)).toThrow(NormalizationError);
  });

  it("throws NormalizationError for Infinity metric value", () => {
    const tick = makeTick({ metrics: { close: Infinity } });
    expect(() => normalizeTick(tick)).toThrow(NormalizationError);
  });

  it("trims whitespace from symbol", () => {
    const tick = makeTick({ symbol: "  AAPL  " });
    const result = normalizeTick(tick);
    expect(result.symbol).toBe("AAPL");
  });

  it("uppercases symbol", () => {
    const tick = makeTick({ symbol: "aapl" });
    const result = normalizeTick(tick);
    expect(result.symbol).toBe("AAPL");
  });

  it("preserves undefined symbol as undefined", () => {
    const tick = makeTick({ symbol: undefined });
    const result = normalizeTick(tick);
    expect(result.symbol).toBeUndefined();
  });

  it("always includes metadata object even if source omits it", () => {
    const tick: DataTick = {
      sourceId: "src",
      timestamp: 1706745600,
      metrics: { close: 100 },
      metadata: {},
    };
    const result = normalizeTick(tick);
    expect(result.metadata).toBeDefined();
    expect(typeof result.metadata).toBe("object");
  });
});

describe("normalizeBatch", () => {
  it("normalizes all ticks in a batch", () => {
    const ticks = [
      makeTick({ metrics: { price: 184.4 } }),
      makeTick({ metrics: { close: 185.0 } }),
    ];
    const result = normalizeBatch(ticks);
    expect(result).toHaveLength(2);
    expect(result[0]!.metrics.close).toBe(184.4);
    expect(result[1]!.metrics.close).toBe(185.0);
  });

  it("filters out invalid ticks and returns only valid ones", () => {
    const ticks = [
      makeTick({ metrics: { close: 184.4 } }),
      makeTick({ sourceId: "", metrics: { close: 185.0 } }), // invalid
      makeTick({ metrics: { close: 186.0 } }),
    ];
    const result = normalizeBatch(ticks, { skipInvalid: true });
    expect(result).toHaveLength(2);
  });

  it("throws on first invalid tick when skipInvalid is false", () => {
    const ticks = [
      makeTick({ metrics: { close: 184.4 } }),
      makeTick({ sourceId: "" }), // invalid
    ];
    expect(() => normalizeBatch(ticks)).toThrow(NormalizationError);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeBatch([])).toEqual([]);
  });
});
