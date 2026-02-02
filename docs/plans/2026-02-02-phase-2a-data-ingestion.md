# Phase 2A: Data Ingestion Pipeline — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the data ingestion pipeline: source plugin system, Yahoo Finance and CSV adapters, normalization, buffering, health monitoring, polling scheduler, and custom source loading.

**Architecture:** Plugin-based source registry with polling/file adapters, normalized DataTick output, event-driven buffer with interval and urgent flush modes, and health monitoring with degradation tracking.

**Tech Stack:** TypeScript, Vitest, Zod, node:fs/promises, node:events

**Worktree:** `/Users/jdsingh/Projects/AI/finwatch-data-ingestion`
**Branch:** `feat/data-ingestion`
**Owns:** `agent/src/ingestion/` — EXCLUSIVE

---

## Task 2A.1: DataSource Interface + SourceRegistry Class

**Goal:** Define the `DataSource` interface that all source plugins must implement, and build a `SourceRegistry` class to register, start, stop, and health-check sources by ID. This is the foundation every other task builds on.

**Files:**
- Create: `agent/src/ingestion/__tests__/source-registry.test.ts`
- Create: `agent/src/ingestion/types.ts`
- Create: `agent/src/ingestion/source-registry.ts`

### Step 1: Write failing tests

Create `agent/src/ingestion/__tests__/source-registry.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DataTick, SourceHealth, SourceConfig } from "@finwatch/shared";
import { SourceRegistry } from "../source-registry.js";
import type { DataSource } from "../types.js";

function createMockSource(overrides: Partial<DataSource> = {}): DataSource {
  return {
    id: "mock-source",
    config: {
      id: "mock-source",
      name: "Mock Source",
      type: "polling",
      plugin: "mock",
      config: {},
      enabled: true,
    },
    start: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    stop: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    healthCheck: vi.fn<[], Promise<SourceHealth>>().mockResolvedValue({
      sourceId: "mock-source",
      status: "healthy",
      lastSuccess: Date.now(),
      failCount: 0,
      latencyMs: 10,
    }),
    fetch: vi.fn<[], Promise<DataTick[]>>().mockResolvedValue([]),
    ...overrides,
  };
}

describe("SourceRegistry", () => {
  let registry: SourceRegistry;

  beforeEach(() => {
    registry = new SourceRegistry();
  });

  it("registers a source and retrieves it by id", () => {
    const source = createMockSource({ id: "src-1" });
    registry.register(source);
    expect(registry.get("src-1")).toBe(source);
  });

  it("returns undefined for unregistered source", () => {
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("lists all registered sources", () => {
    registry.register(createMockSource({ id: "a" }));
    registry.register(createMockSource({ id: "b" }));
    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("prevents duplicate source registration", () => {
    registry.register(createMockSource({ id: "dup" }));
    expect(() => registry.register(createMockSource({ id: "dup" }))).toThrow(
      "Source already registered: dup"
    );
  });

  it("unregisters a source by id", () => {
    registry.register(createMockSource({ id: "removable" }));
    expect(registry.get("removable")).toBeDefined();
    registry.unregister("removable");
    expect(registry.get("removable")).toBeUndefined();
  });

  it("starts a specific source", async () => {
    const source = createMockSource({ id: "s1" });
    registry.register(source);
    await registry.start("s1");
    expect(source.start).toHaveBeenCalledOnce();
  });

  it("stops a specific source", async () => {
    const source = createMockSource({ id: "s1" });
    registry.register(source);
    await registry.start("s1");
    await registry.stop("s1");
    expect(source.stop).toHaveBeenCalledOnce();
  });

  it("starts all registered sources", async () => {
    const s1 = createMockSource({ id: "s1" });
    const s2 = createMockSource({ id: "s2" });
    registry.register(s1);
    registry.register(s2);
    await registry.startAll();
    expect(s1.start).toHaveBeenCalledOnce();
    expect(s2.start).toHaveBeenCalledOnce();
  });

  it("stops all registered sources", async () => {
    const s1 = createMockSource({ id: "s1" });
    const s2 = createMockSource({ id: "s2" });
    registry.register(s1);
    registry.register(s2);
    await registry.startAll();
    await registry.stopAll();
    expect(s1.stop).toHaveBeenCalledOnce();
    expect(s2.stop).toHaveBeenCalledOnce();
  });

  it("returns health for all sources", async () => {
    const s1 = createMockSource({
      id: "healthy-one",
      healthCheck: vi.fn<[], Promise<SourceHealth>>().mockResolvedValue({
        sourceId: "healthy-one",
        status: "healthy",
        lastSuccess: Date.now(),
        failCount: 0,
        latencyMs: 15,
      }),
    });
    const s2 = createMockSource({
      id: "degraded-one",
      healthCheck: vi.fn<[], Promise<SourceHealth>>().mockResolvedValue({
        sourceId: "degraded-one",
        status: "degraded",
        lastSuccess: Date.now() - 60000,
        failCount: 2,
        latencyMs: 800,
        message: "slow responses",
      }),
    });
    registry.register(s1);
    registry.register(s2);

    const health = await registry.healthCheck();
    expect(health).toHaveLength(2);
    expect(health[0]!.sourceId).toBe("healthy-one");
    expect(health[0]!.status).toBe("healthy");
    expect(health[1]!.sourceId).toBe("degraded-one");
    expect(health[1]!.status).toBe("degraded");
  });

  it("handles health check failures gracefully", async () => {
    const source = createMockSource({
      id: "broken",
      healthCheck: vi
        .fn<[], Promise<SourceHealth>>()
        .mockRejectedValue(new Error("connection refused")),
    });
    registry.register(source);

    const health = await registry.healthCheck();
    expect(health).toHaveLength(1);
    expect(health[0]!.sourceId).toBe("broken");
    expect(health[0]!.status).toBe("offline");
    expect(health[0]!.message).toContain("connection refused");
  });

  it("throws when starting an unregistered source", async () => {
    await expect(registry.start("nonexistent")).rejects.toThrow(
      "Source not found: nonexistent"
    );
  });

  it("throws when stopping an unregistered source", async () => {
    await expect(registry.stop("nonexistent")).rejects.toThrow(
      "Source not found: nonexistent"
    );
  });

  it("does not start a disabled source via startAll", async () => {
    const disabledSource = createMockSource({
      id: "disabled-src",
      config: {
        id: "disabled-src",
        name: "Disabled",
        type: "polling",
        plugin: "mock",
        config: {},
        enabled: false,
      },
    });
    registry.register(disabledSource);
    await registry.startAll();
    expect(disabledSource.start).not.toHaveBeenCalled();
  });

  it("fetches ticks from a specific source", async () => {
    const ticks: DataTick[] = [
      {
        sourceId: "fetcher",
        timestamp: Date.now(),
        symbol: "AAPL",
        metrics: { close: 150.0 },
        metadata: {},
      },
    ];
    const source = createMockSource({
      id: "fetcher",
      fetch: vi.fn<[], Promise<DataTick[]>>().mockResolvedValue(ticks),
    });
    registry.register(source);

    const result = await registry.fetch("fetcher");
    expect(result).toEqual(ticks);
  });
});
```

### Step 2: Run tests, verify FAIL

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run agent/src/ingestion/__tests__/source-registry.test.ts
```

Expected: All tests fail because `types.ts` and `source-registry.ts` do not exist.

### Step 3: Write implementation

Create `agent/src/ingestion/types.ts`:

```typescript
import type { DataTick, SourceHealth, SourceConfig } from "@finwatch/shared";

export interface DataSource {
  readonly id: string;
  readonly config: SourceConfig;
  start(): Promise<void>;
  stop(): Promise<void>;
  healthCheck(): Promise<SourceHealth>;
  fetch(): Promise<DataTick[]>;
}
```

Create `agent/src/ingestion/source-registry.ts`:

```typescript
import type { SourceHealth } from "@finwatch/shared";
import type { DataSource } from "./types.js";

export class SourceRegistry {
  private sources = new Map<string, DataSource>();

  register(source: DataSource): void {
    if (this.sources.has(source.id)) {
      throw new Error(`Source already registered: ${source.id}`);
    }
    this.sources.set(source.id, source);
  }

  unregister(id: string): void {
    this.sources.delete(id);
  }

  get(id: string): DataSource | undefined {
    return this.sources.get(id);
  }

  list(): DataSource[] {
    return [...this.sources.values()];
  }

  async start(id: string): Promise<void> {
    const source = this.sources.get(id);
    if (!source) {
      throw new Error(`Source not found: ${id}`);
    }
    await source.start();
  }

  async stop(id: string): Promise<void> {
    const source = this.sources.get(id);
    if (!source) {
      throw new Error(`Source not found: ${id}`);
    }
    await source.stop();
  }

