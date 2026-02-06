import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AlpacaBackfill } from "../alpaca-backfill.js";

// Mock REST response matching Alpaca getBarsV2 shape
const MOCK_BARS = [
  { t: "2024-01-02T05:00:00Z", o: 185.0, h: 186.5, l: 184.0, c: 185.5, v: 45000000 },
  { t: "2024-01-03T05:00:00Z", o: 185.5, h: 187.0, l: 185.0, c: 186.8, v: 42000000 },
  { t: "2024-01-04T05:00:00Z", o: 186.8, h: 188.0, l: 186.0, c: 187.5, v: 38000000 },
];

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function makeMockFetch(bars = MOCK_BARS, nextPageToken?: string): FetchFn {
  return vi.fn<[string, RequestInit?], Promise<Response>>().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      bars,
      next_page_token: nextPageToken ?? null,
    }),
  } as Response);
}

const originalFetch = globalThis.fetch;

describe("AlpacaBackfill", () => {
  beforeEach(() => {
    globalThis.fetch = makeMockFetch();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches historical bars for a symbol", async () => {
    const backfill = new AlpacaBackfill({
      sourceId: "alpaca-stream",
      keyId: "PKTEST",
      secretKey: "secret",
      baseUrl: "https://data.alpaca.markets",
    });

    const ticks = await backfill.fetchBars("AAPL", 30);

    expect(ticks).toHaveLength(3);
    expect(ticks[0]!.sourceId).toBe("alpaca-stream");
    expect(ticks[0]!.symbol).toBe("AAPL");
    expect(ticks[0]!.metrics).toEqual({
      open: 185.0,
      high: 186.5,
      low: 184.0,
      close: 185.5,
      volume: 45000000,
    });
  });

  it("parses timestamps correctly", async () => {
    const backfill = new AlpacaBackfill({
      sourceId: "alpaca-stream",
      keyId: "PKTEST",
      secretKey: "secret",
      baseUrl: "https://data.alpaca.markets",
    });

    const ticks = await backfill.fetchBars("AAPL", 30);
    expect(ticks[0]!.timestamp).toBe(new Date("2024-01-02T05:00:00Z").getTime());
  });

  it("calls correct API endpoint with auth headers", async () => {
    const mockFetch = makeMockFetch();
    globalThis.fetch = mockFetch;

    const backfill = new AlpacaBackfill({
      sourceId: "alpaca-stream",
      keyId: "MY_KEY",
      secretKey: "MY_SECRET",
      baseUrl: "https://data.alpaca.markets",
    });

    await backfill.fetchBars("AAPL", 30);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/v2/stocks/AAPL/bars");
    expect(url).toContain("timeframe=1Day");
    expect(init.headers).toEqual(
      expect.objectContaining({
        "APCA-API-KEY-ID": "MY_KEY",
        "APCA-API-SECRET-KEY": "MY_SECRET",
      }),
    );
  });

  it("uses correct date range based on days parameter", async () => {
    const mockFetch = makeMockFetch();
    globalThis.fetch = mockFetch;

    const backfill = new AlpacaBackfill({
      sourceId: "alpaca-stream",
      keyId: "KEY",
      secretKey: "SECRET",
      baseUrl: "https://data.alpaca.markets",
    });

    await backfill.fetchBars("TSLA", 7);

    const url = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(url).toContain("start=");
    // The start date should be roughly 7 days ago
    const startParam = new URL(url).searchParams.get("start");
    expect(startParam).toBeTruthy();
  });

  it("fetches bars for multiple symbols", async () => {
    const backfill = new AlpacaBackfill({
      sourceId: "alpaca-stream",
      keyId: "KEY",
      secretKey: "SECRET",
      baseUrl: "https://data.alpaca.markets",
    });

    const ticks = await backfill.fetchAllSymbols(["AAPL", "TSLA"], 30);

    expect(ticks.length).toBe(6); // 3 bars per symbol
    const symbols = new Set(ticks.map((t) => t.symbol));
    expect(symbols).toEqual(new Set(["AAPL", "TSLA"]));
  });

  it("includes backfill metadata", async () => {
    const backfill = new AlpacaBackfill({
      sourceId: "alpaca-stream",
      keyId: "KEY",
      secretKey: "SECRET",
      baseUrl: "https://data.alpaca.markets",
    });

    const ticks = await backfill.fetchBars("AAPL", 30);
    expect(ticks[0]!.metadata).toEqual(
      expect.objectContaining({ alpacaType: "bar", backfill: true }),
    );
  });

  it("throws on API error", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    } as Response);

    const backfill = new AlpacaBackfill({
      sourceId: "alpaca-stream",
      keyId: "BAD_KEY",
      secretKey: "BAD_SECRET",
      baseUrl: "https://data.alpaca.markets",
    });

    await expect(backfill.fetchBars("AAPL", 30)).rejects.toThrow();
  });

  it("returns partial results when one symbol fails in fetchAllSymbols", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn<[string, RequestInit?], Promise<Response>>().mockImplementation(async (url: string) => {
      callCount++;
      if (url.includes("/BADTICKER/")) {
        return { ok: false, status: 404, text: async () => "Not Found" } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ bars: MOCK_BARS, next_page_token: null }),
      } as Response;
    });

    const backfill = new AlpacaBackfill({
      sourceId: "alpaca-stream",
      keyId: "KEY",
      secretKey: "SECRET",
      baseUrl: "https://data.alpaca.markets",
    });

    const ticks = await backfill.fetchAllSymbols(["AAPL", "BADTICKER", "TSLA"], 30);

    // BADTICKER should be skipped; AAPL + TSLA each return 3 bars
    expect(ticks).toHaveLength(6);
    const symbols = new Set(ticks.map((t) => t.symbol));
    expect(symbols).toEqual(new Set(["AAPL", "TSLA"]));
  });

  it("returns empty array when no bars returned", async () => {
    globalThis.fetch = makeMockFetch([]);

    const backfill = new AlpacaBackfill({
      sourceId: "alpaca-stream",
      keyId: "KEY",
      secretKey: "SECRET",
      baseUrl: "https://data.alpaca.markets",
    });

    const ticks = await backfill.fetchBars("XYZ", 30);
    expect(ticks).toHaveLength(0);
  });

  describe("fetchDateRange", () => {
    it("constructs correct URL with start/end/timeframe params", async () => {
      const mockFetch = makeMockFetch();
      globalThis.fetch = mockFetch;

      const backfill = new AlpacaBackfill({
        sourceId: "alpaca-stream",
        keyId: "MY_KEY",
        secretKey: "MY_SECRET",
        baseUrl: "https://data.alpaca.markets",
      });

      await backfill.fetchDateRange("AAPL", "2024-01-01", "2024-06-30", "1Day");

      expect(mockFetch).toHaveBeenCalled();
      const [url] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
      expect(url).toContain("/v2/stocks/AAPL/bars");
      const parsed = new URL(url);
      expect(parsed.searchParams.get("start")).toBe("2024-01-01T00:00:00.000Z");
      expect(parsed.searchParams.get("end")).toBe("2024-06-30T00:00:00.000Z");
      expect(parsed.searchParams.get("timeframe")).toBe("1Day");
      expect(parsed.searchParams.get("limit")).toBe("10000");
    });

    it("handles pagination via next_page_token", async () => {
      const page1Bars = [MOCK_BARS[0]!];
      const page2Bars = [MOCK_BARS[1]!, MOCK_BARS[2]!];
      let callNum = 0;

      globalThis.fetch = vi.fn<[string, RequestInit?], Promise<Response>>().mockImplementation(async (url: string) => {
        callNum++;
        if (callNum === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ bars: page1Bars, next_page_token: "TOKEN_ABC" }),
          } as Response;
        }
        // Second call should include page_token param
        expect(url).toContain("page_token=TOKEN_ABC");
        return {
          ok: true,
          status: 200,
          json: async () => ({ bars: page2Bars, next_page_token: null }),
        } as Response;
      });

      const backfill = new AlpacaBackfill({
        sourceId: "alpaca-stream",
        keyId: "KEY",
        secretKey: "SECRET",
        baseUrl: "https://data.alpaca.markets",
      });

      const ticks = await backfill.fetchDateRange("AAPL", "2024-01-01", "2024-06-30", "1Day");

      expect(ticks).toHaveLength(3);
      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    });

    it("returns DataTick[] with correct fields", async () => {
      const backfill = new AlpacaBackfill({
        sourceId: "bt-source",
        keyId: "KEY",
        secretKey: "SECRET",
        baseUrl: "https://data.alpaca.markets",
      });

      const ticks = await backfill.fetchDateRange("TSLA", "2024-01-01", "2024-03-01", "1Hour");

      expect(ticks).toHaveLength(3);
      expect(ticks[0]!.sourceId).toBe("bt-source");
      expect(ticks[0]!.symbol).toBe("TSLA");
      expect(ticks[0]!.metadata).toEqual(expect.objectContaining({ backfill: true }));
    });
  });

  describe("fetchAllDateRange", () => {
    it("calls fetchDateRange for each symbol and collects all ticks", async () => {
      const backfill = new AlpacaBackfill({
        sourceId: "alpaca-stream",
        keyId: "KEY",
        secretKey: "SECRET",
        baseUrl: "https://data.alpaca.markets",
      });

      const ticks = await backfill.fetchAllDateRange(
        ["AAPL", "TSLA"],
        "2024-01-01",
        "2024-06-30",
        "1Day",
      );

      expect(ticks).toHaveLength(6); // 3 bars per symbol
      const symbols = new Set(ticks.map((t) => t.symbol));
      expect(symbols).toEqual(new Set(["AAPL", "TSLA"]));
    });

    it("continues when one symbol fails", async () => {
      globalThis.fetch = vi.fn<[string, RequestInit?], Promise<Response>>().mockImplementation(async (url: string) => {
        if (url.includes("/BADTICKER/")) {
          return { ok: false, status: 404, text: async () => "Not Found" } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ bars: MOCK_BARS, next_page_token: null }),
        } as Response;
      });

      const backfill = new AlpacaBackfill({
        sourceId: "alpaca-stream",
        keyId: "KEY",
        secretKey: "SECRET",
        baseUrl: "https://data.alpaca.markets",
      });

      const ticks = await backfill.fetchAllDateRange(
        ["AAPL", "BADTICKER", "TSLA"],
        "2024-01-01",
        "2024-06-30",
        "1Day",
      );

      expect(ticks).toHaveLength(6);
      const symbols = new Set(ticks.map((t) => t.symbol));
      expect(symbols).toEqual(new Set(["AAPL", "TSLA"]));
    });
  });
});
