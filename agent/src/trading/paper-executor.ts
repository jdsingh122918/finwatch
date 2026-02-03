import type { TradeAction, TradeAuditEntry, TradeOutcome, FeedbackVerdict } from "@finwatch/shared";
import { createLogger } from "../utils/logger.js";

export type PaperExecutorConfig = {
  keyId: string;
  secretKey: string;
  baseUrl: string;
};

export class PaperExecutor {
  private config: PaperExecutorConfig;
  private log = createLogger("paper-executor");
  private history: TradeAuditEntry[] = [];
  private auditSeq = 0;

  onAudit?: (entry: TradeAuditEntry) => void;
  onFeedback?: (anomalyId: string, verdict: FeedbackVerdict) => void;

  constructor(config: PaperExecutorConfig) {
    this.config = config;
  }

  get tradeCount(): number {
    return this.history.length;
  }

  async execute(action: TradeAction): Promise<TradeAuditEntry> {
    const url = `${this.config.baseUrl}/v2/orders`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    this.log.info("Executing paper order", { symbol: action.symbol, side: action.side, qty: action.qty });
    let response: Response;
    try {
      response = await globalThis.fetch(url, {
        method: "POST",
        headers: {
          "APCA-API-KEY-ID": this.config.keyId,
          "APCA-API-SECRET-KEY": this.config.secretKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          symbol: action.symbol,
          qty: String(action.qty),
          side: action.side,
          type: action.type,
          time_in_force: "day",
        }),
        signal: controller.signal,
      });
    } catch (err) {
      this.log.error("Order request failed", { symbol: action.symbol, error: err instanceof Error ? err.message : String(err) });
      throw new Error(
        `Order request failed for ${action.side} ${action.qty} ${action.symbol}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Alpaca paper order API returned HTTP ${response.status}: ${text}`,
      );
    }

    const audit: TradeAuditEntry = {
      id: `audit-${++this.auditSeq}-${Date.now()}`,
      action,
      anomalyId: action.anomalyId,
      outcome: "pending",
      limitsChecked: [],
      timestamp: Date.now(),
    };

    this.history.push(audit);
    this.onAudit?.(audit);
    return audit;
  }

  resolveOutcome(auditId: string, outcome: TradeOutcome): boolean {
    const entry = this.history.find((e) => e.id === auditId);
    if (!entry) {
      this.log.warn("Audit entry not found for outcome resolution", { auditId });
      return false;
    }

    this.log.info("Resolved trade outcome", { auditId, outcome });
    entry.outcome = outcome;

    // Auto-generate anomaly feedback based on trade outcome
    if (this.onFeedback) {
      const verdict: FeedbackVerdict =
        outcome === "profit" ? "confirmed" : "needs_review";
      this.onFeedback(entry.anomalyId, verdict);
    }
    return true;
  }

  getHistory(): TradeAuditEntry[] {
    return this.history;
  }
}
