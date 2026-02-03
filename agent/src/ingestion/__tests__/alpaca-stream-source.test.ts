import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AlpacaStreamSource } from "../alpaca-stream-source.js";
import type { SourceConfig } from "@finwatch/shared";
import { EventEmitter } from "events";

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------
class MockWebSocket extends EventEmitter {
  static OPEN = 1;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  sentMessages: string[] = [];

  constructor(public url: string) {
    super();
    // Auto-fire open after microtask
    queueMicrotask(() => this.emit("open"));
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close");
  }

  // Simulate receiving a message from the server
  simulateMessage(data: unknown): void {
    this.emit("message", { data: JSON.stringify(data) });
  }

  simulateError(err: Error): void {
    this.emit("error", err);
  }
}

// Factory that captures created instances
let mockWsInstances: MockWebSocket[] = [];
function mockWsFactory(url: string): MockWebSocket {
  const ws = new MockWebSocket(url);
  mockWsInstances.push(ws);
  return ws;
}

function createConfig(overrides: Partial<SourceConfig["config"]> = {}): SourceConfig {
  return {
    id: "alpaca-stream",
    name: "Alpaca Stream",
    type: "streaming",
    plugin: "alpaca",
    config: {
      feed: "iex",
      symbols: ["AAPL", "TSLA"],
      channels: ["trades", "quotes", "bars"],
      keyId: "PKTEST123",
      secretKey: "secret456",
      ...overrides,
    },
    enabled: true,
  };
}

