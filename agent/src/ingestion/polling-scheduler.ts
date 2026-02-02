import { EventEmitter } from "node:events";
import type { DataTick } from "@finwatch/shared";
import type { DataSource } from "./types.js";

export type PollingSchedulerOptions = {
  defaultIntervalMs?: number;
  maxBackoffMs?: number;
  backoffMultiplier?: number;
};

type ScheduledSource = {
  source: DataSource;
  baseIntervalMs: number;
  currentBackoff: number;
  timer: ReturnType<typeof setTimeout> | null;
};

const DEFAULT_INTERVAL_MS = 60000;
const DEFAULT_MAX_BACKOFF_MS = 300000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;

export class PollingScheduler extends EventEmitter {
  private scheduled = new Map<string, ScheduledSource>();
  private defaultIntervalMs: number;
  private maxBackoffMs: number;
  private backoffMultiplier: number;

  constructor(options: PollingSchedulerOptions = {}) {
    super();
    this.defaultIntervalMs = options.defaultIntervalMs ?? DEFAULT_INTERVAL_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.backoffMultiplier = options.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER;
  }

  schedule(source: DataSource): void {
    const baseIntervalMs =
      source.config.pollIntervalMs ?? this.defaultIntervalMs;

    const entry: ScheduledSource = {
      source,
      baseIntervalMs,
      currentBackoff: 0,
      timer: null,
    };

    this.scheduled.set(source.id, entry);
    this.scheduleNext(entry);
  }

  unschedule(sourceId: string): void {
    const entry = this.scheduled.get(sourceId);
    if (entry?.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    this.scheduled.delete(sourceId);
  }

  stopAll(): void {
    for (const entry of this.scheduled.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
    }
    this.scheduled.clear();
  }

  private scheduleNext(entry: ScheduledSource): void {
    const delay =
      entry.currentBackoff > 0
        ? Math.min(
            entry.baseIntervalMs * Math.pow(this.backoffMultiplier, entry.currentBackoff),
            this.maxBackoffMs
          )
        : entry.baseIntervalMs;

    entry.timer = setTimeout(() => {
      void this.poll(entry);
    }, delay);

    // Don't block process exit
    if (typeof entry.timer === "object" && "unref" in entry.timer) {
      entry.timer.unref();
    }
  }

  private async poll(entry: ScheduledSource): Promise<void> {
    // Check if still scheduled (may have been unscheduled during timeout)
    if (!this.scheduled.has(entry.source.id)) return;

    try {
      const ticks: DataTick[] = await entry.source.fetch();

      // Reset backoff on success
      entry.currentBackoff = 0;

      if (ticks.length > 0) {
        this.emit("ticks", ticks, entry.source.id);
      }
    } catch (err) {
      entry.currentBackoff++;
      if (this.listenerCount("error") > 0) {
        this.emit(
          "error",
          err instanceof Error ? err : new Error(String(err)),
          entry.source.id
        );
      }
    }

    // Schedule next poll if still registered
    if (this.scheduled.has(entry.source.id)) {
      this.scheduleNext(entry);
    }
  }
}
