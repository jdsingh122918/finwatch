import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TradeAction, TradeSuggestion } from "@finwatch/shared";
import { LiveSuggester } from "../live-suggester.js";

function makeAction(overrides: Partial<TradeAction> = {}): TradeAction {
  return {
    symbol: "AAPL",
    side: "buy",
    qty: 10,
    type: "market",
    rationale: "Anomaly detected",
    confidence: 0.85,
    anomalyId: "anomaly-001",
    ...overrides,
  };
}

describe("LiveSuggester", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("creates a pending suggestion from a trade action", () => {
    const suggester = new LiveSuggester({ expirationMs: 300000 });
    const suggestion = suggester.suggest(makeAction());

    expect(suggestion.id).toBeTruthy();
    expect(suggestion.action).toEqual(makeAction());
    expect(suggestion.status).toBe("pending");
    expect(suggestion.expiresAt).toBeGreaterThan(Date.now());
  });

  it("sets expiration based on configured timeout", () => {
    const now = Date.now();
    const suggester = new LiveSuggester({ expirationMs: 600000 }); // 10 min
    const suggestion = suggester.suggest(makeAction());

    expect(suggestion.expiresAt).toBe(now + 600000);
  });

  it("emits onSuggestion callback", () => {
    const callback = vi.fn();
    const suggester = new LiveSuggester({ expirationMs: 300000 });
    suggester.onSuggestion = callback;

    const suggestion = suggester.suggest(makeAction());

    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0]![0]).toEqual(suggestion);
  });

  it("getPending returns only pending suggestions", () => {
    const suggester = new LiveSuggester({ expirationMs: 300000 });
    suggester.suggest(makeAction({ anomalyId: "a1" }));
    suggester.suggest(makeAction({ anomalyId: "a2" }));

    const pending = suggester.getPending();
    expect(pending).toHaveLength(2);
    expect(pending.every((s) => s.status === "pending")).toBe(true);
  });

  it("approve changes status and emits onApproved", () => {
    const approvedCallback = vi.fn();
    const suggester = new LiveSuggester({ expirationMs: 300000 });
    suggester.onApproved = approvedCallback;

    const suggestion = suggester.suggest(makeAction());
    const result = suggester.approve(suggestion.id);

    expect(result).toBe(true);
    expect(suggester.getPending()).toHaveLength(0);
    expect(approvedCallback).toHaveBeenCalledOnce();
    expect(approvedCallback.mock.calls[0]![0].status).toBe("approved");
  });

  it("dismiss changes status and emits onDismissed", () => {
    const dismissedCallback = vi.fn();
    const suggester = new LiveSuggester({ expirationMs: 300000 });
    suggester.onDismissed = dismissedCallback;

    const suggestion = suggester.suggest(makeAction());
    const result = suggester.dismiss(suggestion.id);

    expect(result).toBe(true);
    expect(suggester.getPending()).toHaveLength(0);
    expect(dismissedCallback).toHaveBeenCalledOnce();
    expect(dismissedCallback.mock.calls[0]![0].status).toBe("dismissed");
  });

  it("approve returns false for non-existent suggestion", () => {
    const suggester = new LiveSuggester({ expirationMs: 300000 });
    expect(suggester.approve("nonexistent")).toBe(false);
  });

  it("dismiss returns false for non-existent suggestion", () => {
    const suggester = new LiveSuggester({ expirationMs: 300000 });
    expect(suggester.dismiss("nonexistent")).toBe(false);
  });

  it("cannot approve an already dismissed suggestion", () => {
    const suggester = new LiveSuggester({ expirationMs: 300000 });
    const suggestion = suggester.suggest(makeAction());
    suggester.dismiss(suggestion.id);

    expect(suggester.approve(suggestion.id)).toBe(false);
  });

  it("expireStale marks expired suggestions and emits onExpired", () => {
    const expiredCallback = vi.fn();
    const suggester = new LiveSuggester({ expirationMs: 300000 });
    suggester.onExpired = expiredCallback;

    suggester.suggest(makeAction({ anomalyId: "a1" }));

    // Advance past expiration
    vi.advanceTimersByTime(300001);

    const expired = suggester.expireStale();
    expect(expired).toBe(1);
    expect(suggester.getPending()).toHaveLength(0);
    expect(expiredCallback).toHaveBeenCalledOnce();
    expect(expiredCallback.mock.calls[0]![0].status).toBe("expired");
  });

  it("expireStale does not expire non-stale suggestions", () => {
    const suggester = new LiveSuggester({ expirationMs: 300000 });
    suggester.suggest(makeAction());

    vi.advanceTimersByTime(100000); // only 100s of 300s

    expect(suggester.expireStale()).toBe(0);
    expect(suggester.getPending()).toHaveLength(1);
  });

  it("getAll returns all suggestions regardless of status", () => {
    const suggester = new LiveSuggester({ expirationMs: 300000 });

    const s1 = suggester.suggest(makeAction({ anomalyId: "a1" }));
    suggester.suggest(makeAction({ anomalyId: "a2" }));
    suggester.approve(s1.id);

    const all = suggester.getAll();
    expect(all).toHaveLength(2);
    expect(all.find((s) => s.id === s1.id)!.status).toBe("approved");
  });
});
