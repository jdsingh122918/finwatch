import type { DataTick, SourceHealth, SourceConfig } from "@finwatch/shared";
import type { DataSource } from "./types.js";

type YahooChartResult = {
  meta: {
    symbol: string;
    currency: string;
    regularMarketPrice: number;
    exchangeTimezoneName: string;
  };
  timestamp: number[];
  indicators: {
    quote: Array<{
      open: (number | null)[];
      high: (number | null)[];
      low: (number | null)[];
      close: (number | null)[];
      volume: (number | null)[];
    }>;
  };
};

type YahooChartResponse = {
  chart: {
    result: YahooChartResult[] | null;
    error: { code: string; description: string } | null;
  };
};

const BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

export class YahooFinanceSource implements DataSource {
  readonly id: string;
  readonly config: SourceConfig;

  private symbols: string[];
  private range: string;
  private interval: string;
  private started = false;
  private lastSuccess = 0;
  private lastFailure: number | undefined;
  private failCount = 0;
  private lastLatencyMs = 0;

  constructor(config: SourceConfig) {
    this.id = config.id;
    this.config = config;
    const c = config.config;
    this.symbols = (c.symbols as string[] | undefined) ?? ["SPY"];
    this.range = (c.range as string | undefined) ?? "5d";
    this.interval = (c.interval as string | undefined) ?? "1d";
  }

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
  }

  async fetch(): Promise<DataTick[]> {
    const allTicks: DataTick[] = [];

    for (const symbol of this.symbols) {
      const startTime = Date.now();
      try {
        const ticks = await this.fetchSymbol(symbol);
        this.lastLatencyMs = Date.now() - startTime;
        this.lastSuccess = Date.now();
        allTicks.push(...ticks);
      } catch (err) {
        this.lastLatencyMs = Date.now() - startTime;
        this.failCount++;
        this.lastFailure = Date.now();
        throw err;
      }
    }

    // Reset fail count on full success
    this.failCount = 0;
    return allTicks;
  }

  private async fetchSymbol(symbol: string): Promise<DataTick[]> {
    const url = `${BASE_URL}/${encodeURIComponent(symbol)}?range=${this.range}&interval=${this.interval}`;
    const response = await globalThis.fetch(url);

    if (!response.ok) {
      throw new Error(
        `Yahoo Finance API returned HTTP ${response.status} for ${symbol}`
      );
    }

    const data = (await response.json()) as YahooChartResponse;

    if (data.chart.error) {
      throw new Error(data.chart.error.description);
    }

    if (!data.chart.result || data.chart.result.length === 0) {
      throw new Error(`No chart data returned for ${symbol}`);
    }

    const result = data.chart.result[0]!;
    const quote = result.indicators.quote[0]!;
    const ticks: DataTick[] = [];

    for (let i = 0; i < result.timestamp.length; i++) {
      const open = quote.open[i];
      const high = quote.high[i];
      const low = quote.low[i];
      const close = quote.close[i];
      const volume = quote.volume[i];

      // Skip data points where any OHLCV value is null
      if (
        open === null || open === undefined ||
        high === null || high === undefined ||
        low === null || low === undefined ||
        close === null || close === undefined ||
        volume === null || volume === undefined
      ) {
        continue;
      }

      ticks.push({
        sourceId: this.id,
        timestamp: result.timestamp[i]!,
        symbol: result.meta.symbol,
        metrics: { open, high, low, close, volume },
        metadata: {
          currency: result.meta.currency,
          exchangeTimezone: result.meta.exchangeTimezoneName,
        },
        raw: {
          open: quote.open[i],
          high: quote.high[i],
          low: quote.low[i],
          close: quote.close[i],
          volume: quote.volume[i],
          timestamp: result.timestamp[i],
        },
      });
    }

    return ticks;
  }

  async healthCheck(): Promise<SourceHealth> {
    const status =
      this.failCount === 0
        ? "healthy"
        : this.failCount >= 3
          ? "offline"
          : "degraded";

    return {
      sourceId: this.id,
      status,
      lastSuccess: this.lastSuccess,
      lastFailure: this.lastFailure,
      failCount: this.failCount,
      latencyMs: this.lastLatencyMs,
    };
  }
}
