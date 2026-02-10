import { describe, it, expect } from "vitest";
import {
  sizePosition,
  DEFAULT_SIZING_CONFIG,
  type SizingInput,
  type SizingConfig,
} from "../position-sizer.js";
import type { RegimeContext } from "../regime-detector.js";

function makeRegime(overrides: Partial<RegimeContext> = {}): RegimeContext {
  return {
    regime: "trending_up",
    confidence: 0.8,
    atrMultiple: 1.2,
    rsiZone: "neutral",
    ...overrides,
  };
}

function makeInput(overrides: Partial<SizingInput> = {}): SizingInput {
  return {
    atr: 10,
    confluenceScore: 70,
    regime: makeRegime(),
    accountEquity: 100_000,
    currentPrice: 200,
    existingPositionValue: 0,
    ...overrides,
  };
}

describe("sizePosition", () => {
  describe("basic ATR sizing", () => {
    it("calculates baseQty from risk budget and dollarRisk", () => {
      // $100k equity * 0.5% risk = $500 risk budget
      // dollarRisk = $10 ATR * 2.0 multiplier = $20
      // baseQty = $500 / $20 = 25
      const result = sizePosition(makeInput());
      expect(result.baseQty).toBe(25);
      expect(result.dollarRisk).toBe(20);
    });

    it("reduces position for high ATR (volatile stock)", () => {
      // $100k equity * 0.5% = $500 risk budget
      // dollarRisk = $50 ATR * 2.0 = $100
      // baseQty = $500 / $100 = 5
      const result = sizePosition(makeInput({ atr: 50 }));
      expect(result.baseQty).toBe(5);
      expect(result.dollarRisk).toBe(100);
    });
  });

  describe("confluence multiplier", () => {
    it("returns 0 qty when score < 40 (no trade)", () => {
      const result = sizePosition(makeInput({ confluenceScore: 30 }));
      expect(result.qty).toBe(0);
      expect(result.confluenceMultiplier).toBe(0);
    });

    it("applies 0.5x for score 40-59 (weak signal)", () => {
      const result = sizePosition(makeInput({ confluenceScore: 45 }));
      expect(result.confluenceMultiplier).toBe(0.5);
      // baseQty=25, confluence=0.5, regime=1.0 → scaled=12.5 → round=13
      expect(result.qty).toBe(13);
    });

    it("applies 1.0x for score 60-79 (decent signal)", () => {
      const result = sizePosition(makeInput({ confluenceScore: 65 }));
      expect(result.confluenceMultiplier).toBe(1.0);
      expect(result.qty).toBe(25);
    });

    it("applies 1.5x for score >= 80 (strong signal)", () => {
      const result = sizePosition(makeInput({ confluenceScore: 85 }));
      expect(result.confluenceMultiplier).toBe(1.5);
      // baseQty=25 * 1.5 * 1.0 = 37.5 → round=38
      expect(result.qty).toBe(38);
    });

    it("applies 0.5x at exactly score 40", () => {
      const result = sizePosition(makeInput({ confluenceScore: 40 }));
      expect(result.confluenceMultiplier).toBe(0.5);
    });

    it("applies 1.0x at exactly score 60", () => {
      const result = sizePosition(makeInput({ confluenceScore: 60 }));
      expect(result.confluenceMultiplier).toBe(1.0);
    });

    it("applies 1.5x at exactly score 80", () => {
      const result = sizePosition(makeInput({ confluenceScore: 80 }));
      expect(result.confluenceMultiplier).toBe(1.5);
    });
  });

  describe("regime multiplier", () => {
    it("applies 1.0x for trending_up", () => {
      const result = sizePosition(
        makeInput({ regime: makeRegime({ regime: "trending_up" }) }),
      );
      expect(result.regimeMultiplier).toBe(1.0);
    });

    it("applies 1.0x for trending_down", () => {
      const result = sizePosition(
        makeInput({ regime: makeRegime({ regime: "trending_down" }) }),
      );
      expect(result.regimeMultiplier).toBe(1.0);
    });

    it("applies 0.75x for mean_reverting", () => {
      const result = sizePosition(
        makeInput({ regime: makeRegime({ regime: "mean_reverting" }) }),
      );
      expect(result.regimeMultiplier).toBe(0.75);
      // baseQty=25 * 1.0 * 0.75 = 18.75 → round=19
      expect(result.qty).toBe(19);
    });

    it("applies 0.5x for volatile regime", () => {
      const result = sizePosition(
        makeInput({ regime: makeRegime({ regime: "volatile" }) }),
      );
      expect(result.regimeMultiplier).toBe(0.5);
      // baseQty=25 * 1.0 * 0.5 = 12.5 → round=13
      expect(result.qty).toBe(13);
    });
  });

  describe("portfolio constraint", () => {
    it("clamps when proposed position would exceed max allocation", () => {
      // maxAllocation = $100k * 20% = $20k
      // existing = $18k, so room = $2k
      // At $200/share, max additional = 10 shares
      // Without clamp: baseQty=25, confluence=1.0, regime=1.0 → 25 shares
      // 25 * $200 = $5k, totalExposure = $18k + $5k = $23k > $20k
      // clamp: (20000 - 18000) / 200 = 10 shares
      const result = sizePosition(
        makeInput({ existingPositionValue: 18_000 }),
      );
      expect(result.qty).toBe(10);
    });

    it("returns qty=1 when existing position is near max but room for 1 share", () => {
      // maxAllocation = $20k, existing = $19_900, room = $100
      // At $200/share: 100/200 = 0.5 → round to 1 (min)
      const result = sizePosition(
        makeInput({ existingPositionValue: 19_900 }),
      );
      expect(result.qty).toBe(1);
    });

    it("returns qty=0 when existing position exceeds max allocation (confluence ok)", () => {
      // maxAllocation = $20k, existing = $21k → no room
      // Even though confluence > 40, clamp to 0 shares
      const result = sizePosition(
        makeInput({ existingPositionValue: 21_000 }),
      );
      expect(result.qty).toBe(0);
    });
  });

  describe("minimum qty and edge cases", () => {
    it("returns min qty=1 for any valid trade with tiny position", () => {
      // Very high ATR → very small baseQty, but should still be at least 1
      const result = sizePosition(makeInput({ atr: 500 }));
      // dollarRisk = 500*2 = 1000, baseQty = 500/1000 = 0.5
      // scaled = 0.5 * 1.0 * 1.0 = 0.5 → round = 1 → max(1, 1) = 1
      expect(result.qty).toBe(1);
    });

    it("returns qty=1 when ATR is 0 (guard)", () => {
      const result = sizePosition(makeInput({ atr: 0 }));
      expect(result.qty).toBe(1);
      expect(result.method).toContain("guard");
    });

    it("returns qty=1 when currentPrice is 0 (guard)", () => {
      const result = sizePosition(makeInput({ currentPrice: 0 }));
      expect(result.qty).toBe(1);
      expect(result.method).toContain("guard");
    });

    it("returns qty=1 when accountEquity is 0", () => {
      // 0 equity * 0.5% = 0 risk budget → baseQty = 0
      // But ATR guard catches if ATR > 0 → baseQty = 0/dollarRisk = 0
      // max(1, round(0)) → 1, but confluence could still zero it
      // With confluence >= 40, should be min 1
      const result = sizePosition(makeInput({ accountEquity: 0 }));
      expect(result.qty).toBe(1);
    });
  });

  describe("custom config", () => {
    it("overrides riskPerTradePct", () => {
      // 1% risk on $100k = $1000 budget, dollarRisk = $20
      // baseQty = 1000 / 20 = 50
      const result = sizePosition(makeInput(), { riskPerTradePct: 1.0 });
      expect(result.baseQty).toBe(50);
      expect(result.qty).toBe(50);
    });

    it("overrides riskMultiplier", () => {
      // dollarRisk = $10 * 3.0 = $30, baseQty = 500/30 ≈ 16.67
      const result = sizePosition(makeInput(), { riskMultiplier: 3.0 });
      expect(result.dollarRisk).toBe(30);
      expect(result.baseQty).toBeCloseTo(16.67, 1);
    });

    it("overrides maxSymbolAllocationPct", () => {
      // maxAllocation = $100k * 10% = $10k
      // existing = $8k, room = $2k, at $200/share = 10 shares
      // Without clamp: 25 shares * $200 = $5k, total = $13k > $10k
      const result = sizePosition(
        makeInput({ existingPositionValue: 8_000 }),
        { maxSymbolAllocationPct: 10 },
      );
      expect(result.qty).toBe(10);
    });

    it("uses defaults for unspecified config fields", () => {
      const result = sizePosition(makeInput(), { riskPerTradePct: 1.0 });
      // Other fields should still use defaults
      expect(result.dollarRisk).toBe(20); // default riskMultiplier = 2.0
    });
  });

  describe("result transparency", () => {
    it("includes all intermediate values in result", () => {
      const result = sizePosition(makeInput());
      expect(result).toHaveProperty("qty");
      expect(result).toHaveProperty("method");
      expect(result).toHaveProperty("baseQty");
      expect(result).toHaveProperty("confluenceMultiplier");
      expect(result).toHaveProperty("regimeMultiplier");
      expect(result).toHaveProperty("dollarRisk");
    });

    it("method describes the sizing approach", () => {
      const result = sizePosition(makeInput());
      expect(typeof result.method).toBe("string");
      expect(result.method.length).toBeGreaterThan(0);
    });
  });

  describe("DEFAULT_SIZING_CONFIG", () => {
    it("has expected default values", () => {
      expect(DEFAULT_SIZING_CONFIG.riskPerTradePct).toBe(0.5);
      expect(DEFAULT_SIZING_CONFIG.riskMultiplier).toBe(2.0);
      expect(DEFAULT_SIZING_CONFIG.maxSymbolAllocationPct).toBe(20);
    });
  });
});
