import type { TradeAction, TradeAuditEntry, TradeOutcome, FeedbackVerdict } from "@finwatch/shared";

export type PaperExecutorConfig = {
  keyId: string;
  secretKey: string;
  baseUrl: string;
};

let auditSeq = 0;

export class PaperExecutor {
  private config: PaperExecutorConfig;
  private history: TradeAuditEntry[] = [];

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
    const response = await globalThis.fetch(url, {
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
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Alpaca paper order API returned HTTP ${response.status}: ${text}`,
      );
    }

    const audit: TradeAuditEntry = {
      id: `audit-${++auditSeq}-${Date.now()}`,
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

  resolveOutcome(auditId: string, outcome: TradeOutcome): void {
    const entry = this.history.find((e) => e.id === auditId);
    if (!entry) return;

    entry.outcome = outcome;

    // Auto-generate anomaly feedback based on trade outcome
    if (this.onFeedback) {
      const verdict: FeedbackVerdict =
        outcome === "profit" ? "confirmed" : "needs_review";
      this.onFeedback(entry.anomalyId, verdict);
    }
  }

  getHistory(): TradeAuditEntry[] {
    return this.history;
  }
}