  async startAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const source of this.sources.values()) {
      if (source.config.enabled) {
        promises.push(source.start());
      }
    }
    await Promise.all(promises);
  }

  async stopAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const source of this.sources.values()) {
      promises.push(source.stop());
    }
    await Promise.all(promises);
  }

  async fetch(id: string): Promise<import("@finwatch/shared").DataTick[]> {
    const source = this.sources.get(id);
    if (!source) {
      throw new Error(`Source not found: ${id}`);
    }
    return source.fetch();
  }

  async healthCheck(): Promise<SourceHealth[]> {
    const results: SourceHealth[] = [];

    for (const source of this.sources.values()) {
      try {
        const h = await source.healthCheck();
        results.push(h);
      } catch (err) {
        results.push({
          sourceId: source.id,
          status: "offline",
          lastSuccess: 0,
          failCount: 0,
          latencyMs: -1,
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return results;
  }
}
```

### Step 4: Run tests, verify PASS

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run agent/src/ingestion/__tests__/source-registry.test.ts
```

Expected: All 14 tests pass.

Also verify existing tests still pass:

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run --project agent
```

### Step 5: Commit

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && git add agent/src/ingestion/types.ts agent/src/ingestion/source-registry.ts agent/src/ingestion/__tests__/source-registry.test.ts && git commit -m "feat(ingestion): add DataSource interface and SourceRegistry with lifecycle management

Define DataSource plugin contract (start/stop/fetch/healthCheck) and
SourceRegistry for registering, starting, stopping, and health-checking
sources with disabled-source filtering.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2A.2: Yahoo Finance Adapter

**Goal:** Build a polling data source that fetches OHLCV data from Yahoo Finance using direct HTTP to the free chart API endpoint. Returns parsed `DataTick[]` with standardized metric names (open, high, low, close, volume). All tests mock HTTP -- no real API calls.

**Files:**
- Create: `agent/src/ingestion/__tests__/yahoo-finance-source.test.ts`
- Create: `agent/src/ingestion/yahoo-finance-source.ts`

### Step 1: Write failing tests

Create `agent/src/ingestion/__tests__/yahoo-finance-source.test.ts`:

```typescript
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
```

### Step 2: Run tests, verify FAIL

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run agent/src/ingestion/__tests__/yahoo-finance-source.test.ts
```

Expected: All tests fail because `yahoo-finance-source.ts` does not exist.

### Step 3: Write implementation

Create `agent/src/ingestion/yahoo-finance-source.ts`:

```typescript
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
```

### Step 4: Run tests, verify PASS

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run agent/src/ingestion/__tests__/yahoo-finance-source.test.ts
```

Expected: All 13 tests pass.

Also verify all previous tests still pass:

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run --project agent
```

### Step 5: Commit

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && git add agent/src/ingestion/yahoo-finance-source.ts agent/src/ingestion/__tests__/yahoo-finance-source.test.ts && git commit -m "feat(ingestion): add Yahoo Finance polling adapter with OHLCV parsing

Fetch chart data from Yahoo Finance v8 API, parse OHLCV into DataTick
arrays, skip null data points, track health with fail count degradation.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2A.3: CSV File Adapter

**Goal:** Build a file-based data source that watches a directory for CSV files, reads them incrementally (tracking byte offsets to avoid re-reading), and parses rows into `DataTick[]`. Uses `node:fs/promises` for reading and `node:fs.watch` for detecting new files. Tests create temp files.

**Files:**
- Create: `agent/src/ingestion/__tests__/csv-file-source.test.ts`
- Create: `agent/src/ingestion/csv-file-source.ts`

### Step 1: Write failing tests

Create `agent/src/ingestion/__tests__/csv-file-source.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { CsvFileSource } from "../csv-file-source.js";
import type { SourceConfig } from "@finwatch/shared";

const TEST_DIR = path.join(import.meta.dirname ?? ".", ".test-csv-sources");

function createConfig(overrides: Partial<SourceConfig["config"]> = {}): SourceConfig {
  return {
    id: "csv-test",
    name: "CSV Test Source",
    type: "file",
    plugin: "csv-file",
    config: {
      directory: TEST_DIR,
      symbol: "TEST",
      ...overrides,
    },
    enabled: true,
  };
}

function writeCsv(filename: string, content: string): string {
  const filePath = path.join(TEST_DIR, filename);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

describe("CsvFileSource", () => {
  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("constructs with correct id and config", () => {
    const source = new CsvFileSource(createConfig());
    expect(source.id).toBe("csv-test");
    expect(source.config.type).toBe("file");
  });

  it("parses a simple CSV with header row into DataTick array", async () => {
    writeCsv(
      "prices.csv",
      [
        "timestamp,open,high,low,close,volume",
        "1706745600,183.92,185.09,182.41,184.40,49120300",
        "1706832000,184.35,185.56,183.94,185.04,42355100",
      ].join("\n") + "\n"
    );

    const source = new CsvFileSource(createConfig());
    await source.start();
    const ticks = await source.fetch();

    expect(ticks).toHaveLength(2);
    expect(ticks[0]!.sourceId).toBe("csv-test");
    expect(ticks[0]!.timestamp).toBe(1706745600);
    expect(ticks[0]!.symbol).toBe("TEST");
    expect(ticks[0]!.metrics).toEqual({
      open: 183.92,
      high: 185.09,
      low: 182.41,
      close: 184.4,
      volume: 49120300,
    });
  });

  it("reads only new rows on subsequent fetch (incremental)", async () => {
    writeCsv(
      "incremental.csv",
      [
        "timestamp,close,volume",
        "1706745600,184.40,49120300",
      ].join("\n") + "\n"
    );

    const source = new CsvFileSource(createConfig());
    await source.start();

    // First fetch returns 1 row
    const first = await source.fetch();
    expect(first).toHaveLength(1);

    // Append more data
    fs.appendFileSync(
      path.join(TEST_DIR, "incremental.csv"),
      "1706832000,185.04,42355100\n"
    );

    // Second fetch returns only the new row
    const second = await source.fetch();
    expect(second).toHaveLength(1);
    expect(second[0]!.timestamp).toBe(1706832000);
  });

  it("handles multiple CSV files in the directory", async () => {
    writeCsv(
      "aapl.csv",
      [
        "timestamp,close",
        "1706745600,184.40",
      ].join("\n") + "\n"
    );
    writeCsv(
      "msft.csv",
      [
        "timestamp,close",
        "1706745600,410.00",
      ].join("\n") + "\n"
    );

    const source = new CsvFileSource(createConfig());
    await source.start();
    const ticks = await source.fetch();

    expect(ticks).toHaveLength(2);
  });

  it("ignores non-CSV files in the directory", async () => {
    writeCsv(
      "data.csv",
      [
        "timestamp,close",
        "1706745600,184.40",
      ].join("\n") + "\n"
    );
    fs.writeFileSync(path.join(TEST_DIR, "readme.txt"), "ignore me", "utf-8");
    fs.writeFileSync(path.join(TEST_DIR, "data.json"), "{}", "utf-8");

    const source = new CsvFileSource(createConfig());
    await source.start();
    const ticks = await source.fetch();

    expect(ticks).toHaveLength(1);
  });

  it("handles CSV with custom column mapping via config", async () => {
    writeCsv(
      "custom.csv",
      [
        "time,price,vol",
        "1706745600,184.40,49120300",
      ].join("\n") + "\n"
    );

    const source = new CsvFileSource(
      createConfig({
        directory: TEST_DIR,
        symbol: "CUSTOM",
        columnMap: {
          timestamp: "time",
          close: "price",
          volume: "vol",
        },
      })
    );
    await source.start();
    const ticks = await source.fetch();

    expect(ticks).toHaveLength(1);
    expect(ticks[0]!.metrics.close).toBe(184.4);
    expect(ticks[0]!.metrics.volume).toBe(49120300);
    expect(ticks[0]!.timestamp).toBe(1706745600);
  });

  it("includes source file path in metadata", async () => {
    writeCsv(
      "meta.csv",
      [
        "timestamp,close",
        "1706745600,184.40",
      ].join("\n") + "\n"
    );

    const source = new CsvFileSource(createConfig());
    await source.start();
    const ticks = await source.fetch();

    expect(ticks[0]!.metadata.file).toContain("meta.csv");
  });

  it("skips malformed rows and continues parsing", async () => {
    writeCsv(
      "malformed.csv",
      [
        "timestamp,close",
        "1706745600,184.40",
        "bad-timestamp,not-a-number",
        "1706832000,185.04",
      ].join("\n") + "\n"
    );

    const source = new CsvFileSource(createConfig());
    await source.start();
    const ticks = await source.fetch();

    expect(ticks).toHaveLength(2);
    expect(ticks[0]!.timestamp).toBe(1706745600);
    expect(ticks[1]!.timestamp).toBe(1706832000);
  });

  it("returns empty array for empty directory", async () => {
    const source = new CsvFileSource(createConfig());
    await source.start();
    const ticks = await source.fetch();
    expect(ticks).toEqual([]);
  });

  it("returns empty array for CSV with only header", async () => {
    writeCsv("empty.csv", "timestamp,close\n");

    const source = new CsvFileSource(createConfig());
    await source.start();
    const ticks = await source.fetch();
    expect(ticks).toEqual([]);
  });

  it("reports healthy status on success", async () => {
    writeCsv(
      "health.csv",
      [
        "timestamp,close",
        "1706745600,184.40",
      ].join("\n") + "\n"
    );

    const source = new CsvFileSource(createConfig());
    await source.start();
    await source.fetch();

    const health = await source.healthCheck();
    expect(health.sourceId).toBe("csv-test");
    expect(health.status).toBe("healthy");
    expect(health.failCount).toBe(0);
  });

  it("creates directory if it does not exist", async () => {
    const missingDir = path.join(TEST_DIR, "subdir", "nested");
    const source = new CsvFileSource(
      createConfig({ directory: missingDir })
    );
    await source.start();

    expect(fs.existsSync(missingDir)).toBe(true);
  });

  it("stop cleans up watcher resources", async () => {
    const source = new CsvFileSource(createConfig());
    await source.start();
    await source.stop();
    // Calling stop again should be idempotent
    await source.stop();
  });
});
```

### Step 2: Run tests, verify FAIL

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run agent/src/ingestion/__tests__/csv-file-source.test.ts
```

Expected: All tests fail because `csv-file-source.ts` does not exist.

### Step 3: Write implementation

Create `agent/src/ingestion/csv-file-source.ts`:

```typescript
import * as fs from "node:fs";
import * as path from "node:path";
import type { DataTick, SourceHealth, SourceConfig } from "@finwatch/shared";
import type { DataSource } from "./types.js";

type ColumnMap = Record<string, string>;

type FileState = {
  headerColumns: string[];
  byteOffset: number;
};

export class CsvFileSource implements DataSource {
  readonly id: string;
  readonly config: SourceConfig;

  private directory: string;
  private symbol: string;
  private columnMap: ColumnMap;
  private fileStates = new Map<string, FileState>();
  private started = false;
  private watcher: fs.FSWatcher | null = null;
  private lastSuccess = 0;
  private lastFailure: number | undefined;
  private failCount = 0;

  constructor(config: SourceConfig) {
    this.id = config.id;
    this.config = config;
    const c = config.config;
    this.directory = c.directory as string;
    this.symbol = (c.symbol as string | undefined) ?? "";
    this.columnMap = (c.columnMap as ColumnMap | undefined) ?? {};
  }

  async start(): Promise<void> {
    if (this.started) return;
    fs.mkdirSync(this.directory, { recursive: true });
    this.started = true;

    try {
      this.watcher = fs.watch(this.directory, () => {
        // File change detected; fetch() will pick up new data.
      });
      // Prevent watcher from keeping process alive
      this.watcher.unref();
    } catch {
      // Watcher is optional; fetch still works by scanning directory.
    }
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  async fetch(): Promise<DataTick[]> {
    const allTicks: DataTick[] = [];

    try {
      const entries = await fs.promises.readdir(this.directory);
      const csvFiles = entries
        .filter((f) => f.endsWith(".csv"))
        .sort();

      for (const filename of csvFiles) {
        const filePath = path.join(this.directory, filename);
        const ticks = await this.readCsvFile(filePath);
        allTicks.push(...ticks);
      }

      this.lastSuccess = Date.now();
      this.failCount = 0;
    } catch (err) {
      this.failCount++;
      this.lastFailure = Date.now();
      throw err;
    }

    return allTicks;
  }

  private async readCsvFile(filePath: string): Promise<DataTick[]> {
    const stat = await fs.promises.stat(filePath);
    const existing = this.fileStates.get(filePath);
    const ticks: DataTick[] = [];

    if (existing && existing.byteOffset >= stat.size) {
      // No new data
      return ticks;
    }

    const content = await fs.promises.readFile(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);

    if (lines.length === 0) return ticks;

    // First line is always the header
    const headerLine = lines[0]!;
    const headerColumns = headerLine.split(",").map((h) => h.trim());

    // Determine where to start reading
    let startLine = 1; // skip header by default
    if (existing) {
      // Count lines in the already-read portion
      const previousContent = content.slice(0, existing.byteOffset);
      const previousLines = previousContent.split("\n").filter((l) => l.trim().length > 0);
      startLine = previousLines.length;
    }

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i]!;
      const tick = this.parseLine(headerColumns, line, filePath);
      if (tick) {
        ticks.push(tick);
      }
    }

    // Update byte offset to current file size
    this.fileStates.set(filePath, {
      headerColumns,
      byteOffset: Buffer.byteLength(content, "utf-8"),
    });

    return ticks;
  }

  private parseLine(
    headers: string[],
    line: string,
    filePath: string
  ): DataTick | null {
    const values = line.split(",").map((v) => v.trim());
    if (values.length !== headers.length) return null;

    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]!] = values[i]!;
    }

    // Resolve column names through columnMap
    const resolve = (standard: string): string => {
      return this.columnMap[standard] ?? standard;
    };

    const timestampStr = row[resolve("timestamp")];
    if (!timestampStr) return null;

    const timestamp = Number(timestampStr);
    if (Number.isNaN(timestamp)) return null;

    // Build metrics from all numeric columns except timestamp
    const metrics: Record<string, number> = {};
    const timestampCol = resolve("timestamp");

    for (const [col, val] of Object.entries(row)) {
      if (col === timestampCol) continue;

      // Find the standard name for this column (reverse lookup)
      const standardName = this.reverseMapColumn(col);
      const num = Number(val);
      if (!Number.isNaN(num)) {
        metrics[standardName] = num;
      }
    }

    if (Object.keys(metrics).length === 0) return null;

    return {
      sourceId: this.id,
      timestamp,
      symbol: this.symbol || undefined,
      metrics,
      metadata: {
        file: path.basename(filePath),
      },
    };
  }

  private reverseMapColumn(csvColumn: string): string {
    // Check if any standard name maps to this csv column
    for (const [standard, mapped] of Object.entries(this.columnMap)) {
      if (mapped === csvColumn) return standard;
    }
    // No mapping found, use the csv column name as-is
    return csvColumn;
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
      latencyMs: 0,
    };
  }
}
```

### Step 4: Run tests, verify PASS

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run agent/src/ingestion/__tests__/csv-file-source.test.ts
```

