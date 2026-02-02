import { EventEmitter } from "node:events";
import type { DataTick } from "@finwatch/shared";

export type DataBufferOptions = {
  flushIntervalMs: number;
  urgentThreshold: number;
};

type PendingBatch = {
  resolve: (ticks: DataTick[]) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class DataBuffer extends EventEmitter {
  private ticks: DataTick[] = [];
  private pending: PendingBatch | null = null;
  private destroyed = false;
  private readonly flushIntervalMs: number;
  private readonly urgentThreshold: number;

  constructor(options: DataBufferOptions) {
    super();
    this.flushIntervalMs = options.flushIntervalMs;
    this.urgentThreshold = options.urgentThreshold;
  }

  get size(): number {
    return this.ticks.length;
  }

  push(tick: DataTick): void {
    if (this.destroyed) {
      throw new Error("Buffer destroyed");
    }
    this.ticks.push(tick);
  }

  pushUrgent(tick: DataTick, score: number): void {
    if (this.destroyed) {
      throw new Error("Buffer destroyed");
    }
    this.ticks.push(tick);

    if (score >= this.urgentThreshold && this.pending) {
      this.emit("urgent", { score, tick });
      this.flush();
    }
  }

  nextBatch(): Promise<DataTick[]> {
    if (this.destroyed) {
      return Promise.reject(new Error("Buffer destroyed"));
    }

    return new Promise<DataTick[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.flush();
      }, this.flushIntervalMs);

      // Allow timer to not prevent process exit in tests
      if (typeof timer === "object" && "unref" in timer) {
        timer.unref();
      }

      this.pending = { resolve, reject, timer };
    });
  }

  private flush(): void {
    if (!this.pending) return;

    const { resolve, timer } = this.pending;
    clearTimeout(timer);
    this.pending = null;

    const batch = [...this.ticks];
    this.ticks = [];

    this.emit("flush", batch);
    resolve(batch);
  }

  destroy(): void {
    this.destroyed = true;

    if (this.pending) {
      const { reject, timer } = this.pending;
      clearTimeout(timer);
      this.pending = null;
      reject(new Error("Buffer destroyed"));
    }

    this.ticks = [];
    this.removeAllListeners();
  }
}
