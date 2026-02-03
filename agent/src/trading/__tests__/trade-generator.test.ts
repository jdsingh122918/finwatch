import { describe, it, expect, vi } from "vitest";
import type { Anomaly } from "@finwatch/shared";
import { TradeGenerator } from "../trade-generator.js";
import type { PositionLookup } from "../trade-generator.js";

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

const emptyPositions: PositionLookup = {
  hasPosition: () => false,
  getQty: () => 0,
};

const holdingPositions: PositionLookup = {
  hasPosition: (symbol: string) => symbol === "AAPL",
  getQty: (symbol: string) => (symbol === "AAPL" ? 100 : 0),
};

describe("TradeGenerator", () => {
  it("generates a sell action for high-severity price spike", () => {
    const gen = new TradeGenerator(emptyPositions);
    const anomaly = makeAnomaly({
      severity: "high",
      description: "Price spike detected: AAPL jumped 8% in 5 minutes",
      metrics: { close: 200, priceChange: 8 },
    });
    const action = gen.evaluate(anomaly);

    expect(action).not.toBeNull();
    expect(action!.symbol).toBe("AAPL");
    expect(action!.side).toBe("sell");
    expect(action!.type).toBe("market");
    expect(action!.anomalyId).toBe("anomaly-001");
    expect(action!.confidence).toBeGreaterThan(0);
    expect(action!.confidence).toBeLessThanOrEqual(1);
    expect(action!.rationale).toBeTruthy();
  });

  it("generates a sell action for critical severity", () => {
    const gen = new TradeGenerator(emptyPositions);
    const anomaly = makeAnomaly({ severity: "critical" });
    const action = gen.evaluate(anomaly);
    expect(action).not.toBeNull();
    expect(action!.side).toBe("sell");
  });

  it("returns null for low-severity anomalies", () => {
    const gen = new TradeGenerator(emptyPositions);
    const anomaly = makeAnomaly({ severity: "low" });
    const action = gen.evaluate(anomaly);
    expect(action).toBeNull();
  });

  it("returns null for medium-severity anomalies", () => {
    const gen = new TradeGenerator(emptyPositions);
    const anomaly = makeAnomaly({ severity: "medium" });
    const action = gen.evaluate(anomaly);
    expect(action).toBeNull();
  });

  it("returns null when anomaly has no symbol", () => {
    const gen = new TradeGenerator(emptyPositions);
    const anomaly = makeAnomaly({ symbol: undefined });
    const action = gen.evaluate(anomaly);
    expect(action).toBeNull();
  });

  it("generates buy action for volume drop anomaly", () => {
    const gen = new TradeGenerator(emptyPositions);
    const anomaly = makeAnomaly({
      severity: "high",
      description: "Volume drop detected: AAPL volume fell 60%",
      metrics: { volume: 200000, volumeChange: -60 },
    });
    const action = gen.evaluate(anomaly);
    expect(action).not.toBeNull();
    // Volume drop signals potential accumulation — buy
    expect(action!.side).toBe("buy");
  });

  it("will not generate buy when already holding position", () => {
    const gen = new TradeGenerator(holdingPositions);
    const anomaly = makeAnomaly({
      severity: "high",
      description: "Volume drop detected",
      metrics: { volume: 200000, volumeChange: -60 },
    });
    const action = gen.evaluate(anomaly);
    // Should not double up on existing position
    expect(action).toBeNull();
  });

  it("generates sell when holding position and price spike occurs", () => {
    const gen = new TradeGenerator(holdingPositions);
    const anomaly = makeAnomaly({
      severity: "high",
      description: "Price spike detected",
      metrics: { close: 200, priceChange: 8 },
    });
    const action = gen.evaluate(anomaly);
    expect(action).not.toBeNull();
    expect(action!.side).toBe("sell");
    expect(action!.qty).toBe(100); // Sell entire position
  });

  it("uses default qty when no position to sell", () => {
    const gen = new TradeGenerator(emptyPositions);
    const anomaly = makeAnomaly({
      severity: "high",
      description: "Price spike detected",
    });
    const action = gen.evaluate(anomaly);
    expect(action).not.toBeNull();
    expect(action!.qty).toBe(1); // Default minimum qty
  });

  it("maps preScreenScore to confidence", () => {
    const gen = new TradeGenerator(emptyPositions);
    const anomaly = makeAnomaly({ preScreenScore: 0.95 });
    const action = gen.evaluate(anomaly);
    expect(action).not.toBeNull();
    expect(action!.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("emits onAction callback when trade generated", () => {
    const gen = new TradeGenerator(emptyPositions);
    const callback = vi.fn();
    gen.onAction = callback;

    const anomaly = makeAnomaly({ severity: "high" });
    gen.evaluate(anomaly);

    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0]![0]).toHaveProperty("symbol", "AAPL");
  });

  it("does not emit onAction when no trade generated", () => {
    const gen = new TradeGenerator(emptyPositions);
    const callback = vi.fn();
    gen.onAction = callback;

    gen.evaluate(makeAnomaly({ severity: "low" }));
    expect(callback).not.toHaveBeenCalled();
  });
});