Expected: All 12 tests pass.

Also verify all previous tests still pass:

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run --project agent
```

### Step 5: Commit

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && git add agent/src/ingestion/csv-file-source.ts agent/src/ingestion/__tests__/csv-file-source.test.ts && git commit -m "feat(ingestion): add CSV file adapter with incremental reads and column mapping

Watch directory for CSV files, parse rows into DataTick with byte-offset
tracking for incremental reads, configurable column mapping, and
graceful handling of malformed rows.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2A.4: DataTick Normalization Layer

**Goal:** Ensure all sources output identically shaped `DataTick` values with standard metric names. The normalizer validates required fields, coerces metric names to a canonical set (e.g. `price` -> `close`, `vol` -> `volume`), and rejects malformed ticks.

**Files:**
- Create: `agent/src/ingestion/__tests__/normalizer.test.ts`
- Create: `agent/src/ingestion/normalizer.ts`

### Step 1: Write failing tests

Create `agent/src/ingestion/__tests__/normalizer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import type { DataTick } from "@finwatch/shared";
import { normalizeTick, normalizeBatch, NormalizationError } from "../normalizer.js";

function makeTick(overrides: Partial<DataTick> = {}): DataTick {
  return {
    sourceId: "test-source",
    timestamp: 1706745600,
    symbol: "AAPL",
    metrics: { close: 184.4 },
    metadata: {},
    ...overrides,
  };
}

describe("normalizeTick", () => {
  it("passes through a valid tick unchanged", () => {
    const tick = makeTick({
      metrics: { open: 183.92, high: 185.09, low: 182.41, close: 184.4, volume: 49120300 },
    });
    const result = normalizeTick(tick);
    expect(result.sourceId).toBe("test-source");
    expect(result.timestamp).toBe(1706745600);
    expect(result.metrics.close).toBe(184.4);
  });

  it("maps aliased metric names to canonical names", () => {
    const tick = makeTick({
      metrics: { price: 184.4, vol: 49120300 },
    });
    const result = normalizeTick(tick);
    expect(result.metrics.close).toBe(184.4);
    expect(result.metrics.volume).toBe(49120300);
    expect(result.metrics).not.toHaveProperty("price");
    expect(result.metrics).not.toHaveProperty("vol");
  });

  it("normalizes 'last' to 'close'", () => {
    const tick = makeTick({ metrics: { last: 184.4 } });
    const result = normalizeTick(tick);
    expect(result.metrics.close).toBe(184.4);
  });

  it("normalizes 'adj_close' and 'adjclose' to 'adjustedClose'", () => {
    const tick1 = makeTick({ metrics: { adj_close: 184.4 } });
    expect(normalizeTick(tick1).metrics.adjustedClose).toBe(184.4);

    const tick2 = makeTick({ metrics: { adjclose: 185.0 } });
    expect(normalizeTick(tick2).metrics.adjustedClose).toBe(185.0);
  });

  it("preserves non-aliased metric names as-is", () => {
    const tick = makeTick({
      metrics: { close: 184.4, rsi: 65.3, macd: 1.2 },
    });
    const result = normalizeTick(tick);
    expect(result.metrics.rsi).toBe(65.3);
    expect(result.metrics.macd).toBe(1.2);
  });

  it("throws NormalizationError for missing sourceId", () => {
    const tick = makeTick({ sourceId: "" });
    expect(() => normalizeTick(tick)).toThrow(NormalizationError);
    expect(() => normalizeTick(tick)).toThrow("sourceId is required");
  });

  it("throws NormalizationError for missing timestamp", () => {
    const tick = makeTick({ timestamp: 0 });
    expect(() => normalizeTick(tick)).toThrow(NormalizationError);
    expect(() => normalizeTick(tick)).toThrow("timestamp must be positive");
  });

  it("throws NormalizationError for negative timestamp", () => {
    const tick = makeTick({ timestamp: -1 });
    expect(() => normalizeTick(tick)).toThrow(NormalizationError);
  });

  it("throws NormalizationError for empty metrics", () => {
    const tick = makeTick({ metrics: {} });
    expect(() => normalizeTick(tick)).toThrow(NormalizationError);
    expect(() => normalizeTick(tick)).toThrow("at least one metric");
  });

  it("throws NormalizationError for non-finite metric value", () => {
    const tick = makeTick({ metrics: { close: NaN } });
    expect(() => normalizeTick(tick)).toThrow(NormalizationError);
  });

  it("throws NormalizationError for Infinity metric value", () => {
    const tick = makeTick({ metrics: { close: Infinity } });
    expect(() => normalizeTick(tick)).toThrow(NormalizationError);
  });

  it("trims whitespace from symbol", () => {
    const tick = makeTick({ symbol: "  AAPL  " });
    const result = normalizeTick(tick);
    expect(result.symbol).toBe("AAPL");
  });

  it("uppercases symbol", () => {
    const tick = makeTick({ symbol: "aapl" });
    const result = normalizeTick(tick);
    expect(result.symbol).toBe("AAPL");
  });

  it("preserves undefined symbol as undefined", () => {
    const tick = makeTick({ symbol: undefined });
    const result = normalizeTick(tick);
    expect(result.symbol).toBeUndefined();
  });

  it("always includes metadata object even if source omits it", () => {
    const tick: DataTick = {
      sourceId: "src",
      timestamp: 1706745600,
      metrics: { close: 100 },
      metadata: {},
    };
    const result = normalizeTick(tick);
    expect(result.metadata).toBeDefined();
    expect(typeof result.metadata).toBe("object");
  });
});

describe("normalizeBatch", () => {
  it("normalizes all ticks in a batch", () => {
    const ticks = [
      makeTick({ metrics: { price: 184.4 } }),
      makeTick({ metrics: { close: 185.0 } }),
    ];
    const result = normalizeBatch(ticks);
    expect(result).toHaveLength(2);
    expect(result[0]!.metrics.close).toBe(184.4);
    expect(result[1]!.metrics.close).toBe(185.0);
  });

  it("filters out invalid ticks and returns only valid ones", () => {
    const ticks = [
      makeTick({ metrics: { close: 184.4 } }),
      makeTick({ sourceId: "", metrics: { close: 185.0 } }), // invalid
      makeTick({ metrics: { close: 186.0 } }),
    ];
    const result = normalizeBatch(ticks, { skipInvalid: true });
    expect(result).toHaveLength(2);
  });

  it("throws on first invalid tick when skipInvalid is false", () => {
    const ticks = [
      makeTick({ metrics: { close: 184.4 } }),
      makeTick({ sourceId: "" }), // invalid
    ];
    expect(() => normalizeBatch(ticks)).toThrow(NormalizationError);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeBatch([])).toEqual([]);
  });
});
```

### Step 2: Run tests, verify FAIL

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run agent/src/ingestion/__tests__/normalizer.test.ts
```

