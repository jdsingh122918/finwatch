export type Severity = "low" | "medium" | "high" | "critical";

export type Anomaly = {
  id: string;
  severity: Severity;
  source: string;
  symbol?: string;
  timestamp: number;
  description: string;
  metrics: Record<string, number>;
  preScreenScore: number;
  sessionId: string;
};

export type FeedbackVerdict = "confirmed" | "false_positive" | "needs_review";

export type AnomalyFeedback = {
  anomalyId: string;
  verdict: FeedbackVerdict;
  note?: string;
  timestamp: number;
};

export type AnomalyFilter = {
  severity?: Severity[];
  source?: string;
  symbol?: string;
  since?: number;
  limit?: number;
};
