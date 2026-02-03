import type { TradeAction, RiskLimits } from "@finwatch/shared";
import { createLogger } from "../utils/logger.js";

export type RiskContext = {
  currentPrice: number;
  currentExposure: number;
  dailyTradeCount: number;
  lastTradeTimestamp: number | undefined;
  lastTradeSymbol?: string;
  unrealizedPnl?: number;
  portfolioValue?: number;
};

export type RiskCheckResult = {
  approved: boolean;
  violations: string[];
  limitsChecked: string[];
};

export class RiskManager {
  private log = createLogger("risk-manager");
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

    // Maximum loss percentage check
    limitsChecked.push("maxLossPct");
    if (
      this.limits.maxLossPct > 0 &&
      ctx.portfolioValue !== undefined &&
      ctx.unrealizedPnl !== undefined &&
      ctx.portfolioValue > 0
    ) {
      const lossPct = Math.abs(Math.min(0, ctx.unrealizedPnl)) / ctx.portfolioValue * 100;
      if (lossPct >= this.limits.maxLossPct) {
        violations.push("maxLossPct");
      }
    }

    if (violations.length > 0) {
      this.log.warn("Risk violation detected", { violations, symbol: action.symbol });
    }

    return {
      approved: violations.length === 0,
      violations,
      limitsChecked,
    };
  }
}
