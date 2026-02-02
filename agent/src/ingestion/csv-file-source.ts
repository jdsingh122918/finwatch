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
