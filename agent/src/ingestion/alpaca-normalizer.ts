import type { DataTick } from "@finwatch/shared";
import { createLogger } from "../utils/logger.js";

const log = createLogger("alpaca-normalizer");

export type AlpacaBarMessage = {
  T: "b";
  S: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  t: string;
};

export type AlpacaTradeMessage = {
  T: "t";
  S: string;
  p: number;
  s: number;
  t: string;
};

export type AlpacaQuoteMessage = {
  T: "q";
  S: string;
  bp: number;
  ap: number;
  bs: number;
  as: number;
  t: string;
};

export type AlpacaMessage = AlpacaBarMessage | AlpacaTradeMessage | AlpacaQuoteMessage;

function parseTimestamp(iso: string): number {
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) {
    log.error("Invalid timestamp", { iso });
    throw new Error(`Invalid timestamp: "${iso}"`);
  }
  return ts;
}

export function normalizeAlpacaBar(sourceId: string, bar: AlpacaBarMessage): DataTick {
  return {
    sourceId,
    timestamp: parseTimestamp(bar.t),
    symbol: bar.S.toUpperCase(),
    metrics: {
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
    },
    metadata: { alpacaType: "bar" },
    raw: bar,
  };
}

export function normalizeAlpacaTrade(sourceId: string, trade: AlpacaTradeMessage): DataTick {
  return {
    sourceId,
    timestamp: parseTimestamp(trade.t),
    symbol: trade.S.toUpperCase(),
    metrics: {
      price: trade.p,
      size: trade.s,
    },
    metadata: { alpacaType: "trade" },
    raw: trade,
  };
}

export function normalizeAlpacaQuote(sourceId: string, quote: AlpacaQuoteMessage): DataTick {
  return {
    sourceId,
    timestamp: parseTimestamp(quote.t),
    symbol: quote.S.toUpperCase(),
    metrics: {
      bidPrice: quote.bp,
      askPrice: quote.ap,
      bidSize: quote.bs,
      askSize: quote.as,
      spread: quote.ap - quote.bp,
    },
    metadata: { alpacaType: "quote" },
    raw: quote,
  };
}
