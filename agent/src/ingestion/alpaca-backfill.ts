import type { DataTick } from "@finwatch/shared";

export type AlpacaBackfillConfig = {
  sourceId: string;
  keyId: string;
  secretKey: string;
  baseUrl: string;
};

type AlpacaRestBar = {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
};

type BarsResponse = {
  bars: AlpacaRestBar[];
  next_page_token: string | null;
};

export class AlpacaBackfill {
  private config: AlpacaBackfillConfig;

  constructor(config: AlpacaBackfillConfig) {
    this.config = config;
  }

  async fetchBars(symbol: string, days: number): Promise<DataTick[]> {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

    const params = new URLSearchParams({
      start: start.toISOString(),
      end: end.toISOString(),
      timeframe: "1Day",
      limit: "1000",
    });

    const url = `${this.config.baseUrl}/v2/stocks/${encodeURIComponent(symbol)}/bars?${params}`;
    const response = await globalThis.fetch(url, {
      headers: {
        "APCA-API-KEY-ID": this.config.keyId,
        "APCA-API-SECRET-KEY": this.config.secretKey,
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Alpaca bars API returned HTTP ${response.status} for ${symbol}: ${text}`,
      );
    }

    const data = (await response.json()) as BarsResponse;

    return (data.bars ?? []).map((bar): DataTick => ({
      sourceId: this.config.sourceId,
      timestamp: new Date(bar.t).getTime(),
      symbol: symbol.toUpperCase(),
      metrics: {
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
      },
      metadata: { alpacaType: "bar", backfill: true },
      raw: bar,
    }));
  }

  async fetchAllSymbols(symbols: string[], days: number): Promise<DataTick[]> {
    const allTicks: DataTick[] = [];
    for (const symbol of symbols) {
      const ticks = await this.fetchBars(symbol, days);
      allTicks.push(...ticks);
    }
    return allTicks;
  }
}