Expected: All tests fail because `normalizer.ts` does not exist.

### Step 3: Write implementation

Create `agent/src/ingestion/normalizer.ts`:

```typescript
import type { DataTick } from "@finwatch/shared";

export class NormalizationError extends Error {
  constructor(message: string, public readonly tick?: Partial<DataTick>) {
    super(message);
    this.name = "NormalizationError";
  }
}

/**
 * Alias map: source metric name -> canonical name.
 * Keys are lowercase for case-insensitive matching.
 */
const METRIC_ALIASES: Record<string, string> = {
  price: "close",
  last: "close",
  vol: "volume",
  adj_close: "adjustedClose",
  adjclose: "adjustedClose",
  adjusted_close: "adjustedClose",
};

function canonicalizeMetricName(name: string): string {
  const lower = name.toLowerCase();
  return METRIC_ALIASES[lower] ?? name;
}

export function normalizeTick(tick: DataTick): DataTick {
  // Validate required fields
  if (!tick.sourceId || tick.sourceId.trim().length === 0) {
    throw new NormalizationError("sourceId is required", tick);
  }

  if (!tick.timestamp || tick.timestamp <= 0) {
    throw new NormalizationError("timestamp must be positive", tick);
  }

  if (!tick.metrics || Object.keys(tick.metrics).length === 0) {
    throw new NormalizationError("at least one metric is required", tick);
  }

  // Normalize metrics: rename aliases and validate values
  const normalizedMetrics: Record<string, number> = {};

  for (const [key, value] of Object.entries(tick.metrics)) {
    if (!Number.isFinite(value)) {
      throw new NormalizationError(
        `metric '${key}' has non-finite value: ${value}`,
        tick
      );
    }

    const canonical = canonicalizeMetricName(key);
    normalizedMetrics[canonical] = value;
  }

  // Normalize symbol
  let symbol = tick.symbol;
  if (symbol !== undefined) {
    symbol = symbol.trim().toUpperCase();
    if (symbol.length === 0) {
      symbol = undefined;
    }
  }

  return {
    sourceId: tick.sourceId,
    timestamp: tick.timestamp,
    symbol,
    metrics: normalizedMetrics,
    metadata: tick.metadata ?? {},
    raw: tick.raw,
  };
}

export type NormalizeBatchOptions = {
  skipInvalid?: boolean;
};

export function normalizeBatch(
  ticks: DataTick[],
  options: NormalizeBatchOptions = {}
): DataTick[] {
  const { skipInvalid = false } = options;
  const results: DataTick[] = [];

  for (const tick of ticks) {
    if (skipInvalid) {
      try {
        results.push(normalizeTick(tick));
      } catch {
        // Skip invalid ticks silently
      }
    } else {
      results.push(normalizeTick(tick));
    }
  }

  return results;
}
```

### Step 4: Run tests, verify PASS

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run agent/src/ingestion/__tests__/normalizer.test.ts
```

Expected: All 18 tests pass.

Also verify all previous tests still pass:

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run --project agent
```

### Step 5: Commit

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && git add agent/src/ingestion/normalizer.ts agent/src/ingestion/__tests__/normalizer.test.ts && git commit -m "feat(ingestion): add DataTick normalizer with metric alias mapping and validation

Canonicalize metric names (price->close, vol->volume), validate
required fields, reject non-finite values, uppercase symbols, and
support batch normalization with skipInvalid mode.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2A.5: Event Stream + DataBuffer

**Goal:** Build an event-driven buffer that accumulates `DataTick` values and flushes them as batches. `nextBatch()` returns a Promise that resolves either when a configurable time interval elapses or when an urgent tick is pushed (pre-screen score > threshold). Uses `EventEmitter` pattern.

**Files:**
- Create: `agent/src/ingestion/__tests__/data-buffer.test.ts`
- Create: `agent/src/ingestion/data-buffer.ts`

### Step 1: Write failing tests

Create `agent/src/ingestion/__tests__/data-buffer.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DataTick } from "@finwatch/shared";
import { DataBuffer } from "../data-buffer.js";

function makeTick(overrides: Partial<DataTick> = {}): DataTick {
  return {
    sourceId: "test",
    timestamp: Date.now(),
    metrics: { close: 100 },
    metadata: {},
    ...overrides,
  };
}

describe("DataBuffer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("accumulates ticks via push()", () => {
    const buffer = new DataBuffer({ flushIntervalMs: 5000, urgentThreshold: 0.8 });
    buffer.push(makeTick());
    buffer.push(makeTick());
    expect(buffer.size).toBe(2);
  });

  it("nextBatch() resolves after flush interval with accumulated ticks", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 1000, urgentThreshold: 0.8 });
    buffer.push(makeTick({ metrics: { close: 100 } }));
    buffer.push(makeTick({ metrics: { close: 101 } }));

    const batchPromise = buffer.nextBatch();

    // Advance time past interval
    vi.advanceTimersByTime(1100);

    const batch = await batchPromise;
    expect(batch).toHaveLength(2);
    expect(batch[0]!.metrics.close).toBe(100);
    expect(batch[1]!.metrics.close).toBe(101);
  });

  it("buffer is empty after nextBatch() resolves", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 1000, urgentThreshold: 0.8 });
    buffer.push(makeTick());

    const batchPromise = buffer.nextBatch();
    vi.advanceTimersByTime(1100);
    await batchPromise;

    expect(buffer.size).toBe(0);
  });

  it("nextBatch() resolves immediately when urgent tick is pushed", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 60000, urgentThreshold: 0.6 });

    buffer.push(makeTick({ metrics: { close: 100 } }));
    const batchPromise = buffer.nextBatch();

    // Push an urgent tick (preScreenScore above threshold)
    buffer.pushUrgent(makeTick({ metrics: { close: 200 } }), 0.9);

    const batch = await batchPromise;
    expect(batch).toHaveLength(2);
  });

  it("urgent push below threshold does not trigger immediate flush", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 5000, urgentThreshold: 0.8 });

    buffer.push(makeTick());
    const batchPromise = buffer.nextBatch();

    // Push a tick with score below threshold
    buffer.pushUrgent(makeTick(), 0.5);

    // Should not resolve yet
    let resolved = false;
    batchPromise.then(() => {
      resolved = true;
    });

    // Give microtasks a chance to run
    await vi.advanceTimersByTimeAsync(100);
    expect(resolved).toBe(false);

    // Now advance past interval
    vi.advanceTimersByTime(5000);
    const batch = await batchPromise;
    expect(batch).toHaveLength(2);
  });

  it("emits 'flush' event when batch is flushed", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 1000, urgentThreshold: 0.8 });
    const flushHandler = vi.fn();
    buffer.on("flush", flushHandler);

    buffer.push(makeTick());
    const batchPromise = buffer.nextBatch();
    vi.advanceTimersByTime(1100);
    await batchPromise;

    expect(flushHandler).toHaveBeenCalledOnce();
    expect(flushHandler).toHaveBeenCalledWith(expect.any(Array));
  });

  it("emits 'urgent' event when urgent tick triggers flush", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 60000, urgentThreshold: 0.6 });
    const urgentHandler = vi.fn();
    buffer.on("urgent", urgentHandler);

    buffer.push(makeTick());
    const batchPromise = buffer.nextBatch();
    buffer.pushUrgent(makeTick(), 0.9);
    await batchPromise;

    expect(urgentHandler).toHaveBeenCalledOnce();
    expect(urgentHandler).toHaveBeenCalledWith(expect.objectContaining({
      score: 0.9,
    }));
  });

  it("multiple nextBatch() calls queue up and resolve in order", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 1000, urgentThreshold: 0.8 });

    buffer.push(makeTick({ metrics: { close: 100 } }));
    const batch1Promise = buffer.nextBatch();

    vi.advanceTimersByTime(1100);
    const batch1 = await batch1Promise;
    expect(batch1).toHaveLength(1);
    expect(batch1[0]!.metrics.close).toBe(100);

    buffer.push(makeTick({ metrics: { close: 200 } }));
    const batch2Promise = buffer.nextBatch();

    vi.advanceTimersByTime(1100);
    const batch2 = await batch2Promise;
    expect(batch2).toHaveLength(1);
    expect(batch2[0]!.metrics.close).toBe(200);
  });

  it("nextBatch() resolves with empty array if no ticks after interval", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 1000, urgentThreshold: 0.8 });

    const batchPromise = buffer.nextBatch();
    vi.advanceTimersByTime(1100);
    const batch = await batchPromise;

    expect(batch).toEqual([]);
  });

  it("destroy() cleans up timers and rejects pending nextBatch()", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 60000, urgentThreshold: 0.8 });
    buffer.push(makeTick());

    const batchPromise = buffer.nextBatch();
    buffer.destroy();

    await expect(batchPromise).rejects.toThrow("Buffer destroyed");
  });

  it("push after destroy throws", () => {
    const buffer = new DataBuffer({ flushIntervalMs: 1000, urgentThreshold: 0.8 });
    buffer.destroy();

    expect(() => buffer.push(makeTick())).toThrow("Buffer destroyed");
  });

  it("reports correct size as ticks accumulate and flush", async () => {
    const buffer = new DataBuffer({ flushIntervalMs: 1000, urgentThreshold: 0.8 });

    expect(buffer.size).toBe(0);
    buffer.push(makeTick());
    expect(buffer.size).toBe(1);
    buffer.push(makeTick());
    buffer.push(makeTick());
    expect(buffer.size).toBe(3);

    const batchPromise = buffer.nextBatch();
    vi.advanceTimersByTime(1100);
    await batchPromise;
    expect(buffer.size).toBe(0);
  });
});
```

