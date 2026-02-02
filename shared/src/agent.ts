import type { DataTick } from "./data.js";
import type { Anomaly, AnomalyFeedback } from "./anomaly.js";

export type SessionKind = "monitor" | "subagent" | "improvement";

export type SessionMeta = {
  id: string;
  startedAt: number;
  endedAt?: number;
  kind: SessionKind;
  parentSessionId?: string;
  tokenCount: number;
};

export type AgentMessageRole = "user" | "assistant" | "system";

export type AgentMessage = {
  role: AgentMessageRole;
  content: string;
  model?: string;
  usage?: { input: number; output: number };
  timestamp: number;
};

export type CycleState = {
  cycleId: string;
  sessionId: string;
  batchNumber: number;
  tickCount: number;
  anomaliesDetected: number;
  startedAt: number;
};

export type AgentState = "idle" | "running" | "paused" | "error";

export type AgentStatus = {
  state: AgentState;
  currentSessionId?: string;
  currentCycleId?: string;
  totalCycles: number;
  totalAnomalies: number;
  uptime: number;
  lastError?: string;
};

export type AgentActivityType =
  | "cycle_start"
  | "cycle_end"
  | "anomaly_detected"
  | "memory_flush"
  | "compaction"
  | "subagent_spawn"
  | "feedback_processed"
  | "rule_evolved"
  | "error";

export type AgentActivity = {
  type: AgentActivityType;
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
};

export type SessionTranscriptEntry =
  | { type: "session"; version: number; id: string; timestamp: string; kind: SessionKind }
  | { type: "data_tick"; source: string; payload: DataTick }
  | { type: "message"; message: AgentMessage }
  | { type: "anomaly"; anomaly: Anomaly }
  | { type: "feedback"; feedback: AnomalyFeedback };
