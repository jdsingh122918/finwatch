import type { AgentStatus, AgentActivity } from "./agent.js";
import type { Anomaly, AnomalyFeedback, AnomalyFilter } from "./anomaly.js";
import type { DataTick, SourceHealth } from "./data.js";
import type { SearchResult, MemoryEvent } from "./memory.js";
import type { Config } from "./config.js";

// Commands: React -> Rust -> Node.js (request/response)
export type IpcCommands = {
  "agent:start": () => void;
  "agent:stop": () => void;
  "agent:status": () => AgentStatus;
  "config:get": () => Config;
  "config:update": (patch: Partial<Config>) => Config;
  "anomalies:list": (filter: AnomalyFilter) => Anomaly[];
  "anomalies:feedback": (id: string, feedback: AnomalyFeedback) => void;
  "memory:search": (query: string) => SearchResult[];
  "sources:health": () => Record<string, SourceHealth>;
};

// Events: Node.js -> Rust -> React (push, fire-and-forget)
export type IpcEvents = {
  "agent:activity": AgentActivity;
  "data:tick": DataTick;
  "anomaly:detected": Anomaly;
  "source:health-change": SourceHealth;
  "memory:updated": MemoryEvent;
};