### Step 2: Run tests, verify FAIL

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run agent/src/ingestion/__tests__/data-buffer.test.ts
```

Expected: All tests fail because `data-buffer.ts` does not exist.

### Step 3: Write implementation

Create `agent/src/ingestion/data-buffer.ts`:

```typescript
import { EventEmitter } from "node:events";
import type { DataTick } from "@finwatch/shared";

export type DataBufferOptions = {
  flushIntervalMs: number;
  urgentThreshold: number;
};

type PendingBatch = {
  resolve: (ticks: DataTick[]) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class DataBuffer extends EventEmitter {
  private ticks: DataTick[] = [];
  private pending: PendingBatch | null = null;
  private destroyed = false;
  private readonly flushIntervalMs: number;
  private readonly urgentThreshold: number;

  constructor(options: DataBufferOptions) {
    super();
    this.flushIntervalMs = options.flushIntervalMs;
    this.urgentThreshold = options.urgentThreshold;
  }

  get size(): number {
    return this.ticks.length;
  }

  push(tick: DataTick): void {
    if (this.destroyed) {
      throw new Error("Buffer destroyed");
    }
    this.ticks.push(tick);
  }

  pushUrgent(tick: DataTick, score: number): void {
    if (this.destroyed) {
      throw new Error("Buffer destroyed");
    }
    this.ticks.push(tick);

    if (score >= this.urgentThreshold && this.pending) {
      this.emit("urgent", { score, tick });
      this.flush();
    }
  }

  nextBatch(): Promise<DataTick[]> {
    if (this.destroyed) {
      return Promise.reject(new Error("Buffer destroyed"));
    }

    return new Promise<DataTick[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.flush();
      }, this.flushIntervalMs);

      // Allow timer to not prevent process exit in tests
      if (typeof timer === "object" && "unref" in timer) {
        timer.unref();
      }

      this.pending = { resolve, reject, timer };
    });
  }

  private flush(): void {
    if (!this.pending) return;

    const { resolve, timer } = this.pending;
    clearTimeout(timer);
    this.pending = null;

    const batch = [...this.ticks];
    this.ticks = [];

    this.emit("flush", batch);
    resolve(batch);
  }

  destroy(): void {
    this.destroyed = true;

    if (this.pending) {
      const { reject, timer } = this.pending;
      clearTimeout(timer);
      this.pending = null;
      reject(new Error("Buffer destroyed"));
    }

    this.ticks = [];
    this.removeAllListeners();
  }
}
```

### Step 4: Run tests, verify PASS

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run agent/src/ingestion/__tests__/data-buffer.test.ts
```

Expected: All 12 tests pass.

Also verify all previous tests still pass:

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run --project agent
```

### Step 5: Commit

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && git add agent/src/ingestion/data-buffer.ts agent/src/ingestion/__tests__/data-buffer.test.ts && git commit -m "feat(ingestion): add DataBuffer with interval flush and urgent-tick bypass

EventEmitter-based buffer that accumulates DataTicks and flushes via
nextBatch() on configurable interval or immediately when an urgent tick
(pre-screen score above threshold) is pushed.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2A.6: Source Health Monitor

**Goal:** Build a health monitor that periodically calls `healthCheck()` on each registered source, tracks consecutive failures, and emits `degraded` / `offline` events when status changes. Integrates with `SourceRegistry`.

**Files:**
- Create: `agent/src/ingestion/__tests__/health-monitor.test.ts`
- Create: `agent/src/ingestion/health-monitor.ts`

### Step 1: Write failing tests

Create `agent/src/ingestion/__tests__/health-monitor.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SourceHealth } from "@finwatch/shared";
import type { DataSource } from "../types.js";
import { SourceRegistry } from "../source-registry.js";
import { HealthMonitor } from "../health-monitor.js";

function createMockSource(
  id: string,
  healthResult: SourceHealth
): DataSource {
  return {
    id,
    config: {
      id,
      name: `Source ${id}`,
      type: "polling",
      plugin: "mock",
      config: {},
      enabled: true,
    },
    start: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    stop: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    healthCheck: vi.fn<[], Promise<SourceHealth>>().mockResolvedValue(healthResult),
    fetch: vi.fn().mockResolvedValue([]),
  };
}

function healthyResult(id: string): SourceHealth {
  return {
    sourceId: id,
    status: "healthy",
    lastSuccess: Date.now(),
    failCount: 0,
    latencyMs: 10,
  };
}

function degradedResult(id: string): SourceHealth {
  return {
    sourceId: id,
    status: "degraded",
    lastSuccess: Date.now() - 30000,
    failCount: 2,
    latencyMs: 500,
    message: "high latency",
  };
}

function offlineResult(id: string): SourceHealth {
  return {
    sourceId: id,
    status: "offline",
    lastSuccess: 0,
    failCount: 5,
    latencyMs: -1,
    message: "connection refused",
  };
}

describe("HealthMonitor", () => {
  let registry: SourceRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    registry = new SourceRegistry();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("constructs with registry and check interval", () => {
    const monitor = new HealthMonitor(registry, { checkIntervalMs: 5000 });
    expect(monitor).toBeDefined();
    monitor.stop();
  });

  it("runs health check on all sources at the configured interval", async () => {
    const source = createMockSource("s1", healthyResult("s1"));
    registry.register(source);

    const monitor = new HealthMonitor(registry, { checkIntervalMs: 1000 });
    monitor.start();

    // Advance past first interval
    await vi.advanceTimersByTimeAsync(1100);

    expect(source.healthCheck).toHaveBeenCalledOnce();

    // Advance past second interval
    await vi.advanceTimersByTimeAsync(1000);
    expect(source.healthCheck).toHaveBeenCalledTimes(2);

    monitor.stop();
  });

  it("emits 'health-change' when source status transitions", async () => {
    const source = createMockSource("s1", healthyResult("s1"));
    registry.register(source);

    const monitor = new HealthMonitor(registry, { checkIntervalMs: 1000 });
    const changeHandler = vi.fn();
    monitor.on("health-change", changeHandler);
    monitor.start();

    // First check: healthy (initial)
    await vi.advanceTimersByTimeAsync(1100);
    // First report always emits since status is new
    expect(changeHandler).toHaveBeenCalledTimes(1);

    // Change to degraded
    (source.healthCheck as ReturnType<typeof vi.fn>).mockResolvedValue(
      degradedResult("s1")
    );
    await vi.advanceTimersByTimeAsync(1000);

    expect(changeHandler).toHaveBeenCalledTimes(2);
    const lastCall = changeHandler.mock.calls[1]![0] as SourceHealth;
    expect(lastCall.status).toBe("degraded");

    monitor.stop();
  });

  it("does not emit when status stays the same", async () => {
    const source = createMockSource("s1", healthyResult("s1"));
    registry.register(source);

    const monitor = new HealthMonitor(registry, { checkIntervalMs: 1000 });
    const changeHandler = vi.fn();
    monitor.on("health-change", changeHandler);
    monitor.start();

    // First check
    await vi.advanceTimersByTimeAsync(1100);
    expect(changeHandler).toHaveBeenCalledTimes(1);

    // Second check with same status
    await vi.advanceTimersByTimeAsync(1000);
    expect(changeHandler).toHaveBeenCalledTimes(1); // no new emission

    monitor.stop();
  });

  it("emits 'offline' event when source goes offline", async () => {
    const source = createMockSource("s1", healthyResult("s1"));
    registry.register(source);

    const monitor = new HealthMonitor(registry, { checkIntervalMs: 1000 });
    const offlineHandler = vi.fn();
    monitor.on("offline", offlineHandler);
    monitor.start();

    // First check: healthy
    await vi.advanceTimersByTimeAsync(1100);

    // Go offline
    (source.healthCheck as ReturnType<typeof vi.fn>).mockResolvedValue(
      offlineResult("s1")
    );
    await vi.advanceTimersByTimeAsync(1000);

    expect(offlineHandler).toHaveBeenCalledOnce();
    expect(offlineHandler.mock.calls[0]![0]).toBe("s1");

    monitor.stop();
  });

  it("emits 'degraded' event when source degrades", async () => {
    const source = createMockSource("s1", healthyResult("s1"));
    registry.register(source);

    const monitor = new HealthMonitor(registry, { checkIntervalMs: 1000 });
    const degradedHandler = vi.fn();
    monitor.on("degraded", degradedHandler);
    monitor.start();

    await vi.advanceTimersByTimeAsync(1100);

    (source.healthCheck as ReturnType<typeof vi.fn>).mockResolvedValue(
      degradedResult("s1")
    );
    await vi.advanceTimersByTimeAsync(1000);

    expect(degradedHandler).toHaveBeenCalledOnce();
    expect(degradedHandler.mock.calls[0]![0]).toBe("s1");

    monitor.stop();
  });

  it("emits 'recovered' when source returns to healthy", async () => {
    const source = createMockSource("s1", degradedResult("s1"));
    registry.register(source);

    const monitor = new HealthMonitor(registry, { checkIntervalMs: 1000 });
    const recoveredHandler = vi.fn();
    monitor.on("recovered", recoveredHandler);
    monitor.start();

    // First check: degraded
    await vi.advanceTimersByTimeAsync(1100);

    // Recover
    (source.healthCheck as ReturnType<typeof vi.fn>).mockResolvedValue(
      healthyResult("s1")
    );
    await vi.advanceTimersByTimeAsync(1000);

    expect(recoveredHandler).toHaveBeenCalledOnce();
    expect(recoveredHandler.mock.calls[0]![0]).toBe("s1");

    monitor.stop();
  });

  it("getHealth() returns latest health map for all sources", async () => {
    registry.register(createMockSource("s1", healthyResult("s1")));
    registry.register(createMockSource("s2", degradedResult("s2")));

    const monitor = new HealthMonitor(registry, { checkIntervalMs: 1000 });
    monitor.start();

    await vi.advanceTimersByTimeAsync(1100);

    const healthMap = monitor.getHealth();
    expect(healthMap.get("s1")?.status).toBe("healthy");
    expect(healthMap.get("s2")?.status).toBe("degraded");

    monitor.stop();
  });

  it("handles healthCheck() that throws an error", async () => {
    const source = createMockSource("s1", healthyResult("s1"));
    (source.healthCheck as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network error")
    );
    registry.register(source);

    const monitor = new HealthMonitor(registry, { checkIntervalMs: 1000 });
    const changeHandler = vi.fn();
    monitor.on("health-change", changeHandler);
    monitor.start();

    await vi.advanceTimersByTimeAsync(1100);

    expect(changeHandler).toHaveBeenCalledOnce();
    const health = changeHandler.mock.calls[0]![0] as SourceHealth;
    expect(health.status).toBe("offline");
    expect(health.message).toContain("network error");

    monitor.stop();
  });

  it("stop() clears the interval and prevents further checks", async () => {
    const source = createMockSource("s1", healthyResult("s1"));
    registry.register(source);

    const monitor = new HealthMonitor(registry, { checkIntervalMs: 1000 });
    monitor.start();

    await vi.advanceTimersByTimeAsync(1100);
    expect(source.healthCheck).toHaveBeenCalledTimes(1);

    monitor.stop();

    await vi.advanceTimersByTimeAsync(5000);
    expect(source.healthCheck).toHaveBeenCalledTimes(1); // no more calls
  });

  it("start() is idempotent", async () => {
    const source = createMockSource("s1", healthyResult("s1"));
    registry.register(source);

    const monitor = new HealthMonitor(registry, { checkIntervalMs: 1000 });
    monitor.start();
    monitor.start(); // no-op

    await vi.advanceTimersByTimeAsync(1100);
    expect(source.healthCheck).toHaveBeenCalledTimes(1);

    monitor.stop();
  });
});
```

### Step 2: Run tests, verify FAIL

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run agent/src/ingestion/__tests__/health-monitor.test.ts
```

