import type { DataTick, SourceHealth, SourceConfig } from "@finwatch/shared";
import type { DataSource } from "./types.js";
import {
  normalizeAlpacaBar,
  normalizeAlpacaTrade,
  normalizeAlpacaQuote,
} from "./alpaca-normalizer.js";
import type {
  AlpacaBarMessage,
  AlpacaTradeMessage,
  AlpacaQuoteMessage,
} from "./alpaca-normalizer.js";

type AlpacaWsMessage =
  | { T: "success"; msg: string }
  | { T: "error"; msg: string; code: number }
  | { T: "subscription"; trades: string[]; quotes: string[]; bars: string[] }
  | AlpacaBarMessage
  | AlpacaTradeMessage
  | AlpacaQuoteMessage;

type WsLike = {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: string, handler: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
};

type WsFactory = (url: string) => WsLike;

const WS_ENDPOINTS: Record<string, string> = {
  iex: "wss://stream.data.alpaca.markets/v2/iex",
  sip: "wss://stream.data.alpaca.markets/v2/sip",
};

export class AlpacaStreamSource implements DataSource {
  readonly id: string;
  readonly config: SourceConfig;

  private feed: string;
  private symbols: string[];
  private channels: string[];
  private keyId: string;
  private secretKey: string;

  private ws: WsLike | null = null;
  private wsFactory: WsFactory;
  private tickBuffer: DataTick[] = [];
  private started = false;
  private authenticated = false;
  private failCount = 0;
  private lastSuccess = 0;
  private lastFailure: number | undefined;

  constructor(config: SourceConfig, wsFactory: WsFactory) {
    this.id = config.id;
    this.config = config;
    const c = config.config;
    this.feed = (c.feed as string) ?? "iex";
    this.symbols = (c.symbols as string[]) ?? [];
    this.channels = (c.channels as string[]) ?? ["trades", "quotes", "bars"];
    this.keyId = (c.keyId as string) ?? "";
    this.secretKey = (c.secretKey as string) ?? "";
    this.wsFactory = wsFactory;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.connect();
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.authenticated = false;
    this.tickBuffer = [];
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  async fetch(): Promise<DataTick[]> {
    const ticks = this.tickBuffer;
    this.tickBuffer = [];
    return ticks;
  }

  async healthCheck(): Promise<SourceHealth> {
    let status: SourceHealth["status"];
    if (!this.started) {
      status = "offline";
    } else if (this.failCount === 0 && this.authenticated) {
      status = "healthy";
    } else if (this.failCount >= 3) {
      status = "offline";
    } else {
      status = "degraded";
    }

    return {
      sourceId: this.id,
      status,
      lastSuccess: this.lastSuccess,
      lastFailure: this.lastFailure,
      failCount: this.failCount,
      latencyMs: 0,
    };
  }

  private connect(): void {
    const endpoint = WS_ENDPOINTS[this.feed] ?? WS_ENDPOINTS.iex!;
    this.ws = this.wsFactory(endpoint);

    this.ws.on("open", () => {
      // Wait for server's "connected" message before sending auth
    });

    this.ws.on("message", (event: unknown) => {
      this.handleMessage(event);
    });

    this.ws.on("error", () => {
      this.failCount++;
      this.lastFailure = Date.now();
    });

    this.ws.on("close", () => {
      this.authenticated = false;
    });
  }

  private handleMessage(event: unknown): void {
    const raw =
      typeof event === "string"
        ? event
        : (event as { data?: string })?.data;

    if (typeof raw !== "string") return;

    let messages: AlpacaWsMessage[];
    try {
      messages = JSON.parse(raw) as AlpacaWsMessage[];
    } catch {
      return;
    }

    if (!Array.isArray(messages)) return;

    for (const msg of messages) {
      switch (msg.T) {
        case "success":
          this.handleSuccess(msg.msg);
          break;
        case "b":
          this.tickBuffer.push(
            normalizeAlpacaBar(this.id, msg as AlpacaBarMessage),
          );
          this.lastSuccess = Date.now();
          this.failCount = 0;
          break;
        case "t":
          this.tickBuffer.push(
            normalizeAlpacaTrade(this.id, msg as AlpacaTradeMessage),
          );
          this.lastSuccess = Date.now();
          this.failCount = 0;
          break;
        case "q":
          this.tickBuffer.push(
            normalizeAlpacaQuote(this.id, msg as AlpacaQuoteMessage),
          );
          this.lastSuccess = Date.now();
          this.failCount = 0;
          break;
        // Ignore subscription, error, and other control messages
      }
    }
  }

  private handleSuccess(msg: string): void {
    if (msg === "connected") {
      this.sendAuth();
    } else if (msg === "authenticated") {
      this.authenticated = true;
      this.lastSuccess = Date.now();
      this.failCount = 0;
      this.sendSubscribe();
    }
  }

  private sendAuth(): void {
    if (!this.ws) return;
    this.ws.send(
      JSON.stringify({
        action: "auth",
        key: this.keyId,
        secret: this.secretKey,
      }),
    );
  }

  private sendSubscribe(): void {
    if (!this.ws) return;
    const sub: Record<string, unknown> = { action: "subscribe" };
    if (this.channels.includes("trades")) sub.trades = this.symbols;
    if (this.channels.includes("quotes")) sub.quotes = this.symbols;
    if (this.channels.includes("bars")) sub.bars = this.symbols;
    this.ws.send(JSON.stringify(sub));
  }
}
