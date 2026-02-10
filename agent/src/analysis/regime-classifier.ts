import type { MACDResult } from "./indicators.js";

export type Regime = "momentum" | "mean-reversion" | "neutral" | "unknown";

export type Indicators = {
  rsi?: number;
  macd?: MACDResult;
  atr?: number;
};

/**
 * Classify market regime based on technical indicators.
 * - Momentum: RSI > 60 or < 40, with MACD histogram confirming direction
 * - Mean-reversion: RSI 45-55, MACD histogram near zero
 * - Neutral: everything else with known indicators
 * - Unknown: insufficient indicator data
 */
export function classifyRegime(indicators: Indicators): Regime {
  if (indicators.rsi === undefined || indicators.macd === undefined) {
    return "unknown";
  }

  const { rsi, macd } = indicators;
  const absHistogram = Math.abs(macd.histogram);

  // Momentum: strong RSI deviation with confirming MACD
  const isOverbought = rsi > 60;
  const isOversold = rsi < 40;
  if ((isOverbought || isOversold) && absHistogram > 0.1) {
    return "momentum";
  }

  // Mean-reversion: RSI near 50, MACD histogram near zero
  if (rsi >= 45 && rsi <= 55 && absHistogram < 0.5) {
    return "mean-reversion";
  }

  return "neutral";
}