Expected: All tests fail because `health-monitor.ts` does not exist.

### Step 3: Write implementation

Create `agent/src/ingestion/health-monitor.ts`:

```typescript
import { EventEmitter } from "node:events";
import type { SourceHealth } from "@finwatch/shared";
import type { SourceRegistry } from "./source-registry.js";

export type HealthMonitorOptions = {
  checkIntervalMs: number;
};

export class HealthMonitor extends EventEmitter {
  private registry: SourceRegistry;
  private checkIntervalMs: number;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private lastStatus = new Map<string, SourceHealth>();
  private started = false;

  constructor(registry: SourceRegistry, options: HealthMonitorOptions) {
    super();
    this.registry = registry;
    this.checkIntervalMs = options.checkIntervalMs;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.intervalHandle = setInterval(() => {
      this.checkAll().catch(() => {
        // Swallow errors from the periodic check itself
      });
    }, this.checkIntervalMs);

    // Don't block process exit
    if (typeof this.intervalHandle === "object" && "unref" in this.intervalHandle) {
      this.intervalHandle.unref();
    }
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;

    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  getHealth(): Map<string, SourceHealth> {
    return new Map(this.lastStatus);
  }

  private async checkAll(): Promise<void> {
    const sources = this.registry.list();

    const checks = sources.map(async (source) => {
      let health: SourceHealth;

      try {
        health = await source.healthCheck();
      } catch (err) {
        health = {
          sourceId: source.id,
          status: "offline",
          lastSuccess: 0,
          failCount: 0,
          latencyMs: -1,
          message: err instanceof Error ? err.message : "Unknown error",
        };
      }

      const previous = this.lastStatus.get(source.id);
      this.lastStatus.set(source.id, health);

      // Emit on status change
      if (!previous || previous.status !== health.status) {
        this.emit("health-change", health);

        if (health.status === "offline") {
          this.emit("offline", source.id);
        } else if (health.status === "degraded") {
          this.emit("degraded", source.id);
        } else if (
          health.status === "healthy" &&
          previous &&
          previous.status !== "healthy"
        ) {
          this.emit("recovered", source.id);
        }
      }
    });

    await Promise.all(checks);
  }
}
```

### Step 4: Run tests, verify PASS

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run agent/src/ingestion/__tests__/health-monitor.test.ts
```

Expected: All 11 tests pass.

Also verify all previous tests still pass:

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run --project agent
```

### Step 5: Commit

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && git add agent/src/ingestion/health-monitor.ts agent/src/ingestion/__tests__/health-monitor.test.ts && git commit -m "feat(ingestion): add HealthMonitor with periodic checks and status change events

Periodically call healthCheck() on all registered sources, track status
transitions, emit degraded/offline/recovered events on state changes,
and expose getHealth() map.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2A.7: Polling Scheduler

**Goal:** Build a polling scheduler that manages per-source poll intervals, calls `fetch()` on each source at its configured `pollIntervalMs`, applies exponential backoff on errors, and feeds results into the `DataBuffer`.

**Files:**
- Create: `agent/src/ingestion/__tests__/polling-scheduler.test.ts`
- Create: `agent/src/ingestion/polling-scheduler.ts`

### Step 1: Write failing tests

Create `agent/src/ingestion/__tests__/polling-scheduler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DataTick, SourceHealth, SourceConfig } from "@finwatch/shared";
import type { DataSource } from "../types.js";
import { PollingScheduler } from "../polling-scheduler.js";

function createMockSource(
  id: string,
  pollIntervalMs: number,
  ticks: DataTick[] = []
): DataSource {
  return {
    id,
    config: {
      id,
      name: `Source ${id}`,
      type: "polling",
      plugin: "mock",
      config: {},
      pollIntervalMs,
      enabled: true,
    },
    start: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    stop: vi.fn<[], Promise<void>>().mockResolvedValue(undefined),
    healthCheck: vi.fn<[], Promise<SourceHealth>>().mockResolvedValue({
      sourceId: id,
      status: "healthy",
      lastSuccess: Date.now(),
      failCount: 0,
      latencyMs: 10,
    }),
    fetch: vi.fn<[], Promise<DataTick[]>>().mockResolvedValue(ticks),
  };
}

function makeTick(sourceId: string): DataTick {
  return {
    sourceId,
    timestamp: Date.now(),
    metrics: { close: 100 },
    metadata: {},
  };
}

describe("PollingScheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("constructs with default options", () => {
    const scheduler = new PollingScheduler();
    expect(scheduler).toBeDefined();
    scheduler.stopAll();
  });

  it("schedules a source and calls fetch at its pollIntervalMs", async () => {
    const source = createMockSource("s1", 2000, [makeTick("s1")]);

    const scheduler = new PollingScheduler();
    const onTicks = vi.fn();
    scheduler.on("ticks", onTicks);

    scheduler.schedule(source);

    // Advance past first interval
    await vi.advanceTimersByTimeAsync(2100);

    expect(source.fetch).toHaveBeenCalledOnce();
    expect(onTicks).toHaveBeenCalledOnce();
    expect(onTicks.mock.calls[0]![0]).toHaveLength(1);

    scheduler.stopAll();
  });

  it("polls repeatedly at the configured interval", async () => {
    const source = createMockSource("s1", 1000, [makeTick("s1")]);

    const scheduler = new PollingScheduler();
    scheduler.schedule(source);

    await vi.advanceTimersByTimeAsync(3100);

    expect(source.fetch).toHaveBeenCalledTimes(3);

    scheduler.stopAll();
  });

  it("uses default interval when source has no pollIntervalMs", async () => {
    const source = createMockSource("s1", 0, [makeTick("s1")]);
    // Remove pollIntervalMs
    (source.config as { pollIntervalMs?: number }).pollIntervalMs = undefined;

    const scheduler = new PollingScheduler({ defaultIntervalMs: 5000 });
    scheduler.schedule(source);

    await vi.advanceTimersByTimeAsync(5100);
    expect(source.fetch).toHaveBeenCalledOnce();

    scheduler.stopAll();
  });

  it("applies exponential backoff on fetch error", async () => {
    const source = createMockSource("s1", 1000);
    (source.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network error")
    );

    const scheduler = new PollingScheduler({
      maxBackoffMs: 16000,
      backoffMultiplier: 2,
    });
    const errorHandler = vi.fn();
    scheduler.on("error", errorHandler);
    scheduler.schedule(source);

    // First attempt at 1000ms (base interval)
    await vi.advanceTimersByTimeAsync(1100);
    expect(source.fetch).toHaveBeenCalledTimes(1);
    expect(errorHandler).toHaveBeenCalledTimes(1);

    // Second attempt at 2000ms (1000 * 2^1 backoff)
    await vi.advanceTimersByTimeAsync(2100);
    expect(source.fetch).toHaveBeenCalledTimes(2);

    // Third attempt at 4000ms (1000 * 2^2 backoff)
    await vi.advanceTimersByTimeAsync(4100);
    expect(source.fetch).toHaveBeenCalledTimes(3);

    scheduler.stopAll();
  });

  it("resets backoff after a successful fetch", async () => {
    const source = createMockSource("s1", 1000, [makeTick("s1")]);
    const fetchMock = source.fetch as ReturnType<typeof vi.fn>;

    // Fail first, succeed second
    fetchMock
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce([makeTick("s1")])
      .mockResolvedValue([makeTick("s1")]);

    const scheduler = new PollingScheduler({ backoffMultiplier: 2 });
    scheduler.schedule(source);

    // First attempt at 1000ms - fails
    await vi.advanceTimersByTimeAsync(1100);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second attempt at 2000ms (backed off) - succeeds
    await vi.advanceTimersByTimeAsync(2100);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Third attempt should be back to 1000ms (reset)
    await vi.advanceTimersByTimeAsync(1100);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    scheduler.stopAll();
  });

  it("caps backoff at maxBackoffMs", async () => {
    const source = createMockSource("s1", 1000);
    (source.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("fail")
    );

    const scheduler = new PollingScheduler({
      maxBackoffMs: 4000,
      backoffMultiplier: 2,
    });
    scheduler.schedule(source);

    // 1st: 1000ms
    await vi.advanceTimersByTimeAsync(1100);
    expect(source.fetch).toHaveBeenCalledTimes(1);

    // 2nd: 2000ms
    await vi.advanceTimersByTimeAsync(2100);
    expect(source.fetch).toHaveBeenCalledTimes(2);

    // 3rd: 4000ms (capped)
    await vi.advanceTimersByTimeAsync(4100);
    expect(source.fetch).toHaveBeenCalledTimes(3);

    // 4th: still 4000ms (capped, not 8000)
    await vi.advanceTimersByTimeAsync(4100);
    expect(source.fetch).toHaveBeenCalledTimes(4);

    scheduler.stopAll();
  });

  it("unschedules a specific source", async () => {
    const source = createMockSource("s1", 1000, [makeTick("s1")]);
    const scheduler = new PollingScheduler();
    scheduler.schedule(source);

    await vi.advanceTimersByTimeAsync(1100);
    expect(source.fetch).toHaveBeenCalledTimes(1);

    scheduler.unschedule("s1");

    await vi.advanceTimersByTimeAsync(3000);
    expect(source.fetch).toHaveBeenCalledTimes(1); // no more calls
  });

  it("stopAll cancels all scheduled sources", async () => {
    const s1 = createMockSource("s1", 1000, [makeTick("s1")]);
    const s2 = createMockSource("s2", 2000, [makeTick("s2")]);

    const scheduler = new PollingScheduler();
    scheduler.schedule(s1);
    scheduler.schedule(s2);

    scheduler.stopAll();

    await vi.advanceTimersByTimeAsync(5000);
    expect(s1.fetch).not.toHaveBeenCalled();
    expect(s2.fetch).not.toHaveBeenCalled();
  });

  it("emits 'ticks' event with fetched data", async () => {
    const ticks = [makeTick("s1"), makeTick("s1")];
    const source = createMockSource("s1", 1000, ticks);

    const scheduler = new PollingScheduler();
    const tickHandler = vi.fn();
    scheduler.on("ticks", tickHandler);
    scheduler.schedule(source);

    await vi.advanceTimersByTimeAsync(1100);

    expect(tickHandler).toHaveBeenCalledOnce();
    expect(tickHandler.mock.calls[0]![0]).toEqual(ticks);
    expect(tickHandler.mock.calls[0]![1]).toBe("s1");

    scheduler.stopAll();
  });

  it("does not emit ticks when fetch returns empty array", async () => {
    const source = createMockSource("s1", 1000, []);

    const scheduler = new PollingScheduler();
    const tickHandler = vi.fn();
    scheduler.on("ticks", tickHandler);
    scheduler.schedule(source);

    await vi.advanceTimersByTimeAsync(1100);

    expect(tickHandler).not.toHaveBeenCalled();

    scheduler.stopAll();
  });

  it("schedules multiple sources independently", async () => {
    const s1 = createMockSource("s1", 1000, [makeTick("s1")]);
    const s2 = createMockSource("s2", 3000, [makeTick("s2")]);

    const scheduler = new PollingScheduler();
    scheduler.schedule(s1);
    scheduler.schedule(s2);

    await vi.advanceTimersByTimeAsync(3100);

    expect(s1.fetch).toHaveBeenCalledTimes(3);
    expect(s2.fetch).toHaveBeenCalledTimes(1);

    scheduler.stopAll();
  });
});
```

