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
