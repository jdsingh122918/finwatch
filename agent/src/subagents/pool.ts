import type { InvestigationResult } from "./spawner.js";

export type PoolConfig = {
  maxConcurrent: number;
  timeoutMs: number;
};

type QueuedTask = {
  anomalyId: string;
  investigate: (id: string) => Promise<InvestigationResult>;
  resolve: (result: InvestigationResult) => void;
  reject: (error: Error) => void;
};

export class SubagentPool {
  private readonly config: PoolConfig;
  private _active = 0;
  private _completed = 0;
  private readonly queue: QueuedTask[] = [];

  constructor(config: PoolConfig) {
    this.config = config;
  }

  get activeCount(): number {
    return this._active;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  get completedCount(): number {
    return this._completed;
  }

  submit(
    anomalyId: string,
    investigate: (id: string) => Promise<InvestigationResult>,
  ): Promise<InvestigationResult> {
    return new Promise<InvestigationResult>((resolve, reject) => {
      const task: QueuedTask = { anomalyId, investigate, resolve, reject };

      if (this._active < this.config.maxConcurrent) {
        this.execute(task);
      } else {
        this.queue.push(task);
      }
    });
  }

  private execute(task: QueuedTask): void {
    this._active++;
    let settled = false;

    const finish = (err: Error | null, result?: InvestigationResult): void => {
      if (settled) return;
      settled = true;
      this._active--;
      this._completed++;
      if (err) {
        task.reject(err);
      } else {
        task.resolve(result!);
      }
      this.drain();
    };

    const timer = setTimeout(() => {
      finish(
        new Error(
          `Investigation of ${task.anomalyId} timed out after ${this.config.timeoutMs}ms`,
        ),
      );
    }, this.config.timeoutMs);

    if (typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }

    task
      .investigate(task.anomalyId)
      .then(
        (result) => {
          clearTimeout(timer);
          finish(null, result);
        },
        (err: unknown) => {
          clearTimeout(timer);
          finish(err instanceof Error ? err : new Error(String(err)));
        },
      );
  }

  private drain(): void {
    while (this._active < this.config.maxConcurrent && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.execute(next);
    }
  }
}
