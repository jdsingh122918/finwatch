import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PortfolioPosition } from "@finwatch/shared";
import { PositionTracker } from "../position-tracker.js";
import type { PositionLookup } from "../trade-generator.js";

const MOCK_POSITIONS_RESPONSE = [
  {
    symbol: "AAPL",
    qty: "100",
    avg_entry_price: "180.50",
    current_price: "185.00",
    unrealized_pl: "450.00",
  },
  {
    symbol: "TSLA",
    qty: "50",
    avg_entry_price: "200.00",
    current_price: "195.00",
    unrealized_pl: "-250.00",
  },
];

const MOCK_ACCOUNT_RESPONSE = {
  equity: "52000.00",
  buying_power: "48000.00",
  cash: "40000.00",
};

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function makeMockFetch(positions = MOCK_POSITIONS_RESPONSE): FetchFn {
  return vi.fn<[string, RequestInit?], Promise<Response>>().mockImplementation(
    async (url: string) => {
      if (url.includes("/positions")) {
        return {
          ok: true,
          status: 200,
          json: async () => positions,
        } as Response;
      }
      if (url.includes("/account")) {
        return {
          ok: true,
          status: 200,
          json: async () => MOCK_ACCOUNT_RESPONSE,
        } as Response;
      }
      return { ok: false, status: 404, text: async () => "Not found" } as Response;
    },
  );
}

const originalFetch = globalThis.fetch;

describe("PositionTracker", () => {
  beforeEach(() => {
    globalThis.fetch = makeMockFetch();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches and parses positions from Alpaca API", async () => {
    const tracker = new PositionTracker({
      keyId: "KEY",
      secretKey: "SECRET",
      baseUrl: "https://paper-api.alpaca.markets",
    });

    await tracker.sync();
    const positions = tracker.getPositions();

    expect(positions).toHaveLength(2);
    expect(positions[0]).toEqual({
      symbol: "AAPL",
      qty: 100,
      avgEntry: 180.50,
      currentPrice: 185.00,
      unrealizedPnl: 450.00,
    });
    expect(positions[1]).toEqual({
      symbol: "TSLA",
      qty: 50,
      avgEntry: 200.00,
      currentPrice: 195.00,
      unrealizedPnl: -250.00,
    });
  });

  it("calls positions endpoint with auth headers", async () => {
    const mockFetch = makeMockFetch();
    globalThis.fetch = mockFetch;

    const tracker = new PositionTracker({
      keyId: "MY_KEY",
      secretKey: "MY_SECRET",
      baseUrl: "https://paper-api.alpaca.markets",
    });

    await tracker.sync();

    const calls = (mockFetch as ReturnType<typeof vi.fn>).mock.calls;
    const positionCall = calls.find(
      (c) => (c[0] as string).includes("/positions"),
    );
    expect(positionCall).toBeDefined();
    const headers = (positionCall![1] as RequestInit).headers as Record<string, string>;
    expect(headers["APCA-API-KEY-ID"]).toBe("MY_KEY");
    expect(headers["APCA-API-SECRET-KEY"]).toBe("MY_SECRET");
  });

  it("implements PositionLookup interface", async () => {
    const tracker = new PositionTracker({
      keyId: "KEY",
      secretKey: "SECRET",
      baseUrl: "https://paper-api.alpaca.markets",
    });

    await tracker.sync();
    const lookup: PositionLookup = tracker;

    expect(lookup.hasPosition("AAPL")).toBe(true);
    expect(lookup.hasPosition("TSLA")).toBe(true);
    expect(lookup.hasPosition("GOOG")).toBe(false);

    expect(lookup.getQty("AAPL")).toBe(100);
    expect(lookup.getQty("TSLA")).toBe(50);
    expect(lookup.getQty("GOOG")).toBe(0);
  });

  it("returns empty positions before first sync", () => {
    const tracker = new PositionTracker({
      keyId: "KEY",
      secretKey: "SECRET",
      baseUrl: "https://paper-api.alpaca.markets",
    });

    expect(tracker.getPositions()).toHaveLength(0);
    expect(tracker.hasPosition("AAPL")).toBe(false);
    expect(tracker.getQty("AAPL")).toBe(0);
  });

  it("updates positions on subsequent sync", async () => {
    const tracker = new PositionTracker({
      keyId: "KEY",
      secretKey: "SECRET",
      baseUrl: "https://paper-api.alpaca.markets",
    });

    await tracker.sync();
    expect(tracker.getPositions()).toHaveLength(2);

    // Now API returns only one position
    globalThis.fetch = makeMockFetch([MOCK_POSITIONS_RESPONSE[0]!]);
    await tracker.sync();
    expect(tracker.getPositions()).toHaveLength(1);
    expect(tracker.hasPosition("TSLA")).toBe(false);
  });

  it("emits onChange callback when positions change", async () => {
    const tracker = new PositionTracker({
      keyId: "KEY",
      secretKey: "SECRET",
      baseUrl: "https://paper-api.alpaca.markets",
    });

    const callback = vi.fn();
    tracker.onChange = callback;

    await tracker.sync();
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0]![0]).toHaveLength(2);
  });

  it("getPosition returns single position by symbol", async () => {
    const tracker = new PositionTracker({
      keyId: "KEY",
      secretKey: "SECRET",
      baseUrl: "https://paper-api.alpaca.markets",
    });

    await tracker.sync();

    const aapl = tracker.getPosition("AAPL");
    expect(aapl).toBeDefined();
    expect(aapl!.qty).toBe(100);

    const goog = tracker.getPosition("GOOG");
    expect(goog).toBeUndefined();
  });

  it("throws on API error during sync", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    } as Response);

    const tracker = new PositionTracker({
      keyId: "BAD",
      secretKey: "BAD",
      baseUrl: "https://paper-api.alpaca.markets",
    });

    await expect(tracker.sync()).rejects.toThrow();
  });

  it("totalExposure sums absolute position values", async () => {
    const tracker = new PositionTracker({
      keyId: "KEY",
      secretKey: "SECRET",
      baseUrl: "https://paper-api.alpaca.markets",
    });

    await tracker.sync();
    // AAPL: 100 * 185 = 18500, TSLA: 50 * 195 = 9750
    expect(tracker.totalExposure()).toBe(18500 + 9750);
  });
});
