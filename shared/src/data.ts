export type DataTick = {
  sourceId: string;
  timestamp: number;
  symbol?: string;
  metrics: Record<string, number>;
  metadata: Record<string, unknown>;
  raw?: unknown;
};

export type SourceHealthStatus = "healthy" | "degraded" | "offline";

export type SourceHealth = {
  sourceId: string;
  status: SourceHealthStatus;
  lastSuccess: number;
  lastFailure?: number;
  failCount: number;
  latencyMs: number;
  message?: string;
};

export type SourceType = "polling" | "streaming" | "file";

export type SourceConfig = {
  id: string;
  name: string;
  type: SourceType;
  plugin: string;
  config: Record<string, unknown>;
  pollIntervalMs?: number;
  enabled: boolean;
};
