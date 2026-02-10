import type {
  LLMProvider,
  Anomaly,
  AgentState,
  AgentStatus,
  AgentActivity,
  DomainPattern,
  DomainThreshold,
} from "@finwatch/shared";
import type { DataBuffer } from "../ingestion/data-buffer.js";
import { CycleRunner } from "./cycle-runner.js";
import type { PreScreenConfig } from "./pre-screener.js";

export type MonitorLoopDeps = {
  provider: LLMProvider;
  model: string;
  maxTokens: number;
  temperature: number;
  preScreenConfig: PreScreenConfig;
  patterns: DomainPattern[];
  thresholds: DomainThreshold[];
  memoryContext?: (tickSummary: string) => string;
};

export class MonitorLoop {
  private readonly buffer: DataBuffer;
  private readonly deps: MonitorLoopDeps;

  private _state: AgentState = "idle";
  private _totalCycles = 0;
  private _totalAnomalies = 0;
  private _startedAt = 0;
  private _lastError?: string;
  private _currentSessionId?: string;
  private _currentCycleId?: string;
  private _running = false;
  private _sessionSeq = 0;

  onActivity?: (activity: AgentActivity) => void;
  onAnomaly?: (anomaly: Anomaly) => void;

  constructor(buffer: DataBuffer, deps: MonitorLoopDeps) {
    this.buffer = buffer;
    this.deps = deps;
  }

  get status(): AgentStatus {
    return {
      state: this._state,
      currentSessionId: this._currentSessionId,
      currentCycleId: this._currentCycleId,
      totalCycles: this._totalCycles,
      totalAnomalies: this._totalAnomalies,
      uptime: this._state === "running" ? Date.now() - this._startedAt : 0,
      lastError: this._lastError,
    };
  }

  start(): void {
    if (this._state === "running") {
      throw new Error("Monitor loop already running");
    }

    this._state = "running";
    this._startedAt = Date.now();
    this._running = true;
    this._currentSessionId = `monitor-${++this._sessionSeq}-${Date.now()}`;

    this.loop();
  }

  stop(): void {
    this._running = false;
    this._state = "idle";
    this._currentCycleId = undefined;
  }

  private loop(): void {
    if (!this._running) return;

    this.buffer
      .nextBatch()
      .then((ticks) => this.runCycle(ticks))
      .then(() => {
        // Schedule the next iteration via microtask to avoid stack overflow
        if (this._running) {
          this.loop();
        }
      })
      .catch((err: unknown) => {
        // Buffer destroyed or other fatal error — stop gracefully
        if (!this._running) return;

        const message =
          err instanceof Error ? err.message : String(err);

        // Only set error state for non-buffer-destruction errors
        if (message !== "Buffer destroyed") {
          this._lastError = message;
          this._state = "error";
          this.emitActivity("error", message);
        }
      });
  }

  private async runCycle(ticks: import("@finwatch/shared").DataTick[]): Promise<void> {
    if (!this._running) return;

    const runner = new CycleRunner({
      provider: this.deps.provider,
      model: this.deps.model,
      maxTokens: this.deps.maxTokens,
      temperature: this.deps.temperature,
      preScreenConfig: this.deps.preScreenConfig,
      sessionId: this._currentSessionId!,
      patterns: this.deps.patterns,
      thresholds: this.deps.thresholds,
      memoryContext: this.deps.memoryContext,
    });

    this._currentCycleId = runner.state.cycleId;

    this.emitActivity(
      "cycle_start",
      `Cycle started with ${ticks.length} tick(s)`,
      { tickCount: ticks.length, cycleId: runner.state.cycleId },
    );

    try {
      runner.onAnomaly = (anomaly) => {
        this._totalAnomalies++;
        this.onAnomaly?.(anomaly);
        this.emitActivity("anomaly_detected", anomaly.description, {
          anomalyId: anomaly.id,
          severity: anomaly.severity,
        });
      };

      const result = await runner.run(ticks);
      this._totalCycles++;

      this.emitActivity(
        "cycle_end",
        `Cycle complete: ${result.anomalies.length} anomaly(ies) from ${result.tickCount} tick(s)`,
        {
          cycleId: runner.state.cycleId,
          anomalyCount: result.anomalies.length,
          tickCount: result.tickCount,
        },
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this._lastError = message;
      this._totalCycles++;
      this.emitActivity("error", `Cycle failed: ${message}`, {
        cycleId: runner.state.cycleId,
      });
    }
  }

  private emitActivity(
    type: AgentActivity["type"],
    message: string,
    data?: Record<string, unknown>,
  ): void {
    this.onActivity?.({
      type,
      message,
      timestamp: Date.now(),
      data,
    });
  }
}