### Step 2: Run tests, verify FAIL

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run agent/src/ingestion/__tests__/polling-scheduler.test.ts
```

Expected: All tests fail because `polling-scheduler.ts` does not exist.

### Step 3: Write implementation

Create `agent/src/ingestion/polling-scheduler.ts`:

```typescript
import { EventEmitter } from "node:events";
import type { DataTick } from "@finwatch/shared";
import type { DataSource } from "./types.js";

export type PollingSchedulerOptions = {
  defaultIntervalMs?: number;
  maxBackoffMs?: number;
  backoffMultiplier?: number;
};

type ScheduledSource = {
  source: DataSource;
  baseIntervalMs: number;
  currentBackoff: number;
  timer: ReturnType<typeof setTimeout> | null;
};

const DEFAULT_INTERVAL_MS = 60000;
const DEFAULT_MAX_BACKOFF_MS = 300000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;

export class PollingScheduler extends EventEmitter {
  private scheduled = new Map<string, ScheduledSource>();
  private defaultIntervalMs: number;
  private maxBackoffMs: number;
  private backoffMultiplier: number;

  constructor(options: PollingSchedulerOptions = {}) {
    super();
    this.defaultIntervalMs = options.defaultIntervalMs ?? DEFAULT_INTERVAL_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.backoffMultiplier = options.backoffMultiplier ?? DEFAULT_BACKOFF_MULTIPLIER;
  }

  schedule(source: DataSource): void {
    const baseIntervalMs =
      source.config.pollIntervalMs ?? this.defaultIntervalMs;

    const entry: ScheduledSource = {
      source,
      baseIntervalMs,
      currentBackoff: 0,
      timer: null,
    };

    this.scheduled.set(source.id, entry);
    this.scheduleNext(entry);
  }

  unschedule(sourceId: string): void {
    const entry = this.scheduled.get(sourceId);
    if (entry?.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    this.scheduled.delete(sourceId);
  }

  stopAll(): void {
    for (const entry of this.scheduled.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
    }
    this.scheduled.clear();
  }

  private scheduleNext(entry: ScheduledSource): void {
    const delay =
      entry.currentBackoff > 0
        ? Math.min(
            entry.baseIntervalMs * Math.pow(this.backoffMultiplier, entry.currentBackoff),
            this.maxBackoffMs
          )
        : entry.baseIntervalMs;

    entry.timer = setTimeout(() => {
      this.poll(entry).catch(() => {
        // Error already handled in poll()
      });
    }, delay);

    // Don't block process exit
    if (typeof entry.timer === "object" && "unref" in entry.timer) {
      entry.timer.unref();
    }
  }

  private async poll(entry: ScheduledSource): Promise<void> {
    // Check if still scheduled (may have been unscheduled during timeout)
    if (!this.scheduled.has(entry.source.id)) return;

    try {
      const ticks: DataTick[] = await entry.source.fetch();

      // Reset backoff on success
      entry.currentBackoff = 0;

      if (ticks.length > 0) {
        this.emit("ticks", ticks, entry.source.id);
      }
    } catch (err) {
      entry.currentBackoff++;
      this.emit(
        "error",
        err instanceof Error ? err : new Error(String(err)),
        entry.source.id
      );
    }

    // Schedule next poll if still registered
    if (this.scheduled.has(entry.source.id)) {
      this.scheduleNext(entry);
    }
  }
}
```

### Step 4: Run tests, verify PASS

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run agent/src/ingestion/__tests__/polling-scheduler.test.ts
```

Expected: All 12 tests pass.

Also verify all previous tests still pass:

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run --project agent
```

### Step 5: Commit

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && git add agent/src/ingestion/polling-scheduler.ts agent/src/ingestion/__tests__/polling-scheduler.test.ts && git commit -m "feat(ingestion): add PollingScheduler with per-source intervals and exponential backoff

Schedule fetch() calls per source at configurable intervals, apply
exponential backoff with cap on errors, reset on success, emit ticks
and error events.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2A.8: Custom Source Loader

**Goal:** Dynamically import user-authored `.ts` source files from `~/.finwatch/sources/custom/`. Each file exports a factory function that receives a `SourceConfig` and returns a `DataSource`. The loader validates the exports, catches import errors, and registers valid sources into the `SourceRegistry`.

**Files:**
- Create: `agent/src/ingestion/__tests__/custom-source-loader.test.ts`
- Create: `agent/src/ingestion/custom-source-loader.ts`

### Step 1: Write failing tests

Create `agent/src/ingestion/__tests__/custom-source-loader.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DataTick, SourceHealth, SourceConfig } from "@finwatch/shared";
import { SourceRegistry } from "../source-registry.js";
import { CustomSourceLoader } from "../custom-source-loader.js";

const TEST_DIR = path.join(import.meta.dirname ?? ".", ".test-custom-sources");

