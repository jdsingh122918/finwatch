import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { YahooFinanceSource } from "../yahoo-finance-source.js";
import type { SourceConfig } from "@finwatch/shared";

// Mock response matching Yahoo Finance v8 chart API shape
const MOCK_CHART_RESPONSE = {
  chart: {
    result: [
      {
        meta: {
          symbol: "AAPL",
          currency: "USD",
          regularMarketPrice: 178.72,
          exchangeTimezoneName: "America/New_York",
        },
        timestamp: [1706745600, 1706832000, 1706918400],
        indicators: {
          quote: [
            {
              open: [183.92, 184.35, 185.04],
              high: [185.09, 185.56, 185.64],
              low: [182.41, 183.94, 184.39],
              close: [184.4, 185.04, 185.56],
              volume: [49_120_300, 42_355_100, 39_630_000],
            },
          ],
        },
      },
    ],
    error: null,
  },
};

const MOCK_ERROR_RESPONSE = {
  chart: {
    result: null,
    error: {
      code: "Not Found",
      description: "No data found, symbol may be delisted",
    },
  },
};

// Capture the global fetch so we can mock it
const originalFetch = globalThis.fetch;

function makeMockFetch(response: unknown, status = 200) {
  return vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => response,
    text: async () => JSON.stringify(response),
  } as Response);
}

function createConfig(overrides: Partial<SourceConfig["config"]> = {}): SourceConfig {
  return {
    id: "yahoo-test",
    name: "Yahoo Finance Test",
    type: "polling",
    plugin: "yahoo-finance",
    config: {
      symbols: ["AAPL"],
      range: "5d",
      interval: "1d",
      ...overrides,
    },
    pollIntervalMs: 60000,
    enabled: true,
  };
}

describe("YahooFinanceSource", () => {
  beforeEach(() => {
    globalThis.fetch = makeMockFetch(MOCK_CHART_RESPONSE);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("constructs with correct id and config", () => {
    const source = new YahooFinanceSource(createConfig());
    expect(source.id).toBe("yahoo-test");
    expect(source.config.plugin).toBe("yahoo-finance");
  });

  it("fetches and parses OHLCV data into DataTick array", async () => {
    const source = new YahooFinanceSource(createConfig());
    await source.start();
    const ticks = await source.fetch();

    expect(ticks).toHaveLength(3);
    expect(ticks[0]!.sourceId).toBe("yahoo-test");
    expect(ticks[0]!.symbol).toBe("AAPL");
    expect(ticks[0]!.timestamp).toBe(1706745600);
    expect(ticks[0]!.metrics).toEqual({
      open: 183.92,
      high: 185.09,
      low: 182.41,
      close: 184.4,
      volume: 49_120_300,
    });
  });

  it("includes metadata with currency and exchange timezone", async () => {
    const source = new YahooFinanceSource(createConfig());
    await source.start();
    const ticks = await source.fetch();

    expect(ticks[0]!.metadata).toEqual(
      expect.objectContaining({
        currency: "USD",
        exchangeTimezone: "America/New_York",
      })
    );
  });

  it("stores raw response data on each tick", async () => {
    const source = new YahooFinanceSource(createConfig());
    await source.start();
    const ticks = await source.fetch();

    expect(ticks[0]!.raw).toBeDefined();
  });

  it("calls correct Yahoo Finance API URL with query params", async () => {
    const mockFetch = makeMockFetch(MOCK_CHART_RESPONSE);
    globalThis.fetch = mockFetch;

    const source = new YahooFinanceSource(
      createConfig({ symbols: ["MSFT"], range: "1mo", interval: "1d" })
    );
    await source.start();
    await source.fetch();

    expect(mockFetch).toHaveBeenCalledOnce();
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("query1.finance.yahoo.com");
    expect(url).toContain("MSFT");
    expect(url).toContain("range=1mo");
    expect(url).toContain("interval=1d");
  });

  it("fetches multiple symbols and concatenates ticks", async () => {
    const mockFetch = makeMockFetch(MOCK_CHART_RESPONSE);
    globalThis.fetch = mockFetch;

    const source = new YahooFinanceSource(
      createConfig({ symbols: ["AAPL", "MSFT"] })
    );
    await source.start();
    const ticks = await source.fetch();

    // 3 ticks per symbol, 2 symbols
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(ticks).toHaveLength(6);
  });

  it("throws on API error response", async () => {
    globalThis.fetch = makeMockFetch(MOCK_ERROR_RESPONSE);

    const source = new YahooFinanceSource(createConfig());
    await source.start();

    await expect(source.fetch()).rejects.toThrow("No data found");
  });

  it("throws on HTTP error status", async () => {
    globalThis.fetch = makeMockFetch({}, 500);

    const source = new YahooFinanceSource(createConfig());
    await source.start();

    await expect(source.fetch()).rejects.toThrow();
  });

  it("skips null data points in OHLCV arrays", async () => {
    const responseWithNulls = {
      chart: {
        result: [
          {
            meta: {
              symbol: "AAPL",
              currency: "USD",
              regularMarketPrice: 178.72,
              exchangeTimezoneName: "America/New_York",
            },
            timestamp: [1706745600, 1706832000],
            indicators: {
              quote: [
                {
                  open: [183.92, null],
                  high: [185.09, null],
                  low: [182.41, null],
                  close: [184.4, null],
                  volume: [49_120_300, null],
                },
              ],
            },
          },
        ],
        error: null,
      },
    };
    globalThis.fetch = makeMockFetch(responseWithNulls);

    const source = new YahooFinanceSource(createConfig());
    await source.start();
    const ticks = await source.fetch();

    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.timestamp).toBe(1706745600);
  });

  it("reports healthy status after successful fetch", async () => {
    const source = new YahooFinanceSource(createConfig());
    await source.start();
    await source.fetch();

    const health = await source.healthCheck();
    expect(health.sourceId).toBe("yahoo-test");
    expect(health.status).toBe("healthy");
    expect(health.failCount).toBe(0);
    expect(health.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("reports degraded status after fetch failure", async () => {
    const source = new YahooFinanceSource(createConfig());
    await source.start();

    // First call succeeds
    await source.fetch();

    // Now make it fail
    globalThis.fetch = makeMockFetch({}, 500);
    try {
      await source.fetch();
    } catch {
      // expected
    }

    const health = await source.healthCheck();
    expect(health.status).toBe("degraded");
    expect(health.failCount).toBe(1);
  });

  it("start and stop are idempotent", async () => {
    const source = new YahooFinanceSource(createConfig());
    await source.start();
    await source.start(); // no-op
    await source.stop();
    await source.stop(); // no-op
  });
});
