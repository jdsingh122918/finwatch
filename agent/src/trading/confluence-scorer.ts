import type { Anomaly } from "@finwatch/shared";
import type { RegimeContext, IndicatorSnapshot } from "./regime-detector.js";

export type SignalScore = {
  total: number;
  components: {
    anomaly: number;
    trend: number;
    momentum: number;
    volume: number;
  };
  direction: "long" | "short";
  regime: RegimeContext;
};

type AnomalySignal = "price_spike" | "price_drop" | "volume_spike" | "volume_drop" | "unknown";

function classifyAnomaly(anomaly: Anomaly): AnomalySignal {
  const desc = anomaly.description.toLowerCase();
  const metrics = anomaly.metrics;

  if (
    desc.includes("spike") ||
    desc.includes("jump") ||
    desc.includes("surge")
  ) {
    // Check if this is specifically a volume signal
    if (
      desc.includes("volume spike") ||
      desc.includes("volume surge")
    ) {
      return "volume_spike";
    }
    return "price_spike";
  }

  if (
    desc.includes("drop") ||
    desc.includes("decline") ||
    desc.includes("fell") ||
    desc.includes("decrease")
  ) {
    if (
      desc.includes("volume drop") ||
      desc.includes("volume fell")
    ) {
      return "volume_drop";
    }
    return "price_drop";
  }

  // Fallback to metrics
  if (metrics.priceChange !== undefined) {
    if (metrics.priceChange > 0.03) return "price_spike";
    if (metrics.priceChange < -0.03) return "price_drop";
  }

  if (metrics.volumeChange !== undefined) {
    if (metrics.volumeChange > 0.5) return "volume_spike";
    if (metrics.volumeChange < 0) return "volume_drop";
  }

  return "unknown";
}

function determineDirection(
  signal: AnomalySignal,
  regime: RegimeContext,
): "long" | "short" {
  // Regime overrides for price signals
  if (regime.regime === "trending_up") {
    if (signal === "price_spike") return "long"; // follow momentum
    if (signal === "price_drop") return "long"; // buy the dip
  }
  if (regime.regime === "mean_reverting") {
    if (signal === "price_spike") return "short"; // fade the extreme
    if (signal === "price_drop") return "long"; // fade the extreme
  }

  // Default directions
  switch (signal) {
    case "price_spike":
      return "short";
    case "price_drop":
      return "long";
    case "volume_spike":
      return "long";
    case "volume_drop":
      return "long";
    case "unknown":
      if (regime.regime === "trending_up") return "long";
      if (regime.regime === "trending_down") return "short";
      return "long";
  }
}

function scoreAnomalyComponent(anomaly: Anomaly): number {
  const severityPoints: Record<string, number> = {
    critical: 15,
    high: 10,
    medium: 5,
    low: 0,
  };
  const severity = severityPoints[anomaly.severity] ?? 0;
  const confidence = anomaly.preScreenScore * 25;
  return Math.min(40, severity + confidence);
}

function scoreTrendComponent(
  indicators: IndicatorSnapshot,
  direction: "long" | "short",
): number {
  let rsiScore: number;
  let macdScore: number;

  if (direction === "long") {
    // RSI: < 40 = 10pts (oversold, good for buy), > 70 = 0pts
    if (indicators.rsi <= 40) {
      rsiScore = 10;
    } else if (indicators.rsi >= 70) {
      rsiScore = 0;
    } else {
      // Linear interpolation: 10 at 40, 0 at 70
      rsiScore = ((70 - indicators.rsi) / 30) * 10;
    }
    // MACD crossing up
    macdScore = indicators.macdHistogram > 0 ? 10 : 0;
  } else {
    // SHORT: RSI > 60 = 10pts, < 40 = 0pts
    if (indicators.rsi >= 60) {
      rsiScore = 10;
    } else if (indicators.rsi <= 40) {
      rsiScore = 0;
    } else {
      // Linear interpolation: 0 at 40, 10 at 60
      rsiScore = ((indicators.rsi - 40) / 20) * 10;
    }
    // MACD crossing down
    macdScore = indicators.macdHistogram < 0 ? 10 : 0;
  }

  return Math.min(20, rsiScore + macdScore);
}

function scoreMomentumComponent(
  indicators: IndicatorSnapshot,
  direction: "long" | "short",
): number {
  const pB = indicators.bollingerPercentB;

  if (direction === "long") {
    // percentB < 0.2 = 20pts (near lower band), > 0.8 = 0pts
    if (pB <= 0.2) return 20;
    if (pB >= 0.8) return 0;
    // Linear interpolation: 20 at 0.2, 0 at 0.8
    return ((0.8 - pB) / 0.6) * 20;
  } else {
    // SHORT: percentB > 0.8 = 20pts, < 0.2 = 0pts
    if (pB >= 0.8) return 20;
    if (pB <= 0.2) return 0;
    // Linear interpolation: 0 at 0.2, 20 at 0.8
    return ((pB - 0.2) / 0.6) * 20;
  }
}

function scoreVolumeComponent(anomaly: Anomaly): number {
  const volumeChange = anomaly.metrics.volumeChange;

  // No volume data -> neutral
  if (volumeChange === undefined) return 10;

  // Volume spike (confirming) = 20pts, volume declining = 0pts
  if (volumeChange > 0) return 20;
  return 0;
}

export function scoreConfluence(
  anomaly: Anomaly,
  indicators: IndicatorSnapshot,
  regime: RegimeContext,
): SignalScore {
  const signal = classifyAnomaly(anomaly);
  const direction = determineDirection(signal, regime);

  const anomalyPts = scoreAnomalyComponent(anomaly);
  const trendPts = scoreTrendComponent(indicators, direction);
  const momentumPts = scoreMomentumComponent(indicators, direction);
  const volumePts = scoreVolumeComponent(anomaly);

  const total = Math.max(0, Math.min(100, anomalyPts + trendPts + momentumPts + volumePts));

  return {
    total,
    components: {
      anomaly: anomalyPts,
      trend: trendPts,
      momentum: momentumPts,
      volume: volumePts,
    },
    direction,
    regime,
  };
}
