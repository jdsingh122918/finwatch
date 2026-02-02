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
