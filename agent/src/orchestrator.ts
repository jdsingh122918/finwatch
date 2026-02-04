import { EventEmitter } from "node:events";
import type { DataTick, Anomaly, AgentActivity, AgentStatus, LLMProvider } from "@finwatch/shared";
import { DataBuffer } from "./ingestion/data-buffer.js";
import { SourceRegistry } from "./ingestion/source-registry.js";
import { MonitorLoop } from "./analysis/monitor-loop.js";
import { withFallback } from "./providers/fallback.js";

export type OrchestratorConfig = {
  alpaca: {
    keyId: string;
    secretKey: string;
    symbols: string[];
    feed: "iex" | "sip";
  };
  llm: {
    providers: LLMProvider[];
    model: string;
    maxTokens: number;
    temperature: number;
  };
  buffer: {
    flushIntervalMs: number;
    urgentThreshold: number;
  };
};

export class Orchestrator extends EventEmitter {
  private readonly registry: SourceRegistry;
  private readonly buffer: DataBuffer;
  private readonly monitor: MonitorLoop;
  private running = false;

  constructor(config: OrchestratorConfig) {
    super();
    this.registry = new SourceRegistry();
    this.buffer = new DataBuffer({
      flushIntervalMs: config.buffer.flushIntervalMs,
      urgentThreshold: config.buffer.urgentThreshold,
    });

    const provider = config.llm.providers.length > 1
      ? withFallback(config.llm.providers)
      : config.llm.providers[0]!;

    this.monitor = new MonitorLoop(this.buffer, {
      provider,
      model: config.llm.model,
      maxTokens: config.llm.maxTokens,
      temperature: config.llm.temperature,
      preScreenConfig: { zScoreThreshold: 3.0, urgentThreshold: 0.6, skipThreshold: 0.2 },
      patterns: [],
      thresholds: [],
    });

    this.monitor.onActivity = (a: AgentActivity) => this.emit("activity", a);
    this.monitor.onAnomaly = (a: Anomaly) => this.emit("anomaly", a);
  }

  get status(): AgentStatus {
    return this.monitor.status;
  }

  /** Inject a tick directly (for testing or manual sources). */
  injectTick(tick: DataTick): void {
    this.buffer.push(tick);
    this.emit("tick", tick);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.registry.startAll();
    this.monitor.start();
    this.emit("activity", { type: "cycle_start", message: "Orchestrator started", timestamp: Date.now() });
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.monitor.stop();
    await this.registry.stopAll();
    this.buffer.destroy();
  }

  /** Expose registry for adding sources externally. */
  get sources(): SourceRegistry {
    return this.registry;
  }
}
