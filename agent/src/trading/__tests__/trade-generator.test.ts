import { describe, it, expect, vi } from "vitest";
import type { Anomaly, DataTick } from "@finwatch/shared";
import { TradeGenerator } from "../trade-generator.js";
import type { PositionLookup, ComputeIndicatorsFn } from "../trade-generator.js";
import type { IndicatorSnapshot } from "../regime-detector.js";

function makeAnomaly(overrides: Partial<Anomaly> = {}): Anomaly {
  return {
    id: "anomaly-001",
    severity: "high",
    source: "alpaca-stream",
    symbol: "AAPL",
    timestamp: Date.now(),
    description: "Price spike detected",
    metrics: { close: 200, volume: 5000000 },
    preScreenScore: 0.85,
    sessionId: "session-001",
    ...overrides,
  };
}

function makeTick(overrides: Partial<DataTick> = {}): DataTick {
  return {
    sourceId: "test-source",
    timestamp: Date.now(),
    symbol: "AAPL",
    metrics: { close: 200, volume: 5000000, high: 205, low: 195, open: 198 },
    metadata: {},
    ...overrides,
  };
}

function makeBullishIndicators(): IndicatorSnapshot {
  return {
    rsi: 65,
    macdHistogram: 0.5,
    macdLine: 1.2,
    macdSignal: 0.7,
    bollingerPercentB: 0.15,
    bollingerWidth: 0.04,
    atr: 3.5,
    atrAvg20: 3.0,
  };
}

function makeBearishIndicators(): IndicatorSnapshot {
  return {
    rsi: 35,
    macdHistogram: -0.5,
    macdLine: -1.2,
    macdSignal: -0.7,
    bollingerPercentB: 0.85,
    bollingerWidth: 0.04,
    atr: 3.5,
    atrAvg20: 3.0,
  };
}

function makeWeakIndicators(): IndicatorSnapshot {
  return {
    rsi: 50,
    macdHistogram: 0.01,
    macdLine: 0.01,
    macdSignal: 0.01,
    bollingerPercentB: 0.5,
    bollingerWidth: 0.02,
    atr: 3.5,
    atrAvg20: 3.0,
  };
}

const emptyPositions: PositionLookup = {
  hasPosition: () => false,
  getQty: () => 0,
};

const holdingPositions: PositionLookup = {
  hasPosition: (symbol: string) => symbol === "AAPL",
  getQty: (symbol: string) => (symbol === "AAPL" ? 100 : 0),
};

// ---------------------------------------------------------------------------
// V1 tests (existing behavior, now async)
// ---------------------------------------------------------------------------

