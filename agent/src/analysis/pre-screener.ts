import type { DataTick } from "@finwatch/shared";
import type { Regime, Indicators } from "./regime-classifier.js";

export type PreScreenConfig = {
  zScoreThreshold: number;
  urgentThreshold: number;
  skipThreshold: number;
};

export type TickWithZScores = {
  tick: DataTick;
  zScores: Record<string, number>;
};

export type ScoredTick = {
  tick: DataTick;
  zScores: Record<string, number>;
  score: number;
  classification: "urgent" | "normal" | "skip";
  regime?: Regime;
  indicators?: Indicators;
};

export function computeZScores(ticks: DataTick[]): TickWithZScores[] {
  if (ticks.length === 0) return [];

  // Collect all metric keys
  const metricKeys = new Set<string>();
  for (const tick of ticks) {
    for (const key of Object.keys(tick.metrics)) {
      metricKeys.add(key);
    }
  }

  // Compute mean and stddev per metric
  const stats = new Map<string, { mean: number; std: number }>();

  for (const key of metricKeys) {
    const values: number[] = [];
    for (const tick of ticks) {
      const val = tick.metrics[key];
      if (val !== undefined) values.push(val);
    }

    if (values.length === 0) continue;

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const std = Math.sqrt(variance);

    stats.set(key, { mean, std });
  }

  // Compute z-scores per tick per metric
  return ticks.map((tick) => {
    const zScores: Record<string, number> = {};

    for (const key of metricKeys) {
      const val = tick.metrics[key];
      const stat = stats.get(key);
      if (val === undefined || !stat) continue;

      zScores[key] = stat.std === 0 ? 0 : (val - stat.mean) / stat.std;
    }

    return { tick, zScores };
  });
}

function maxAbsZScore(zScores: Record<string, number>): number {
  let max = 0;
  for (const z of Object.values(zScores)) {
    const abs = Math.abs(z);
    if (abs > max) max = abs;
  }
  return max;
}

/**
 * Convert a max absolute z-score into a 0–1 anomaly score.
 * Uses a sigmoid: 1 / (1 + e^(-k*(z - midpoint))).
 * Tuned so that z=0 maps to ~0, z=threshold maps to ~0.73, z>>threshold maps to ~1.
 */
function zToScore(maxZ: number, threshold: number): number {
  if (maxZ === 0) return 0;
  // Sigmoid with midpoint at threshold/2, steepness k=4/threshold
  const k = 4 / threshold;
  const midpoint = threshold / 2;
  return 1 / (1 + Math.exp(-k * (maxZ - midpoint)));
}

export function preScreenBatch(
  ticks: DataTick[],
  config: PreScreenConfig,
): ScoredTick[] {
  if (ticks.length === 0) return [];

  const withZScores = computeZScores(ticks);

  return withZScores.map(({ tick, zScores }) => {
    const maxZ = maxAbsZScore(zScores);
    const score = zToScore(maxZ, config.zScoreThreshold);

    let classification: ScoredTick["classification"];
    if (score >= config.urgentThreshold) {
      classification = "urgent";
    } else if (score < config.skipThreshold) {
      classification = "skip";
    } else {
      classification = "normal";
    }

    return { tick, zScores, score, classification };
  });
}
