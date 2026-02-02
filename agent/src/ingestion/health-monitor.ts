import { EventEmitter } from "node:events";
import type { SourceHealth } from "@finwatch/shared";
import type { SourceRegistry } from "./source-registry.js";

export type HealthMonitorOptions = {
  checkIntervalMs: number;
};

export class HealthMonitor extends EventEmitter {
  private registry: SourceRegistry;
  private checkIntervalMs: number;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private lastStatus = new Map<string, SourceHealth>();
  private started = false;

  constructor(registry: SourceRegistry, options: HealthMonitorOptions) {
    super();
    this.registry = registry;
    this.checkIntervalMs = options.checkIntervalMs;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.intervalHandle = setInterval(() => {
      this.checkAll().catch(() => {
        // Swallow errors from the periodic check itself
      });
    }, this.checkIntervalMs);

    // Don't block process exit
    if (typeof this.intervalHandle === "object" && "unref" in this.intervalHandle) {
      this.intervalHandle.unref();
    }
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  getHealth(): Map<string, SourceHealth> {
    return new Map(this.lastStatus);
  }

  private async checkAll(): Promise<void> {
    const sources = this.registry.list();

    const checks = sources.map(async (source) => {
      let health: SourceHealth;

      try {
        health = await source.healthCheck();
      } catch (err) {
        health = {
          sourceId: source.id,
          status: "offline",
          lastSuccess: 0,
          failCount: 0,
          latencyMs: -1,
          message: err instanceof Error ? err.message : "Unknown error",
        };
      }

      const previous = this.lastStatus.get(source.id);
      this.lastStatus.set(source.id, health);

      // Emit on status change
      if (!previous || previous.status !== health.status) {
        this.emit("health-change", health);

        if (health.status === "offline") {
          this.emit("offline", source.id);
        } else if (health.status === "degraded") {
          this.emit("degraded", source.id);
        } else if (
          health.status === "healthy" &&
          previous &&
          previous.status !== "healthy"
        ) {
          this.emit("recovered", source.id);
        }
      }
    });

    await Promise.all(checks);
  }
}
