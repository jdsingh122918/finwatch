import type { Anomaly, TradeAction } from "@finwatch/shared";

export type PositionLookup = {
  hasPosition(symbol: string): boolean;
  getQty(symbol: string): number;
};

const ACTIONABLE_SEVERITIES = new Set(["high", "critical"]);
const DEFAULT_QTY = 1;

type AnomalySignal = "price_spike" | "volume_drop" | "unknown";

function classifyAnomaly(anomaly: Anomaly): AnomalySignal {
  const desc = anomaly.description.toLowerCase();
  const metrics = anomaly.metrics;

  if (
    desc.includes("price spike") ||
    desc.includes("price jump") ||
    (metrics.priceChange !== undefined && metrics.priceChange > 0)
  ) {
    return "price_spike";
  }

  if (
    desc.includes("volume drop") ||
    desc.includes("volume fell") ||
    (metrics.volumeChange !== undefined && metrics.volumeChange < 0)
  ) {
    return "volume_drop";
  }

  return "unknown";
}

function computeConfidence(anomaly: Anomaly): number {
  // Map preScreenScore (0-1) to confidence, with a floor of 0.5 for actionable anomalies
  const base = anomaly.preScreenScore;
  const severityBoost = anomaly.severity === "critical" ? 0.1 : 0;
  return Math.min(1, Math.max(0.5, base + severityBoost));
}

export class TradeGenerator {
  private positions: PositionLookup;
  onAction?: (action: TradeAction) => void;

  constructor(positions: PositionLookup) {
    this.positions = positions;
  }

  evaluate(anomaly: Anomaly): TradeAction | null {
    // Only act on high/critical severity
    if (!ACTIONABLE_SEVERITIES.has(anomaly.severity)) {
      return null;
    }

    // Must have a symbol to trade
    if (!anomaly.symbol) {
      return null;
    }

    const symbol = anomaly.symbol;
    const signal = classifyAnomaly(anomaly);
    const holding = this.positions.hasPosition(symbol);
    const heldQty = this.positions.getQty(symbol);

    let side: "buy" | "sell";
    let qty: number;
    let rationale: string;

    switch (signal) {
      case "price_spike":
        // Price spike → sell (take profit or short)
        side = "sell";
        qty = holding ? heldQty : DEFAULT_QTY;
        rationale = holding
          ? `Selling ${qty} shares of ${symbol} — price spike anomaly, taking profit on existing position`
          : `Sell signal on ${symbol} — price spike anomaly detected`;
        break;

      case "volume_drop":
        // Volume drop → buy (accumulation signal)
        if (holding) {
          // Don't double up on existing position
          return null;
        }
        side = "buy";
        qty = DEFAULT_QTY;
        rationale = `Buy signal on ${symbol} — volume drop may indicate accumulation phase`;
        break;

      case "unknown":
      default:
        // Unknown anomaly type on high/critical → default to sell (defensive)
        side = "sell";
        qty = holding ? heldQty : DEFAULT_QTY;
        rationale = `Sell signal on ${symbol} — ${anomaly.severity} anomaly detected: ${anomaly.description}`;
        break;
    }

    const action: TradeAction = {
      symbol,
      side,
      qty,
      type: "market",
      rationale,
      confidence: computeConfidence(anomaly),
      anomalyId: anomaly.id,
    };

    this.onAction?.(action);
    return action;
  }
}
