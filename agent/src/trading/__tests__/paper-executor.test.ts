import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TradeAction, TradeAuditEntry, FeedbackVerdict } from "@finwatch/shared";
import { PaperExecutor } from "../paper-executor.js";

const MOCK_ORDER_RESPONSE = {
  id: "order-001",
  symbol: "AAPL",
  qty: "10",
  side: "buy",
  type: "market",
  status: "filled",
  filled_avg_price: "185.50",
  filled_at: "2024-02-01T15:00:00Z",
};

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function makeMockFetch(orderResponse = MOCK_ORDER_RESPONSE): FetchFn {
  return vi.fn<[string, RequestInit?], Promise<Response>>().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => orderResponse,
  } as Response);
}

const originalFetch = globalThis.fetch;

function makeAction(overrides: Partial<TradeAction> = {}): TradeAction {
  return {
    symbol: "AAPL",
    side: "buy",
    qty: 10,
    type: "market",
    rationale: "Test trade",
    confidence: 0.85,
    anomalyId: "anomaly-001",
    ...overrides,
  };
}

describe("PaperExecutor", () => {
  beforeEach(() => {
    globalThis.fetch = makeMockFetch();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("submits order to Alpaca paper trading API", async () => {
    const mockFetch = makeMockFetch();
    globalThis.fetch = mockFetch;

    const executor = new PaperExecutor({
      keyId: "PAPER_KEY",
      secretKey: "PAPER_SECRET",
      baseUrl: "https://paper-api.alpaca.markets",
    });

    await executor.execute(makeAction());

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v2/orders");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.symbol).toBe("AAPL");
    expect(body.qty).toBe("10");
    expect(body.side).toBe("buy");
    expect(body.type).toBe("market");
    expect(body.time_in_force).toBe("day");
  });

  it("sends auth headers with order request", async () => {
    const mockFetch = makeMockFetch();
    globalThis.fetch = mockFetch;

    const executor = new PaperExecutor({
      keyId: "MY_KEY",
      secretKey: "MY_SECRET",
      baseUrl: "https://paper-api.alpaca.markets",
    });

    await executor.execute(makeAction());

    const headers = ((mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers["APCA-API-KEY-ID"]).toBe("MY_KEY");
    expect(headers["APCA-API-SECRET-KEY"]).toBe("MY_SECRET");
  });

  it("returns audit entry on successful execution", async () => {
    const executor = new PaperExecutor({
      keyId: "KEY",
      secretKey: "SECRET",
      baseUrl: "https://paper-api.alpaca.markets",
    });

    const action = makeAction();
    const audit = await executor.execute(action);

    expect(audit.action).toEqual(action);
    expect(audit.anomalyId).toBe("anomaly-001");
    expect(audit.outcome).toBe("pending");
    expect(audit.limitsChecked).toEqual([]);
    expect(audit.timestamp).toBeGreaterThan(0);
    expect(audit.id).toBeTruthy();
  });

  it("stores audit entries in history", async () => {
    const executor = new PaperExecutor({
      keyId: "KEY",
      secretKey: "SECRET",
      baseUrl: "https://paper-api.alpaca.markets",
    });

    await executor.execute(makeAction({ anomalyId: "a1" }));
    await executor.execute(makeAction({ anomalyId: "a2" }));

    const history = executor.getHistory();
    expect(history).toHaveLength(2);
    expect(history[0]!.anomalyId).toBe("a1");
    expect(history[1]!.anomalyId).toBe("a2");
  });

  it("emits onAudit callback on execution", async () => {
    const executor = new PaperExecutor({
      keyId: "KEY",
      secretKey: "SECRET",
      baseUrl: "https://paper-api.alpaca.markets",
    });

    const callback = vi.fn();
    executor.onAudit = callback;

    await executor.execute(makeAction());

    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0]![0]).toHaveProperty("anomalyId", "anomaly-001");
  });

  it("generates anomaly feedback from trade outcomes", async () => {
    const executor = new PaperExecutor({
      keyId: "KEY",
      secretKey: "SECRET",
      baseUrl: "https://paper-api.alpaca.markets",
    });

    const feedbacks: Array<{ anomalyId: string; verdict: FeedbackVerdict }> = [];
    executor.onFeedback = (anomalyId, verdict) => {
      feedbacks.push({ anomalyId, verdict });
    };

    await executor.execute(makeAction({ anomalyId: "a1" }));

    // Resolve trade as profitable
    executor.resolveOutcome(executor.getHistory()[0]!.id, "profit");

    expect(feedbacks).toHaveLength(1);
    expect(feedbacks[0]!.anomalyId).toBe("a1");
    expect(feedbacks[0]!.verdict).toBe("confirmed");
  });

  it("maps loss outcome to needs_review verdict", async () => {
    const executor = new PaperExecutor({
      keyId: "KEY",
      secretKey: "SECRET",
      baseUrl: "https://paper-api.alpaca.markets",
    });

    const feedbacks: Array<{ anomalyId: string; verdict: FeedbackVerdict }> = [];
    executor.onFeedback = (anomalyId, verdict) => {
      feedbacks.push({ anomalyId, verdict });
    };

    await executor.execute(makeAction({ anomalyId: "a2" }));
    executor.resolveOutcome(executor.getHistory()[0]!.id, "loss");

    expect(feedbacks[0]!.verdict).toBe("needs_review");
  });

  it("resolveOutcome updates audit entry outcome", async () => {
    const executor = new PaperExecutor({
      keyId: "KEY",
      secretKey: "SECRET",
      baseUrl: "https://paper-api.alpaca.markets",
    });

    await executor.execute(makeAction());
    const auditId = executor.getHistory()[0]!.id;

    executor.resolveOutcome(auditId, "profit");

    expect(executor.getHistory()[0]!.outcome).toBe("profit");
  });

  it("throws on Alpaca API error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "Insufficient buying power",
    } as Response);

    const executor = new PaperExecutor({
      keyId: "KEY",
      secretKey: "SECRET",
      baseUrl: "https://paper-api.alpaca.markets",
    });

    await expect(executor.execute(makeAction())).rejects.toThrow("422");
  });

  it("tracks trade count", async () => {
    const executor = new PaperExecutor({
      keyId: "KEY",
      secretKey: "SECRET",
      baseUrl: "https://paper-api.alpaca.markets",
    });

    expect(executor.tradeCount).toBe(0);
    await executor.execute(makeAction());
    expect(executor.tradeCount).toBe(1);
    await executor.execute(makeAction());
    expect(executor.tradeCount).toBe(2);
  });
});
