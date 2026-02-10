import type { Anomaly, DataTick, TradeAction } from "@finwatch/shared";
import { createLogger } from "../utils/logger.js";
import { detectRegime } from "./regime-detector.js";
import type { IndicatorSnapshot } from "./regime-detector.js";
import { scoreConfluence } from "./confluence-scorer.js";
import { sizePosition } from "./position-sizer.js";

export type PositionLookup = {
  hasPosition(symbol: string): boolean;
  getQty(symbol: string): number;
};

export type ComputeIndicatorsFn = (symbol: string, ticks: DataTick[]) => Promise<IndicatorSnapshot>;

export type TradeGeneratorConfig = {
  positions: PositionLookup;
  computeIndicators?: ComputeIndicatorsFn;
  accountEquity?: number;
};

const ACTIONABLE_SEVERITIES = new Set(["high", "critical"]);
const DEFAULT_QTY = 1;
const DEFAULT_ACCOUNT_EQUITY = 100000;
const MIN_CONFLUENCE_SCORE = 40;

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
  const base = anomaly.preScreenScore;
  const severityBoost = anomaly.severity === "critical" ? 0.1 : 0;
  return Math.min(1, Math.max(0.5, base + severityBoost));
}

function isTradeGeneratorConfig(arg: PositionLookup | TradeGeneratorConfig): arg is TradeGeneratorConfig {
  return "positions" in arg;
}

export class TradeGenerator {
  private positions: PositionLookup;
  private computeIndicators?: ComputeIndicatorsFn;
  private accountEquity: number;
  private log = createLogger("trade-generator");
  onAction?: (action: TradeAction) => void;

  constructor(positions: PositionLookup);
  constructor(config: TradeGeneratorConfig);
  constructor(arg: PositionLookup | TradeGeneratorConfig) {
    if (isTradeGeneratorConfig(arg)) {
      this.positions = arg.positions;
      this.computeIndicators = arg.computeIndicators;
      this.accountEquity = arg.accountEquity ?? DEFAULT_ACCOUNT_EQUITY;
    } else {
      this.positions = arg;
      this.accountEquity = DEFAULT_ACCOUNT_EQUITY;
    }
  }

  async evaluate(anomaly: Anomaly, ticks?: DataTick[]): Promise<TradeAction | null> {
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

    // V2 path: use scoring pipeline when computeIndicators and ticks are available
    if (this.computeIndicators && ticks && ticks.length > 0) {
      return this.evaluateV2(anomaly, ticks);
    }

    // V1 fallback: existing logic
    return this.evaluateV1(anomaly);
  }

  private async evaluateV2(anomaly: Anomaly, ticks: DataTick[]): Promise<TradeAction | null> {
    const symbol = anomaly.symbol!;

    // Step 1: Compute indicators
    const indicators = await this.computeIndicators!(symbol, ticks);

    // Step 2: Detect regime
    const regime = detectRegime(indicators);

    // Step 3: Score confluence
    const score = scoreConfluence(anomaly, indicators, regime);

    // Step 4: Check minimum score threshold
    if (score.total < MIN_CONFLUENCE_SCORE) {
      this.log.debug("V2 skipped: confluence score too low", {
        symbol,
        score: score.total,
        threshold: MIN_CONFLUENCE_SCORE,
      });
      return null;
    }

    // Step 5: Determine direction
    const side: "buy" | "sell" = score.direction === "long" ? "buy" : "sell";

    // Step 6: Position checks
    const holding = this.positions.hasPosition(symbol);
    const heldQty = this.positions.getQty(symbol);

    if (holding) {
      // Existing position is always long (positive qty) in our model
      const holdingLong = heldQty > 0;
      const signalIsLong = side === "buy";
      if (holdingLong === signalIsLong) {
        // Same direction as existing position -- no doubling
        this.log.debug("V2 skipped: already holding in same direction", { symbol, side });
        return null;
      }
      // Opposite direction -- close position by selling held shares
      const closeQty = Math.abs(heldQty);
      const closeSide: "buy" | "sell" = holdingLong ? "sell" : "buy";
      const action: TradeAction = {
        symbol,
        side: closeSide,
        qty: closeQty,
        type: "market",
        rationale: `CLOSE ${symbol}: confluence score ${Math.round(score.total)}/100 signals ${score.direction} but holding ${holdingLong ? "long" : "short"}. Closing ${closeQty} shares.`,
        confidence: score.total / 100,
        anomalyId: anomaly.id,
      };

      this.log.info("V2 closing position", { symbol, side: closeSide, qty: closeQty });
      this.onAction?.(action);
      return action;
    }

    // Step 7: Size position
    const currentPrice = anomaly.metrics.close ?? ticks[ticks.length - 1]!.metrics.close ?? 0;
    const sizing = sizePosition({
      atr: indicators.atr,
      confluenceScore: score.total,
      regime,
      accountEquity: this.accountEquity,
      currentPrice,
      existingPositionValue: 0,
    });

    if (sizing.qty === 0) {
      this.log.debug("V2 skipped: position sizer returned 0 qty", { symbol });
      return null;
    }

    // Step 8: Build rich rationale
    const signal = classifyAnomaly(anomaly);
    const rationale = `${side.toUpperCase()} ${symbol}: ${signal.replace("_", " ")} anomaly (severity: ${anomaly.severity}, confidence: ${anomaly.preScreenScore.toFixed(2)}) in ${regime.regime} regime. Confluence score ${Math.round(score.total)}/100 — anomaly: ${Math.round(score.components.anomaly)}, trend: ${Math.round(score.components.trend)}, momentum: ${Math.round(score.components.momentum)}, volume: ${Math.round(score.components.volume)}. ATR-sized at ${sizing.qty} shares.`;

    const action: TradeAction = {
      symbol,
      side,
      qty: sizing.qty,
      type: "market",
      rationale,
      confidence: score.total / 100,
      anomalyId: anomaly.id,
    };

    this.log.info("V2 generated trade action", { symbol, side, qty: sizing.qty, score: score.total });
    this.onAction?.(action);
    return action;
  }

  private evaluateV1(anomaly: Anomaly): TradeAction | null {
    const symbol = anomaly.symbol!;
    const signal = classifyAnomaly(anomaly);
    const holding = this.positions.hasPosition(symbol);
    const heldQty = this.positions.getQty(symbol);

    let side: "buy" | "sell";
    let qty: number;
    let rationale: string;

    switch (signal) {
      case "price_spike":
        if (holding) {
          side = "sell";
          qty = heldQty;
          rationale = `Selling ${qty} shares of ${symbol} — price spike anomaly, taking profit`;
        } else {
          side = "buy";
          qty = DEFAULT_QTY;
          rationale = `Buy signal on ${symbol} — price spike anomaly, momentum entry`;
        }
        break;

      case "price_drop":
        if (holding) {
          side = "sell";
          qty = heldQty;
          rationale = `Selling ${qty} shares of ${symbol} — price drop anomaly, cutting losses`;
        } else {
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
          side = "sell";
          qty = heldQty;
          rationale = `Sell signal on ${symbol} — ${anomaly.severity} anomaly: ${anomaly.description}`;
        } else {
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