describe("TradeGenerator", () => {
  describe("v1 mode", () => {
    it("generates a buy action for high-severity price spike with no position", async () => {
      const gen = new TradeGenerator(emptyPositions);
      const anomaly = makeAnomaly({
        severity: "high",
        description: "Price spike detected: AAPL jumped 8% in 5 minutes",
        metrics: { close: 200, priceChange: 8 },
      });
      const action = await gen.evaluate(anomaly);

      expect(action).not.toBeNull();
      expect(action!.symbol).toBe("AAPL");
      expect(action!.side).toBe("buy");
      expect(action!.type).toBe("market");
      expect(action!.anomalyId).toBe("anomaly-001");
      expect(action!.confidence).toBeGreaterThan(0);
      expect(action!.confidence).toBeLessThanOrEqual(1);
      expect(action!.rationale).toBeTruthy();
    });

    it("generates a buy action for critical severity", async () => {
      const gen = new TradeGenerator(emptyPositions);
      const anomaly = makeAnomaly({ severity: "critical" });
      const action = await gen.evaluate(anomaly);
      expect(action).not.toBeNull();
      expect(action!.side).toBe("buy");
    });

    it("returns null for low-severity anomalies", async () => {
      const gen = new TradeGenerator(emptyPositions);
      const anomaly = makeAnomaly({ severity: "low" });
      const action = await gen.evaluate(anomaly);
      expect(action).toBeNull();
    });

    it("returns null for medium-severity anomalies", async () => {
      const gen = new TradeGenerator(emptyPositions);
      const anomaly = makeAnomaly({ severity: "medium" });
      const action = await gen.evaluate(anomaly);
      expect(action).toBeNull();
    });

    it("returns null when anomaly has no symbol", async () => {
      const gen = new TradeGenerator(emptyPositions);
      const anomaly = makeAnomaly({ symbol: undefined });
      const action = await gen.evaluate(anomaly);
      expect(action).toBeNull();
    });

    it("generates buy action for volume drop anomaly", async () => {
      const gen = new TradeGenerator(emptyPositions);
      const anomaly = makeAnomaly({
        severity: "high",
        description: "Volume drop detected: AAPL volume fell 60%",
        metrics: { volume: 200000, volumeChange: -60 },
      });
      const action = await gen.evaluate(anomaly);
      expect(action).not.toBeNull();
      expect(action!.side).toBe("buy");
    });

    it("will not generate buy when already holding position", async () => {
      const gen = new TradeGenerator(holdingPositions);
      const anomaly = makeAnomaly({
        severity: "high",
        description: "Volume drop detected",
        metrics: { volume: 200000, volumeChange: -60 },
      });
      const action = await gen.evaluate(anomaly);
      expect(action).toBeNull();
    });

    it("generates sell when holding position and price spike occurs", async () => {
      const gen = new TradeGenerator(holdingPositions);
      const anomaly = makeAnomaly({
        severity: "high",
        description: "Price spike detected",
        metrics: { close: 200, priceChange: 8 },
      });
      const action = await gen.evaluate(anomaly);
      expect(action).not.toBeNull();
      expect(action!.side).toBe("sell");
      expect(action!.qty).toBe(100);
    });

    it("uses default qty when no position to sell", async () => {
      const gen = new TradeGenerator(emptyPositions);
      const anomaly = makeAnomaly({
        severity: "high",
        description: "Price spike detected",
      });
      const action = await gen.evaluate(anomaly);
      expect(action).not.toBeNull();
      expect(action!.qty).toBe(1);
    });

    it("maps preScreenScore to confidence", async () => {
      const gen = new TradeGenerator(emptyPositions);
      const anomaly = makeAnomaly({ preScreenScore: 0.95 });
      const action = await gen.evaluate(anomaly);
      expect(action).not.toBeNull();
      expect(action!.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it("emits onAction callback when trade generated", async () => {
      const gen = new TradeGenerator(emptyPositions);
      const callback = vi.fn();
      gen.onAction = callback;

      const anomaly = makeAnomaly({ severity: "high" });
      await gen.evaluate(anomaly);

      expect(callback).toHaveBeenCalledOnce();
      expect(callback.mock.calls[0]![0]).toHaveProperty("symbol", "AAPL");
    });

    it("does not emit onAction when no trade generated", async () => {
      const gen = new TradeGenerator(emptyPositions);
      const callback = vi.fn();
      gen.onAction = callback;

      await gen.evaluate(makeAnomaly({ severity: "low" }));
      expect(callback).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // V2 tests (scoring pipeline)
  // ---------------------------------------------------------------------------

  describe("v2 mode", () => {
    const ticks = [makeTick(), makeTick({ timestamp: Date.now() + 1000 })];

    function makeV2Generator(
      positions: PositionLookup,
      indicatorOverride?: IndicatorSnapshot,
    ): { gen: TradeGenerator; computeIndicators: ComputeIndicatorsFn } {
      const indicators = indicatorOverride ?? makeBullishIndicators();
      const computeIndicators = vi.fn<ComputeIndicatorsFn>().mockResolvedValue(indicators);
      const gen = new TradeGenerator({
        positions,
        computeIndicators,
        accountEquity: 100000,
      });
      return { gen, computeIndicators };
    }

    it("uses v2 pipeline when computeIndicators and ticks are provided", async () => {
      const { gen, computeIndicators } = makeV2Generator(emptyPositions);
      // price_drop anomaly + bullish indicators in trending_up regime → "long" → "buy"
      const anomaly = makeAnomaly({
        severity: "high",
        description: "Price drop detected",
        metrics: { close: 200, priceChange: -0.05 },
      });
      const action = await gen.evaluate(anomaly, ticks);

      expect(computeIndicators).toHaveBeenCalledWith("AAPL", ticks);
      expect(action).not.toBeNull();
      expect(action!.side).toBe("buy");
    });

    it("returns null when confluence score < 40", async () => {
      // weak indicators + low preScreenScore + negative volume → score below 40
      const { gen } = makeV2Generator(emptyPositions, makeWeakIndicators());
      const anomaly = makeAnomaly({
        severity: "high",
        description: "Price drop detected",
        metrics: { close: 200, priceChange: -0.05, volumeChange: -0.5 },
        preScreenScore: 0.0,
      });
      const action = await gen.evaluate(anomaly, ticks);

      expect(action).toBeNull();
    });

    it("generates trade with correct direction when score >= 40", async () => {
      const { gen } = makeV2Generator(emptyPositions, makeBullishIndicators());
      // price_drop in trending_up → "long" → "buy"
      const anomaly = makeAnomaly({
        severity: "critical",
        description: "Price drop detected",
        metrics: { close: 200, priceChange: -0.05 },
        preScreenScore: 0.9,
      });
      const action = await gen.evaluate(anomaly, ticks);

      expect(action).not.toBeNull();
      expect(action!.side).toBe("buy");
      expect(action!.symbol).toBe("AAPL");
    });

    it("uses ATR-based sizing (qty != 1)", async () => {
      const indicators = makeBullishIndicators();
      // ATR = 3.5, price = 200, equity = 100000
      // dollarRisk = 3.5 * 2.0 = 7.0
      // accountRisk = 100000 * 0.005 = 500
      // baseQty = 500 / 7.0 = 71.4
      // With confluence multiplier and regime multiplier, qty should be > 1
      const { gen } = makeV2Generator(emptyPositions, indicators);
      const anomaly = makeAnomaly({
        severity: "critical",
        description: "Price drop detected",
        metrics: { close: 200, priceChange: -0.05 },
        preScreenScore: 0.9,
      });
      const action = await gen.evaluate(anomaly, ticks);

      expect(action).not.toBeNull();
      expect(action!.qty).toBeGreaterThan(1);
    });

    it("includes confluence score in rationale", async () => {
      const { gen } = makeV2Generator(emptyPositions, makeBullishIndicators());
      const anomaly = makeAnomaly({
        severity: "critical",
        description: "Price drop detected",
        metrics: { close: 200, priceChange: -0.05 },
        preScreenScore: 0.9,
      });
      const action = await gen.evaluate(anomaly, ticks);

      expect(action).not.toBeNull();
      expect(action!.rationale).toMatch(/Confluence score \d+\/100/);
      expect(action!.rationale).toMatch(/anomaly: \d+/);
      expect(action!.rationale).toMatch(/trend: \d+/);
      expect(action!.rationale).toMatch(/momentum: \d+/);
      expect(action!.rationale).toMatch(/volume: \d+/);
      expect(action!.rationale).toMatch(/ATR-sized at \d+ shares/);
    });

    it("does not double on existing position in same direction", async () => {
      // Holding long AAPL (100 shares), signal is "long" → should return null
      const { gen } = makeV2Generator(holdingPositions, makeBullishIndicators());
      const anomaly = makeAnomaly({
        severity: "critical",
        description: "Price drop detected",
        metrics: { close: 200, priceChange: -0.05 },
        preScreenScore: 0.9,
      });
      // trending_up + price_drop → direction "long", holding long → no double
      const action = await gen.evaluate(anomaly, ticks);

      expect(action).toBeNull();
    });

    it("closes position on opposite direction signal", async () => {
      // Holding long AAPL, signal is "short" → should close by selling
      const { gen } = makeV2Generator(holdingPositions, makeBearishIndicators());
      // price_spike + bearish in trending_down → "short" direction
      const anomaly = makeAnomaly({
        severity: "critical",
        description: "Price spike detected",
        metrics: { close: 200, priceChange: 0.08 },
        preScreenScore: 0.9,
      });
      const action = await gen.evaluate(anomaly, ticks);

      expect(action).not.toBeNull();
      expect(action!.side).toBe("sell");
      expect(action!.qty).toBe(100);
      expect(action!.rationale).toMatch(/CLOSE AAPL/);
    });

    it("falls back to v1 when no ticks provided", async () => {
      const { gen } = makeV2Generator(emptyPositions);
      const anomaly = makeAnomaly({
        severity: "high",
        description: "Price spike detected",
      });
      // No ticks → v1 fallback
      const action = await gen.evaluate(anomaly);

      expect(action).not.toBeNull();
      // v1 behavior: price_spike + no position → buy
      expect(action!.side).toBe("buy");
      expect(action!.qty).toBe(1); // DEFAULT_QTY from v1
    });

    it("falls back to v1 when no computeIndicators configured", async () => {
      // Using plain PositionLookup constructor (v1 mode)
      const gen = new TradeGenerator(emptyPositions);
      const anomaly = makeAnomaly({
        severity: "high",
        description: "Price spike detected",
      });
      const action = await gen.evaluate(anomaly, ticks);

      expect(action).not.toBeNull();
      // v1 behavior: price_spike + no position → buy
      expect(action!.side).toBe("buy");
      expect(action!.qty).toBe(1);
    });

    it("emits onAction callback in v2 mode", async () => {
      const { gen } = makeV2Generator(emptyPositions, makeBullishIndicators());
      const callback = vi.fn();
      gen.onAction = callback;

      const anomaly = makeAnomaly({
        severity: "critical",
        description: "Price drop detected",
        metrics: { close: 200, priceChange: -0.05 },
        preScreenScore: 0.9,
      });
      await gen.evaluate(anomaly, ticks);

      expect(callback).toHaveBeenCalledOnce();
      expect(callback.mock.calls[0]![0]).toHaveProperty("symbol", "AAPL");
    });

    it("sets confidence from confluence score (0-1 range)", async () => {
      const { gen } = makeV2Generator(emptyPositions, makeBullishIndicators());
      const anomaly = makeAnomaly({
        severity: "critical",
        description: "Price drop detected",
        metrics: { close: 200, priceChange: -0.05 },
        preScreenScore: 0.9,
      });
      const action = await gen.evaluate(anomaly, ticks);

      expect(action).not.toBeNull();
      expect(action!.confidence).toBeGreaterThan(0);
      expect(action!.confidence).toBeLessThanOrEqual(1);
    });
  });
});
