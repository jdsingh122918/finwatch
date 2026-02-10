import type { RegimeContext } from "./regime-detector.js";

export type SizingConfig = {
  riskPerTradePct: number;
  riskMultiplier: number;
  maxSymbolAllocationPct: number;
};

export type SizingInput = {
  atr: number;
  confluenceScore: number;
  regime: RegimeContext;
  accountEquity: number;
  currentPrice: number;
  existingPositionValue: number;
};

export type SizingResult = {
  qty: number;
  method: string;
  baseQty: number;
  confluenceMultiplier: number;
  regimeMultiplier: number;
  dollarRisk: number;
};

export const DEFAULT_SIZING_CONFIG: SizingConfig = {
  riskPerTradePct: 0.5,
  riskMultiplier: 2.0,
  maxSymbolAllocationPct: 20,
};

function getConfluenceMultiplier(score: number): number {
  if (score < 40) return 0;
  if (score < 60) return 0.5;
  if (score < 80) return 1.0;
  return 1.5;
}

function getRegimeMultiplier(regime: RegimeContext["regime"]): number {
  switch (regime) {
    case "trending_up":
    case "trending_down":
      return 1.0;
    case "mean_reverting":
      return 0.75;
    case "volatile":
      return 0.5;
  }
}

export function sizePosition(
  input: SizingInput,
  config?: Partial<SizingConfig>,
): SizingResult {
  const cfg: SizingConfig = { ...DEFAULT_SIZING_CONFIG, ...config };

  // Guard: invalid ATR or price
  if (input.atr <= 0 || input.currentPrice <= 0) {
    return {
      qty: 1,
      method: "guard: ATR or price <= 0",
      baseQty: 1,
      confluenceMultiplier: 1,
      regimeMultiplier: 1,
      dollarRisk: 0,
    };
  }

  // Step 1: dollar risk per share
  const dollarRisk = input.atr * cfg.riskMultiplier;

  // Step 2: account risk budget
  const accountRiskPerTrade = input.accountEquity * (cfg.riskPerTradePct / 100);

  // Step 3: base quantity from ATR sizing
  const baseQty = accountRiskPerTrade / dollarRisk;

  // Step 4: confluence multiplier
  const confluenceMultiplier = getConfluenceMultiplier(input.confluenceScore);

  // Step 5: regime multiplier
  const regimeMultiplier = getRegimeMultiplier(input.regime.regime);

  // If confluence says no trade, return 0
  if (confluenceMultiplier === 0) {
    return {
      qty: 0,
      method: "confluence filter: score < 40",
      baseQty,
      confluenceMultiplier,
      regimeMultiplier,
      dollarRisk,
    };
  }

  // Step 6: scale
  let scaledQty = baseQty * confluenceMultiplier * regimeMultiplier;

  // Step 7: portfolio constraint
  const maxAllocation =
    input.accountEquity * (cfg.maxSymbolAllocationPct / 100);
  const proposedValue = scaledQty * input.currentPrice;
  const totalExposure = input.existingPositionValue + proposedValue;

  let method = "ATR-risk sizing";

  if (totalExposure > maxAllocation) {
    const room = maxAllocation - input.existingPositionValue;
    if (room <= 0) {
      return {
        qty: 0,
        method: "portfolio constraint: existing position at/over max allocation",
        baseQty,
        confluenceMultiplier,
        regimeMultiplier,
        dollarRisk,
      };
    }
    scaledQty = room / input.currentPrice;
    method = "ATR-risk sizing (clamped by portfolio constraint)";
  }

  // Step 8: round and enforce minimum
  const finalQty = Math.max(1, Math.round(scaledQty));

  return {
    qty: finalQty,
    method,
    baseQty,
    confluenceMultiplier,
    regimeMultiplier,
    dollarRisk,
  };
}
