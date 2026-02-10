import type { Anomaly, TradeAction } from "@finwatch/shared";
import { createLogger } from "../utils/logger.js";

export type PositionLookup = {
  hasPosition(symbol: string): boolean;
  getQty(symbol: string): number;
};

const ACTIONABLE_SEVERITIES = new Set(["high", "critical"]);
const DEFAULT_QTY = 1;

type AnomalySignal = "price_spike" | "price_drop" | "volume_spike" | "volume_drop" | "unknown";

function classifyAnomaly(anomaly: Anomaly): AnomalySignal {
  const desc = anomaly.description.toLowerCase();
  const metrics = anomaly.metrics;

  if (
    desc.includes("price spike") ||
    desc.includes("price jump") ||
    desc.includes("price surge") ||
    (metrics.priceChange !== undefined && metrics.priceChange > 0.03)
  ) {
    return "price_spike";
  }

  if (
    desc.includes("price drop") ||
    desc.includes("price decline") ||
    desc.includes("price fell") ||
    desc.includes("significant decrease") ||
    (metrics.priceChange !== undefined && metrics.priceChange < -0.03)
  ) {
    return "price_drop";
  }

  if (
    desc.includes("volume spike") ||
    desc.includes("volume surge") ||
    desc.includes("high volume") ||
    (metrics.volumeChange !== undefined && metrics.volumeChange > 0.5)
  ) {
    return "volume_spike";
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
  private log = createLogger("trade-generator");
  onAction?: (action: TradeAction) => void;

  constructor(positions: PositionLookup) {
    this.positions = positions;
  }

  evaluate(anomaly: Anomaly): TradeAction | null {
    // Only act on high/critical severity
    if (!ACTIONABLE_SEVERITIES.has(anomaly.severity)) {
      this.log.debug("Skipped anomaly", { reason: `severity too low: ${anomaly.severity}` });
      return null;
    }

    // Must have a symbol to trade
    if (!anomaly.symbol) {
      this.log.debug("Skipped anomaly", { reason: "no symbol" });
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
        if (holding) {
          // Price spike with position → sell (take profit)
          side = "sell";
          qty = heldQty;
          rationale = `Selling ${qty} shares of ${symbol} — price spike anomaly, taking profit`;
        } else {
          // Price spike without position → buy (momentum entry)
          side = "buy";
          qty = DEFAULT_QTY;
          rationale = `Buy signal on ${symbol} — price spike anomaly, momentum entry`;
        }
        break;

      case "price_drop":
        if (holding) {
          // Price drop with position → sell (stop loss)
          side = "sell";
          qty = heldQty;
          rationale = `Selling ${qty} shares of ${symbol} — price drop anomaly, cutting losses`;
        } else {
          // Price drop without position → buy (mean reversion / buy the dip)
          side = "buy";
          qty = DEFAULT_QTY;
          rationale = `Buy signal on ${symbol} — price drop anomaly, mean reversion entry`;
        }
        break;

      case "volume_spike":
        if (holding) {
          this.log.debug("Skipped anomaly", { reason: "already holding for volume_spike signal" });
          return null;
        }
        side = "buy";
        qty = DEFAULT_QTY;
        rationale = `Buy signal on ${symbol} — volume spike may indicate institutional interest`;
        break;

      case "volume_drop":
        if (holding) {
          this.log.debug("Skipped anomaly", { reason: "already holding for volume_drop signal" });
          return null;
        }
        side = "buy";
        qty = DEFAULT_QTY;
        rationale = `Buy signal on ${symbol} — volume drop may indicate accumulation phase`;
        break;

      case "unknown":
      default:
        if (holding) {
          // Unknown high/critical with position → sell (defensive)
          side = "sell";
          qty = heldQty;
          rationale = `Sell signal on ${symbol} — ${anomaly.severity} anomaly: ${anomaly.description}`;
        } else {
          // Unknown high/critical without position → buy (anomaly-driven entry)
          side = "buy";
          qty = DEFAULT_QTY;
          rationale = `Buy signal on ${symbol} — ${anomaly.severity} anomaly detected: ${anomaly.description}`;
        }
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

    this.log.info("Generated trade action", { symbol, side, qty });
    this.onAction?.(action);
    return action;
  }
}