describe("AlpacaStreamSource", () => {
  beforeEach(() => {
    mockWsInstances = [];
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("constructs with correct id and config", () => {
    const source = new AlpacaStreamSource(createConfig(), mockWsFactory);
    expect(source.id).toBe("alpaca-stream");
    expect(source.config.type).toBe("streaming");
  });

  it("connects to correct WebSocket URL on start()", async () => {
    const source = new AlpacaStreamSource(createConfig(), mockWsFactory);
    await source.start();

    expect(mockWsInstances).toHaveLength(1);
    expect(mockWsInstances[0]!.url).toBe("wss://stream.data.alpaca.markets/v2/iex");

    await source.stop();
  });

  it("uses sip endpoint when feed is sip", async () => {
    const source = new AlpacaStreamSource(
      createConfig({ feed: "sip" }),
      mockWsFactory,
    );
    await source.start();

    expect(mockWsInstances[0]!.url).toBe("wss://stream.data.alpaca.markets/v2/sip");

    await source.stop();
  });

  it("sends auth message on connect", async () => {
    const source = new AlpacaStreamSource(createConfig(), mockWsFactory);
    await source.start();

    const ws = mockWsInstances[0]!;
    // Simulate server sending connected message
    ws.simulateMessage([{ T: "success", msg: "connected" }]);
    await vi.advanceTimersByTimeAsync(0);

    expect(ws.sentMessages.length).toBeGreaterThanOrEqual(1);
    const authMsg = JSON.parse(ws.sentMessages[0]!);
    expect(authMsg.action).toBe("auth");
    expect(authMsg.key).toBe("PKTEST123");
    expect(authMsg.secret).toBe("secret456");

    await source.stop();
  });

  it("sends subscribe message after successful auth", async () => {
    const source = new AlpacaStreamSource(createConfig(), mockWsFactory);
    await source.start();

    const ws = mockWsInstances[0]!;
    ws.simulateMessage([{ T: "success", msg: "connected" }]);
    await vi.advanceTimersByTimeAsync(0);

    ws.simulateMessage([{ T: "success", msg: "authenticated" }]);
    await vi.advanceTimersByTimeAsync(0);

    const subMsg = JSON.parse(ws.sentMessages[1]!);
    expect(subMsg.action).toBe("subscribe");
    expect(subMsg.trades).toEqual(["AAPL", "TSLA"]);
    expect(subMsg.quotes).toEqual(["AAPL", "TSLA"]);
    expect(subMsg.bars).toEqual(["AAPL", "TSLA"]);

    await source.stop();
  });

  it("accumulates bar ticks and returns them via fetch()", async () => {
    const source = new AlpacaStreamSource(createConfig(), mockWsFactory);
    await source.start();

    const ws = mockWsInstances[0]!;
    ws.simulateMessage([{ T: "success", msg: "connected" }]);
    ws.simulateMessage([{ T: "success", msg: "authenticated" }]);

    ws.simulateMessage([
      { T: "b", S: "AAPL", o: 183, h: 185, l: 182, c: 184, v: 50000, t: "2024-02-01T14:30:00Z" },
    ]);

    const ticks = await source.fetch();
    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.symbol).toBe("AAPL");
    expect(ticks[0]!.metrics.close).toBe(184);

    await source.stop();
  });

  it("accumulates trade and quote ticks", async () => {
    const source = new AlpacaStreamSource(createConfig(), mockWsFactory);
    await source.start();

    const ws = mockWsInstances[0]!;
    ws.simulateMessage([{ T: "success", msg: "connected" }]);
    ws.simulateMessage([{ T: "success", msg: "authenticated" }]);

    ws.simulateMessage([
      { T: "t", S: "AAPL", p: 184.5, s: 100, t: "2024-02-01T14:30:01Z" },
      { T: "q", S: "TSLA", bp: 200, ap: 200.10, bs: 500, as: 400, t: "2024-02-01T14:30:02Z" },
    ]);

    const ticks = await source.fetch();
    expect(ticks).toHaveLength(2);
    expect(ticks[0]!.metrics.price).toBe(184.5);
    expect(ticks[1]!.metrics.spread).toBeCloseTo(0.10, 10);

    await source.stop();
  });

  it("fetch() drains the buffer (second call returns empty)", async () => {
    const source = new AlpacaStreamSource(createConfig(), mockWsFactory);
    await source.start();

    const ws = mockWsInstances[0]!;
    ws.simulateMessage([{ T: "success", msg: "connected" }]);
    ws.simulateMessage([{ T: "success", msg: "authenticated" }]);
    ws.simulateMessage([
      { T: "b", S: "AAPL", o: 183, h: 185, l: 182, c: 184, v: 50000, t: "2024-02-01T14:30:00Z" },
    ]);

    const first = await source.fetch();
    expect(first).toHaveLength(1);

    const second = await source.fetch();
    expect(second).toHaveLength(0);

    await source.stop();
  });

  it("reports healthy when connected", async () => {
    const source = new AlpacaStreamSource(createConfig(), mockWsFactory);
    await source.start();

    const ws = mockWsInstances[0]!;
    ws.simulateMessage([{ T: "success", msg: "connected" }]);
    ws.simulateMessage([{ T: "success", msg: "authenticated" }]);

    const health = await source.healthCheck();
    expect(health.sourceId).toBe("alpaca-stream");
    expect(health.status).toBe("healthy");
    expect(health.failCount).toBe(0);

    await source.stop();
  });

  it("reports offline when not started", async () => {
    const source = new AlpacaStreamSource(createConfig(), mockWsFactory);
    const health = await source.healthCheck();
    expect(health.status).toBe("offline");
  });

  it("reports degraded after connection error", async () => {
    const source = new AlpacaStreamSource(createConfig(), mockWsFactory);
    await source.start();

    const ws = mockWsInstances[0]!;
    ws.simulateError(new Error("Connection failed"));
    ws.readyState = MockWebSocket.CLOSED;

    const health = await source.healthCheck();
    expect(health.status).toBe("degraded");
    expect(health.failCount).toBe(1);

    await source.stop();
  });

  it("stop() closes WebSocket and clears buffer", async () => {
    const source = new AlpacaStreamSource(createConfig(), mockWsFactory);
    await source.start();

    const ws = mockWsInstances[0]!;
    ws.simulateMessage([{ T: "success", msg: "connected" }]);
    ws.simulateMessage([{ T: "success", msg: "authenticated" }]);
    ws.simulateMessage([
      { T: "b", S: "AAPL", o: 183, h: 185, l: 182, c: 184, v: 50000, t: "2024-02-01T14:30:00Z" },
    ]);

    await source.stop();
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);

    const ticks = await source.fetch();
    expect(ticks).toHaveLength(0);
  });

  it("start and stop are idempotent", async () => {
    const source = new AlpacaStreamSource(createConfig(), mockWsFactory);
    await source.start();
    await source.start(); // no-op
    expect(mockWsInstances).toHaveLength(1);

    await source.stop();
    await source.stop(); // no-op
  });

  it("ignores non-data messages (success, error, subscription)", async () => {
    const source = new AlpacaStreamSource(createConfig(), mockWsFactory);
    await source.start();

    const ws = mockWsInstances[0]!;
    ws.simulateMessage([{ T: "success", msg: "connected" }]);
    ws.simulateMessage([{ T: "success", msg: "authenticated" }]);
    ws.simulateMessage([{ T: "subscription", trades: ["AAPL"], quotes: ["AAPL"], bars: ["AAPL"] }]);

    const ticks = await source.fetch();
    expect(ticks).toHaveLength(0);

    await source.stop();
  });
});
