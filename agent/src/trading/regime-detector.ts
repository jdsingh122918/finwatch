import { createLogger } from "../utils/logger.js";

export type Regime = "trending_up" | "trending_down" | "mean_reverting" | "volatile";

export type RegimeContext = {
  regime: Regime;
  confidence: number;
  atrMultiple: number;
  rsiZone: "overbought" | "neutral" | "oversold";
};

export type IndicatorSnapshot = {
  rsi: number;
  macdHistogram: number;
  macdLine: number;
  macdSignal: number;
  bollingerPercentB: number;
  bollingerWidth: number;
  atr: number;
  atrAvg20: number;
};

const log = createLogger("regime-detector");

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function classifyRsiZone(rsi: number): "overbought" | "neutral" | "oversold" {
  if (rsi > 70) return "overbought";
  if (rsi < 30) return "oversold";
  return "neutral";
}

export function detectRegime(indicators: IndicatorSnapshot): RegimeContext {
  const atrMultiple = indicators.atrAvg20 > 0
    ? indicators.atr / indicators.atrAvg20
    : indicators.atr;
  const rsiZone = classifyRsiZone(indicators.rsi);

  // 1. Volatile check (overrides everything)
  if (atrMultiple > 1.5) {
    const confidence = clamp(0.5 + (atrMultiple - 1.5) * 0.2, 0, 1);
    log.debug("Regime: volatile (high ATR)", { atrMultiple, confidence });
    return { regime: "volatile", confidence, atrMultiple, rsiZone };
  }

  // Score trending signals
  const bullishSignals = countBullishSignals(indicators);
  const bearishSignals = countBearishSignals(indicators);
  const neutralSignals = countNeutralSignals(indicators);

  // 5. Conflict resolution: if both bullish and bearish signals present, fallback to volatile
  if (bullishSignals > 0 && bearishSignals > 0) {
    const confidence = clamp(0.3 + (Math.min(bullishSignals, bearishSignals) / 6) * 0.2, 0.3, 0.5);
    log.debug("Regime: volatile (conflicting signals)", {
      bullishSignals,
      bearishSignals,
      confidence,
    });
    return { regime: "volatile", confidence, atrMultiple, rsiZone };
  }

  // 2. Trending up
  if (bullishSignals >= 2) {
    const confidence = clamp(bullishSignals / 3, 0.3, 1);
    log.debug("Regime: trending_up", { bullishSignals, confidence });
    return { regime: "trending_up", confidence, atrMultiple, rsiZone };
  }

  // 3. Trending down
  if (bearishSignals >= 2) {
    const confidence = clamp(bearishSignals / 3, 0.3, 1);
    log.debug("Regime: trending_down", { bearishSignals, confidence });
    return { regime: "trending_down", confidence, atrMultiple, rsiZone };
  }

  // 4. Mean-reverting (default)
  const meanRevertConfidence = clamp(neutralSignals / 3, 0.3, 1);
  log.debug("Regime: mean_reverting", { neutralSignals, confidence: meanRevertConfidence });
  return { regime: "mean_reverting", confidence: meanRevertConfidence, atrMultiple, rsiZone };
}

function countBullishSignals(ind: IndicatorSnapshot): number {
  let count = 0;
  if (ind.rsi > 60) count++;
  if (ind.macdHistogram > 0 && ind.macdLine > ind.macdSignal) count++;
  if (ind.bollingerPercentB > 0.8) count++;
  return count;
}

function countBearishSignals(ind: IndicatorSnapshot): number {
  let count = 0;
  if (ind.rsi < 40) count++;
  if (ind.macdHistogram < 0 && ind.macdLine < ind.macdSignal) count++;
  if (ind.bollingerPercentB < 0.2) count++;
  return count;
}

function countNeutralSignals(ind: IndicatorSnapshot): number {
  let count = 0;
  if (ind.rsi >= 40 && ind.rsi <= 60) count++;
  if (Math.abs(ind.macdHistogram) < 0.1) count++;
  if (ind.bollingerPercentB >= 0.2 && ind.bollingerPercentB <= 0.8) count++;
  return count;
}