function writeSourceFile(filename: string, content: string): string {
  const filePath = path.join(TEST_DIR, filename);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

describe("CustomSourceLoader", () => {
  let registry: SourceRegistry;

  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    registry = new SourceRegistry();
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("constructs with a registry and source directory", () => {
    const loader = new CustomSourceLoader(registry, TEST_DIR);
    expect(loader).toBeDefined();
  });

  it("loads a valid custom source file and registers it", async () => {
    writeSourceFile(
      "test-source.ts",
      `
      export const sourceConfig = {
        id: "custom-test",
        name: "Custom Test",
        type: "polling",
        plugin: "custom-test",
        config: {},
        enabled: true,
      };

      export function createSource(config) {
        return {
          id: config.id,
          config,
          start: async () => {},
          stop: async () => {},
          healthCheck: async () => ({
            sourceId: config.id,
            status: "healthy",
            lastSuccess: Date.now(),
            failCount: 0,
            latencyMs: 0,
          }),
          fetch: async () => [],
        };
      }
      `
    );

    const loader = new CustomSourceLoader(registry, TEST_DIR);
    const loaded = await loader.loadAll();

    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toBe("custom-test");
    expect(registry.get("custom-test")).toBeDefined();
  });

  it("skips files that do not export createSource function", async () => {
    writeSourceFile(
      "bad-source.ts",
      `
      export const sourceConfig = {
        id: "bad",
        name: "Bad",
        type: "polling",
        plugin: "bad",
        config: {},
        enabled: true,
      };
      // Missing createSource export
      `
    );

    const loader = new CustomSourceLoader(registry, TEST_DIR);
    const errorHandler = vi.fn();
    loader.on("error", errorHandler);
    const loaded = await loader.loadAll();

    expect(loaded).toHaveLength(0);
    expect(errorHandler).toHaveBeenCalledOnce();
  });

  it("skips files that do not export sourceConfig", async () => {
    writeSourceFile(
      "no-config.ts",
      `
      export function createSource(config) {
        return {
          id: config.id,
          config,
          start: async () => {},
          stop: async () => {},
          healthCheck: async () => ({
            sourceId: config.id, status: "healthy",
            lastSuccess: Date.now(), failCount: 0, latencyMs: 0,
          }),
          fetch: async () => [],
        };
      }
      `
    );

    const loader = new CustomSourceLoader(registry, TEST_DIR);
    const errorHandler = vi.fn();
    loader.on("error", errorHandler);
    const loaded = await loader.loadAll();

    expect(loaded).toHaveLength(0);
    expect(errorHandler).toHaveBeenCalledOnce();
  });

  it("handles import errors gracefully", async () => {
    writeSourceFile("syntax-error.ts", "export const x = {{{{");

    const loader = new CustomSourceLoader(registry, TEST_DIR);
    const errorHandler = vi.fn();
    loader.on("error", errorHandler);
    const loaded = await loader.loadAll();

    expect(loaded).toHaveLength(0);
    expect(errorHandler).toHaveBeenCalled();
  });

  it("loads multiple source files from directory", async () => {
    const makeSource = (id: string) => `
      export const sourceConfig = {
        id: "${id}",
        name: "${id}",
        type: "polling",
        plugin: "${id}",
        config: {},
        enabled: true,
      };
      export function createSource(config) {
        return {
          id: config.id, config,
          start: async () => {}, stop: async () => {},
          healthCheck: async () => ({
            sourceId: config.id, status: "healthy",
            lastSuccess: Date.now(), failCount: 0, latencyMs: 0,
          }),
          fetch: async () => [],
        };
      }
    `;

    writeSourceFile("source-a.ts", makeSource("source-a"));
    writeSourceFile("source-b.ts", makeSource("source-b"));

    const loader = new CustomSourceLoader(registry, TEST_DIR);
    const loaded = await loader.loadAll();

    expect(loaded).toHaveLength(2);
    expect(registry.get("source-a")).toBeDefined();
    expect(registry.get("source-b")).toBeDefined();
  });

  it("ignores non-.ts files in the directory", async () => {
    fs.writeFileSync(path.join(TEST_DIR, "readme.md"), "# notes", "utf-8");
    fs.writeFileSync(path.join(TEST_DIR, "data.json"), "{}", "utf-8");

    const loader = new CustomSourceLoader(registry, TEST_DIR);
    const loaded = await loader.loadAll();

    expect(loaded).toHaveLength(0);
  });

  it("returns empty array when directory does not exist", async () => {
    const loader = new CustomSourceLoader(
      registry,
      path.join(TEST_DIR, "nonexistent")
    );
    const loaded = await loader.loadAll();
    expect(loaded).toEqual([]);
  });

  it("validates that createSource returns an object with required methods", async () => {
    writeSourceFile(
      "incomplete.ts",
      `
      export const sourceConfig = {
        id: "incomplete",
        name: "Incomplete",
        type: "polling",
        plugin: "incomplete",
        config: {},
        enabled: true,
      };
      export function createSource(config) {
        return { id: config.id, config };
        // Missing start, stop, healthCheck, fetch
      }
      `
    );

    const loader = new CustomSourceLoader(registry, TEST_DIR);
    const errorHandler = vi.fn();
    loader.on("error", errorHandler);
    const loaded = await loader.loadAll();

    expect(loaded).toHaveLength(0);
    expect(errorHandler).toHaveBeenCalled();
  });

  it("emits 'loaded' event for each successfully loaded source", async () => {
    writeSourceFile(
      "emitter.ts",
      `
      export const sourceConfig = {
        id: "emitter-src",
        name: "Emitter",
        type: "polling",
        plugin: "emitter",
        config: {},
        enabled: true,
      };
      export function createSource(config) {
        return {
          id: config.id, config,
          start: async () => {}, stop: async () => {},
          healthCheck: async () => ({
            sourceId: config.id, status: "healthy",
            lastSuccess: Date.now(), failCount: 0, latencyMs: 0,
          }),
          fetch: async () => [],
        };
      }
      `
    );

    const loader = new CustomSourceLoader(registry, TEST_DIR);
    const loadedHandler = vi.fn();
    loader.on("loaded", loadedHandler);
    await loader.loadAll();

    expect(loadedHandler).toHaveBeenCalledOnce();
    expect(loadedHandler.mock.calls[0]![0]).toBe("emitter-src");
  });
});
```

### Step 2: Run tests, verify FAIL

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run agent/src/ingestion/__tests__/custom-source-loader.test.ts
```

Expected: All tests fail because `custom-source-loader.ts` does not exist.

### Step 3: Write implementation

Create `agent/src/ingestion/custom-source-loader.ts`:

```typescript
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { SourceConfig } from "@finwatch/shared";
import type { DataSource } from "./types.js";
import type { SourceRegistry } from "./source-registry.js";

type CustomSourceModule = {
  sourceConfig?: SourceConfig;
  createSource?: (config: SourceConfig) => DataSource;
};

export class CustomSourceLoader extends EventEmitter {
  private registry: SourceRegistry;
  private directory: string;

  constructor(registry: SourceRegistry, directory: string) {
    super();
    this.registry = registry;
    this.directory = directory;
  }

  async loadAll(): Promise<string[]> {
    if (!fs.existsSync(this.directory)) {
      return [];
    }

    const entries = await fs.promises.readdir(this.directory);
    const tsFiles = entries.filter((f) => f.endsWith(".ts")).sort();
    const loaded: string[] = [];

    for (const filename of tsFiles) {
      const filePath = path.join(this.directory, filename);
      try {
        const sourceId = await this.loadFile(filePath);
        if (sourceId) {
          loaded.push(sourceId);
        }
      } catch (err) {
        this.emit(
          "error",
          new Error(
            `Failed to load ${filename}: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
    }

    return loaded;
  }

  private async loadFile(filePath: string): Promise<string | null> {
    let mod: CustomSourceModule;

    try {
      const fileUrl = pathToFileURL(filePath).href;
      mod = (await import(fileUrl)) as CustomSourceModule;
    } catch (err) {
      throw new Error(
        `Import failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Validate sourceConfig export
    if (!mod.sourceConfig || typeof mod.sourceConfig !== "object") {
      throw new Error("Missing or invalid 'sourceConfig' export");
    }

    // Validate createSource export
    if (typeof mod.createSource !== "function") {
      throw new Error("Missing 'createSource' function export");
    }

    const config = mod.sourceConfig;
    const source = mod.createSource(config);

    // Validate returned source object
    if (!this.isValidDataSource(source)) {
      throw new Error(
        "createSource() returned object missing required methods (start, stop, healthCheck, fetch)"
      );
    }

    this.registry.register(source);
    this.emit("loaded", source.id);
    return source.id;
  }

  private isValidDataSource(obj: unknown): obj is DataSource {
    if (typeof obj !== "object" || obj === null) return false;

    const source = obj as Record<string, unknown>;
    return (
      typeof source.id === "string" &&
      typeof source.config === "object" &&
      typeof source.start === "function" &&
      typeof source.stop === "function" &&
      typeof source.healthCheck === "function" &&
      typeof source.fetch === "function"
    );
  }
}
```

### Step 4: Run tests, verify PASS

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run agent/src/ingestion/__tests__/custom-source-loader.test.ts
```

Expected: All 9 tests pass.

Also verify all previous tests still pass:

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && npx vitest run --project agent
```

### Step 5: Commit

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && git add agent/src/ingestion/custom-source-loader.ts agent/src/ingestion/__tests__/custom-source-loader.test.ts && git commit -m "feat(ingestion): add CustomSourceLoader for dynamic user source plugins

Scan directory for .ts files, dynamically import each, validate
sourceConfig and createSource exports, register valid sources into
SourceRegistry, emit loaded/error events.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Final Step: Barrel Export

After all tasks are complete, create the barrel export for the ingestion module.

**Files:**
- Create: `agent/src/ingestion/index.ts`

```typescript
export type { DataSource } from "./types.js";
export { SourceRegistry } from "./source-registry.js";
export { YahooFinanceSource } from "./yahoo-finance-source.js";
export { CsvFileSource } from "./csv-file-source.js";
export { normalizeTick, normalizeBatch, NormalizationError } from "./normalizer.js";
export type { NormalizeBatchOptions } from "./normalizer.js";
export { DataBuffer } from "./data-buffer.js";
export type { DataBufferOptions } from "./data-buffer.js";
export { HealthMonitor } from "./health-monitor.js";
export type { HealthMonitorOptions } from "./health-monitor.js";
export { PollingScheduler } from "./polling-scheduler.js";
export type { PollingSchedulerOptions } from "./polling-scheduler.js";
export { CustomSourceLoader } from "./custom-source-loader.js";
```

```bash
cd /Users/jdsingh/Projects/AI/finwatch-data-ingestion && git add agent/src/ingestion/index.ts && git commit -m "feat(ingestion): add barrel export for ingestion module

Export all public types, classes, and functions from agent/src/ingestion/.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

| Task | Files | Tests | Description |
|------|-------|-------|-------------|
| 2A.1 | `types.ts`, `source-registry.ts` | 14 | DataSource interface + SourceRegistry lifecycle |
| 2A.2 | `yahoo-finance-source.ts` | 13 | Yahoo Finance polling adapter with OHLCV parsing |
| 2A.3 | `csv-file-source.ts` | 12 | CSV file adapter with incremental reads |
| 2A.4 | `normalizer.ts` | 18 | DataTick normalization with alias mapping |
| 2A.5 | `data-buffer.ts` | 12 | Event-driven buffer with interval/urgent flush |
| 2A.6 | `health-monitor.ts` | 11 | Periodic health checks with status change events |
| 2A.7 | `polling-scheduler.ts` | 12 | Per-source polling with exponential backoff |
| 2A.8 | `custom-source-loader.ts` | 9 | Dynamic import of user .ts source plugins |
| Final | `index.ts` | -- | Barrel export |
| **Total** | **10 files** | **101 tests** | |

### File tree after completion

```
agent/src/ingestion/
  __tests__/
    source-registry.test.ts
    yahoo-finance-source.test.ts
    csv-file-source.test.ts
    normalizer.test.ts
    data-buffer.test.ts
    health-monitor.test.ts
    polling-scheduler.test.ts
    custom-source-loader.test.ts
  types.ts
  source-registry.ts
  yahoo-finance-source.ts
  csv-file-source.ts
  normalizer.ts
  data-buffer.ts
  health-monitor.ts
  polling-scheduler.ts
  custom-source-loader.ts
  index.ts
```
