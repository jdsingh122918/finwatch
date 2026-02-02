import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import type { AnomalyFeedback } from "@finwatch/shared";
import { FeedbackStore } from "../feedback-store.js";

let db: Database.Database;
let store: FeedbackStore;

beforeEach(() => {
  db = new Database(":memory:");
  store = new FeedbackStore(db);
});

afterEach(() => {
  db.close();
});

function makeFeedback(anomalyId: string, verdict: "confirmed" | "false_positive" | "needs_review" = "confirmed"): AnomalyFeedback {
  return { anomalyId, verdict, timestamp: Date.now() };
}

describe("FeedbackStore", () => {
  it("inserts and retrieves feedback", () => {
    store.insert(makeFeedback("a1", "confirmed"));
    store.insert(makeFeedback("a2", "false_positive"));

    const all = store.getAll();
    expect(all).toHaveLength(2);
  });

  it("queries unprocessed feedback", () => {
    store.insert(makeFeedback("a1"));
    store.insert(makeFeedback("a2"));
    store.insert(makeFeedback("a3"));

    const unprocessed = store.getUnprocessed();
    expect(unprocessed).toHaveLength(3);

    store.markProcessed(["a1", "a2"]);

    const remaining = store.getUnprocessed();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.anomalyId).toBe("a3");
  });

  it("counts unprocessed feedback", () => {
    store.insert(makeFeedback("a1"));
    store.insert(makeFeedback("a2"));
    expect(store.unprocessedCount()).toBe(2);

    store.markProcessed(["a1"]);
    expect(store.unprocessedCount()).toBe(1);
  });

  it("queries feedback by verdict", () => {
    store.insert(makeFeedback("a1", "confirmed"));
    store.insert(makeFeedback("a2", "false_positive"));
    store.insert(makeFeedback("a3", "false_positive"));

    const fps = store.getByVerdict("false_positive");
    expect(fps).toHaveLength(2);
  });

  it("computes false positive rate", () => {
    store.insert(makeFeedback("a1", "confirmed"));
    store.insert(makeFeedback("a2", "confirmed"));
    store.insert(makeFeedback("a3", "false_positive"));
    store.insert(makeFeedback("a4", "false_positive"));

    expect(store.falsePositiveRate()).toBeCloseTo(0.5);
  });

  it("returns 0 FP rate when no feedback exists", () => {
    expect(store.falsePositiveRate()).toBe(0);
  });

  it("computes FP rate for a time window", () => {
    const old = { anomalyId: "old", verdict: "false_positive" as const, timestamp: Date.now() - 86400000 * 2 };
    const recent = makeFeedback("recent", "confirmed");

    store.insert(old);
    store.insert(recent);

    // Last 24 hours: only "recent" (confirmed), FP rate = 0
    const rate = store.falsePositiveRate(86400000);
    expect(rate).toBe(0);
  });

  it("stores optional note", () => {
    store.insert({ anomalyId: "a1", verdict: "false_positive", note: "This was a scheduled event", timestamp: Date.now() });
    const all = store.getAll();
    expect(all[0]!.note).toBe("This was a scheduled event");
  });
});
