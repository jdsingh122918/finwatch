import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FeedbackTrigger, type FeedbackTriggerConfig } from "../feedback-trigger.js";

describe("FeedbackTrigger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("triggers after reaching count threshold", () => {
    const onTrigger = vi.fn();
    const trigger = new FeedbackTrigger({
      countThreshold: 3,
      timeoutMs: 7200000,
      onTrigger,
    });

    trigger.recordFeedback();
    trigger.recordFeedback();
    expect(onTrigger).not.toHaveBeenCalled();

    trigger.recordFeedback();
    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it("triggers after timeout even with fewer feedbacks", () => {
    const onTrigger = vi.fn();
    const trigger = new FeedbackTrigger({
      countThreshold: 10,
      timeoutMs: 7200000,
      onTrigger,
    });

    trigger.recordFeedback();
    trigger.start();

    vi.advanceTimersByTime(7200000);
    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it("does not trigger timeout if no feedbacks recorded", () => {
    const onTrigger = vi.fn();
    const trigger = new FeedbackTrigger({
      countThreshold: 10,
      timeoutMs: 7200000,
      onTrigger,
    });

    trigger.start();
    vi.advanceTimersByTime(7200000);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("resets count after trigger", () => {
    const onTrigger = vi.fn();
    const trigger = new FeedbackTrigger({
      countThreshold: 2,
      timeoutMs: 7200000,
      onTrigger,
    });

    trigger.recordFeedback();
    trigger.recordFeedback();
    expect(onTrigger).toHaveBeenCalledOnce();

    trigger.recordFeedback();
    expect(onTrigger).toHaveBeenCalledOnce();

    trigger.recordFeedback();
    expect(onTrigger).toHaveBeenCalledTimes(2);
  });

  it("can be stopped", () => {
    const onTrigger = vi.fn();
    const trigger = new FeedbackTrigger({
      countThreshold: 10,
      timeoutMs: 7200000,
      onTrigger,
    });

    trigger.recordFeedback();
    trigger.start();
    trigger.stop();

    vi.advanceTimersByTime(7200000);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("reports pending count", () => {
    const trigger = new FeedbackTrigger({
      countThreshold: 10,
      timeoutMs: 7200000,
      onTrigger: vi.fn(),
    });

    trigger.recordFeedback();
    trigger.recordFeedback();
    expect(trigger.pendingCount).toBe(2);
  });
});
