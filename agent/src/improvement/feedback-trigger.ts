export type FeedbackTriggerConfig = {
  countThreshold: number;
  timeoutMs: number;
  onTrigger: () => void;
};

export class FeedbackTrigger {
  private config: FeedbackTriggerConfig;
  private count = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private hasPending = false;

  constructor(config: FeedbackTriggerConfig) {
    this.config = config;
  }

  get pendingCount(): number {
    return this.count;
  }

  recordFeedback(): void {
    this.count++;
    this.hasPending = true;
    if (this.count >= this.config.countThreshold) {
      this.fire();
    }
  }

  start(): void {
    this.stop();
    this.timer = setInterval(() => {
      if (this.hasPending) {
        this.fire();
      }
    }, this.config.timeoutMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private fire(): void {
    this.count = 0;
    this.hasPending = false;
    this.config.onTrigger();
  }
}
