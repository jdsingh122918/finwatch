import type { TradeAction, RiskLimits } from "@finwatch/shared";

export type RiskContext = {
  currentPrice: number;
  currentExposure: number;
  dailyTradeCount: number;
  lastTradeTimestamp: number | undefined;
  lastTradeSymbol?: string;
};

export type RiskCheckResult = {
  approved: boolean;
  violations: string[];
  limitsChecked: string[];
};

export class RiskManager {
  private limits: RiskLimits;

  constructor(limits: RiskLimits) {
    this.limits = limits;
  }

  check(action: TradeAction, ctx: RiskContext): RiskCheckResult {
    const violations: string[] = [];
    const limitsChecked: string[] = [];
    const isBuy = action.side === "buy";
    const orderValue = action.qty * ctx.currentPrice;

    // Position size check (only for buys — sells reduce exposure)
    limitsChecked.push("maxPositionSize");
    if (isBuy && orderValue > this.limits.maxPositionSize) {
      violations.push("maxPositionSize");
    }

    // Total exposure check (only for buys)
    limitsChecked.push("maxExposure");
    if (isBuy && ctx.currentExposure + orderValue > this.limits.maxExposure) {
      violations.push("maxExposure");
    }

    // Daily trade count
    limitsChecked.push("maxDailyTrades");
    if (ctx.dailyTradeCount >= this.limits.maxDailyTrades) {
      violations.push("maxDailyTrades");
    }

    // Cooldown per symbol
    limitsChecked.push("cooldown");
    if (
      this.limits.cooldownMs > 0 &&
      ctx.lastTradeTimestamp !== undefined &&
      ctx.lastTradeSymbol === action.symbol &&
      Date.now() - ctx.lastTradeTimestamp < this.limits.cooldownMs
    ) {
      violations.push("cooldown");
    }

    return {
      approved: violations.length === 0,
      violations,
      limitsChecked,
    };
  }
}
