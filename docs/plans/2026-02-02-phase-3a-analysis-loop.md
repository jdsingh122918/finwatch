# Phase 3A: Analysis Loop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the continuous monitor loop with statistical pre-screening, LLM-powered analysis turns, subagent orchestration, and all 7 agent tools.

**Architecture:** Data flows from `DataBuffer` → pre-screen (z-score, MA deviation, rule engine) → context assembly → LLM analysis turn → anomaly flagging + knowledge capture. Subagents handle parallel deep-dive tasks with a concurrency limiter. All analysis lives in `agent/src/analysis/`, subagent orchestration in `agent/src/subagents/`.

**Tech Stack:** TypeScript, Vitest, Zod, `@finwatch/shared` types, existing providers/memory/ingestion/session/tools modules.

---

## Boundary Rules

- **ONLY modify files in:** `agent/src/analysis/`, `agent/src/subagents/`
- **Read-only imports from:** `@finwatch/shared`, `agent/src/providers/`, `agent/src/memory/`, `agent/src/ingestion/`, `agent/src/session/`, `agent/src/tools/`
- **Do NOT modify** any other directories

---

### Task 1: Pre-screen — Z-Score Calculator

**Files:**
- Create: `agent/src/analysis/__tests__/z-score.test.ts`
- Create: `agent/src/analysis/z-score.ts`

**Step 1: Write the failing test**

```typescript
// agent/src/analysis/__tests__/z-score.test.ts
import { describe, it, expect } from "vitest";
import { zScore, zScoreBatch, type ZScoreResult } from "../z-score.js";

describe("zScore", () => {
  it("returns 0 for a value equal to the mean", () => {
    const result = zScore(10, [10, 10, 10, 10, 10]);
    expect(result).toBe(0);
  });

  it("computes correct z-score for known data", () => {
    // mean=10, stddev=2
    const history = [8, 10, 12, 8, 10, 12, 8, 10, 12, 10];
    const result = zScore(14, history);
    // (14 - 10) / ~1.549 ≈ 2.58
    expect(result).toBeGreaterThan(2.5);
    expect(result).toBeLessThan(2.7);
  });

  it("returns Infinity when stddev is 0 and value differs from mean", () => {
    const result = zScore(15, [10, 10, 10, 10]);
    expect(result).toBe(Infinity);
  });

  it("returns 0 when stddev is 0 and value equals mean", () => {
    const result = zScore(10, [10, 10, 10, 10]);
    expect(result).toBe(0);
  });

  it("handles negative z-scores", () => {
    const history = [8, 10, 12, 8, 10, 12, 8, 10, 12, 10];
    const result = zScore(6, history);
    expect(result).toBeLessThan(-2.5);
  });
});

describe("zScoreBatch", () => {
  it("scores multiple metrics from a tick against history", () => {
    const history = [
      { price: 100, volume: 1000 },
      { price: 102, volume: 1100 },
      { price: 98, volume: 900 },
      { price: 101, volume: 1050 },
      { price: 99, volume: 950 },
    ];
    const current = { price: 115, volume: 5000 };

    const results = zScoreBatch(current, history);
    expect(results).toHaveLength(2);

    const priceResult = results.find((r) => r.metric === "price")!;
    expect(priceResult.zScore).toBeGreaterThan(3);

    const volumeResult = results.find((r) => r.metric === "volume")!;
    expect(volumeResult.zScore).toBeGreaterThan(3);
  });

  it("returns empty array for empty history", () => {
    const results = zScoreBatch({ price: 100 }, []);
    expect(results).toEqual([]);
  });

  it("ignores metrics not present in history", () => {
    const history = [{ price: 100 }, { price: 102 }];
    const current = { price: 101, newMetric: 50 };
    const results = zScoreBatch(current, history);
    expect(results).toHaveLength(1);
    expect(results[0]!.metric).toBe("price");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/analysis/__tests__/z-score.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// agent/src/analysis/z-score.ts
export type ZScoreResult = {
  metric: string;
  zScore: number;
  value: number;
  mean: number;
  stddev: number;
};

export function zScore(value: number, history: number[]): number {
  if (history.length === 0) return 0;

  const mean = history.reduce((a, b) => a + b, 0) / history.length;
  const variance =
    history.reduce((sum, v) => sum + (v - mean) ** 2, 0) / history.length;
  const stddev = Math.sqrt(variance);

  if (stddev === 0) return value === mean ? 0 : Infinity;
  return (value - mean) / stddev;
}

export function zScoreBatch(
  current: Record<string, number>,
  history: Record<string, number>[],
): ZScoreResult[] {
  if (history.length === 0) return [];

  const metrics = Object.keys(current).filter((key) =>
    history.every((h) => key in h),
  );

  return metrics.map((metric) => {
    const values = history.map((h) => h[metric]!);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance =
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const stddev = Math.sqrt(variance);
    const z = stddev === 0 ? (current[metric]! === mean ? 0 : Infinity) : (current[metric]! - mean) / stddev;

    return { metric, zScore: z, value: current[metric]!, mean, stddev };
  });
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/analysis/__tests__/z-score.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add agent/src/analysis/__tests__/z-score.test.ts agent/src/analysis/z-score.ts
git commit -m "feat(analysis): add z-score calculator for pre-screening"
```

---

### Task 2: Pre-screen — Moving Average Deviation

**Files:**
- Create: `agent/src/analysis/__tests__/moving-average.test.ts`
- Create: `agent/src/analysis/moving-average.ts`

**Step 1: Write the failing test**

```typescript
// agent/src/analysis/__tests__/moving-average.test.ts
import { describe, it, expect } from "vitest";
import {
  simpleMovingAverage,
  exponentialMovingAverage,
  detectMACrossover,
  type CrossoverSignal,
} from "../moving-average.js";

describe("simpleMovingAverage", () => {
  it("computes SMA for a window", () => {
    const data = [10, 20, 30, 40, 50];
    expect(simpleMovingAverage(data, 3)).toEqual([20, 30, 40]);
  });

  it("returns empty for window larger than data", () => {
    expect(simpleMovingAverage([1, 2], 5)).toEqual([]);
  });

  it("handles single-element window", () => {
    expect(simpleMovingAverage([5, 10, 15], 1)).toEqual([5, 10, 15]);
  });
});

describe("exponentialMovingAverage", () => {
  it("starts with first value", () => {
    const result = exponentialMovingAverage([100, 110, 105], 3);
    expect(result[0]).toBe(100);
    expect(result.length).toBe(3);
  });

  it("reacts faster to recent values than SMA", () => {
    const data = [100, 100, 100, 100, 200]; // spike at end
    const ema = exponentialMovingAverage(data, 3);
    const sma = simpleMovingAverage(data, 3);
    // EMA should be closer to 200 than SMA for the last value
    expect(ema[ema.length - 1]!).toBeGreaterThan(sma[sma.length - 1]!);
  });
});

describe("detectMACrossover", () => {
  it("detects bullish crossover (short crosses above long)", () => {
    // Prices trending up: short MA will cross above long MA
    const prices = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const signals = detectMACrossover(prices, { shortWindow: 3, longWindow: 5 });
    // In a consistently rising trend, short MA > long MA after warmup
    expect(signals.some((s) => s.type === "bullish")).toBe(true);
  });

  it("detects bearish crossover (short crosses below long)", () => {
    // Prices trending down after up
    const prices = [20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10];
    const signals = detectMACrossover(prices, { shortWindow: 3, longWindow: 5 });
    expect(signals.some((s) => s.type === "bearish")).toBe(true);
  });

  it("returns empty for insufficient data", () => {
    const signals = detectMACrossover([1, 2, 3], { shortWindow: 3, longWindow: 5 });
    expect(signals).toEqual([]);
  });

  it("returns deviation magnitude", () => {
    const prices = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const signals = detectMACrossover(prices, { shortWindow: 3, longWindow: 5 });
    for (const s of signals) {
      expect(s.deviation).toBeDefined();
      expect(typeof s.deviation).toBe("number");
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/analysis/__tests__/moving-average.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// agent/src/analysis/moving-average.ts
export type CrossoverSignal = {
  index: number;
  type: "bullish" | "bearish";
  deviation: number;
  shortMA: number;
  longMA: number;
};

export function simpleMovingAverage(data: number[], window: number): number[] {
  if (window > data.length) return [];
  const result: number[] = [];
  for (let i = window - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) {
      sum += data[j]!;
    }
    result.push(sum / window);
  }
  return result;
}

export function exponentialMovingAverage(data: number[], window: number): number[] {
  if (data.length === 0) return [];
  const k = 2 / (window + 1);
  const result: number[] = [data[0]!];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i]! * k + result[i - 1]! * (1 - k));
  }
  return result;
}

export function detectMACrossover(
  prices: number[],
  options: { shortWindow: number; longWindow: number },
): CrossoverSignal[] {
  const { shortWindow, longWindow } = options;
  if (prices.length < longWindow) return [];

  const shortMA = simpleMovingAverage(prices, shortWindow);
  const longMA = simpleMovingAverage(prices, longWindow);

  // Align: longMA starts at index (longWindow-1), shortMA starts at (shortWindow-1)
  const offset = longWindow - shortWindow;
  const signals: CrossoverSignal[] = [];

  for (let i = 1; i < longMA.length; i++) {
    const prevShort = shortMA[i - 1 + offset]!;
    const prevLong = longMA[i - 1]!;
    const currShort = shortMA[i + offset]!;
    const currLong = longMA[i]!;

    if (currShort === undefined || currLong === undefined) continue;

    const deviation = currLong !== 0 ? (currShort - currLong) / currLong : 0;

    if (prevShort <= prevLong && currShort > currLong) {
      signals.push({
        index: i + longWindow - 1,
        type: "bullish",
        deviation,
        shortMA: currShort,
        longMA: currLong,
      });
    } else if (prevShort >= prevLong && currShort < currLong) {
      signals.push({
        index: i + longWindow - 1,
        type: "bearish",
        deviation,
        shortMA: currShort,
        longMA: currLong,
      });
    }
  }

  return signals;
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/analysis/__tests__/moving-average.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add agent/src/analysis/__tests__/moving-average.test.ts agent/src/analysis/moving-average.ts
git commit -m "feat(analysis): add moving average deviation detector"
```

---

### Task 3: Pre-screen — Rule Engine

**Files:**
- Create: `agent/src/analysis/__tests__/rule-engine.test.ts`
- Create: `agent/src/analysis/rule-engine.ts`

**Step 1: Write the failing test**

```typescript
// agent/src/analysis/__tests__/rule-engine.test.ts
import { describe, it, expect } from "vitest";
import type { DataTick } from "@finwatch/shared";
import {
  RuleEngine,
  type Rule,
  type RuleResult,
} from "../rule-engine.js";

function makeTick(metrics: Record<string, number>, source = "test"): DataTick {
  return {
    sourceId: source,
    timestamp: Date.now(),
    metrics,
    metadata: {},
  };
}

describe("RuleEngine", () => {
  it("evaluates a threshold rule", () => {
    const engine = new RuleEngine();
    engine.loadRules([
      {
        id: "r1",
        name: "High price",
        condition: { type: "threshold", metric: "price", operator: ">", value: 200 },
        severity: "high",
        confidence: 0.9,
      },
    ]);

    const results = engine.evaluate(makeTick({ price: 250 }));
    expect(results).toHaveLength(1);
    expect(results[0]!.ruleId).toBe("r1");
    expect(results[0]!.triggered).toBe(true);
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it("does not trigger when condition is not met", () => {
    const engine = new RuleEngine();
    engine.loadRules([
      {
        id: "r1",
        name: "High price",
        condition: { type: "threshold", metric: "price", operator: ">", value: 200 },
        severity: "high",
        confidence: 0.9,
      },
    ]);

    const results = engine.evaluate(makeTick({ price: 150 }));
    expect(results).toHaveLength(1);
    expect(results[0]!.triggered).toBe(false);
  });

  it("evaluates all comparison operators", () => {
    const engine = new RuleEngine();
    engine.loadRules([
      { id: "gt", name: "gt", condition: { type: "threshold", metric: "x", operator: ">", value: 10 }, severity: "low", confidence: 1 },
      { id: "lt", name: "lt", condition: { type: "threshold", metric: "x", operator: "<", value: 10 }, severity: "low", confidence: 1 },
      { id: "gte", name: "gte", condition: { type: "threshold", metric: "x", operator: ">=", value: 10 }, severity: "low", confidence: 1 },
      { id: "lte", name: "lte", condition: { type: "threshold", metric: "x", operator: "<=", value: 10 }, severity: "low", confidence: 1 },
    ]);

    const results = engine.evaluate(makeTick({ x: 10 }));
    const triggered = results.filter((r) => r.triggered);
    expect(triggered.map((r) => r.ruleId).sort()).toEqual(["gte", "lte"]);
  });

  it("evaluates a percent_change rule", () => {
    const engine = new RuleEngine();
    engine.loadRules([
      {
        id: "r2",
        name: "Volume spike",
        condition: { type: "percent_change", metric: "volume", operator: ">", value: 100, baseline: 1000 },
        severity: "medium",
        confidence: 0.8,
      },
    ]);

    // 3000 is +200% from baseline 1000
    const results = engine.evaluate(makeTick({ volume: 3000 }));
    expect(results[0]!.triggered).toBe(true);
  });

  it("scores based on rule confidence", () => {
    const engine = new RuleEngine();
    engine.loadRules([
      {
        id: "high_conf",
        name: "High confidence",
        condition: { type: "threshold", metric: "price", operator: ">", value: 100 },
        severity: "high",
        confidence: 0.95,
      },
      {
        id: "low_conf",
        name: "Low confidence",
        condition: { type: "threshold", metric: "price", operator: ">", value: 100 },
        severity: "low",
        confidence: 0.3,
      },
    ]);

    const results = engine.evaluate(makeTick({ price: 150 }));
    const high = results.find((r) => r.ruleId === "high_conf")!;
    const low = results.find((r) => r.ruleId === "low_conf")!;
    expect(high.score).toBeGreaterThan(low.score);
  });

  it("loads rules from JSON", () => {
    const engine = new RuleEngine();
    const rulesJson = JSON.stringify([
      {
        id: "from_json",
        name: "From JSON",
        condition: { type: "threshold", metric: "price", operator: ">", value: 100 },
        severity: "low",
        confidence: 0.5,
      },
    ]);
    engine.loadRulesFromJSON(rulesJson);
    expect(engine.listRules()).toHaveLength(1);
  });

  it("replaces rules on reload", () => {
    const engine = new RuleEngine();
    engine.loadRules([
      { id: "r1", name: "A", condition: { type: "threshold", metric: "x", operator: ">", value: 1 }, severity: "low", confidence: 1 },
    ]);
    expect(engine.listRules()).toHaveLength(1);

    engine.loadRules([
      { id: "r2", name: "B", condition: { type: "threshold", metric: "y", operator: "<", value: 5 }, severity: "low", confidence: 1 },
      { id: "r3", name: "C", condition: { type: "threshold", metric: "z", operator: ">", value: 0 }, severity: "low", confidence: 1 },
    ]);
    expect(engine.listRules()).toHaveLength(2);
    expect(engine.listRules().map((r) => r.id).sort()).toEqual(["r2", "r3"]);
  });

  it("skips rules when metric is missing from tick", () => {
    const engine = new RuleEngine();
    engine.loadRules([
      { id: "r1", name: "A", condition: { type: "threshold", metric: "missing", operator: ">", value: 1 }, severity: "low", confidence: 1 },
    ]);
    const results = engine.evaluate(makeTick({ price: 100 }));
    expect(results[0]!.triggered).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/analysis/__tests__/rule-engine.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// agent/src/analysis/rule-engine.ts
import type { DataTick, Severity } from "@finwatch/shared";

export type ThresholdCondition = {
  type: "threshold";
  metric: string;
  operator: ">" | "<" | ">=" | "<=";
  value: number;
};

export type PercentChangeCondition = {
  type: "percent_change";
  metric: string;
  operator: ">" | "<" | ">=" | "<=";
  value: number;
  baseline: number;
};

export type RuleCondition = ThresholdCondition | PercentChangeCondition;

export type Rule = {
  id: string;
  name: string;
  condition: RuleCondition;
  severity: Severity;
  confidence: number;
};

export type RuleResult = {
  ruleId: string;
  ruleName: string;
  triggered: boolean;
  score: number;
  severity: Severity;
  details?: string;
};

function compare(actual: number, operator: string, target: number): boolean {
  switch (operator) {
    case ">": return actual > target;
    case "<": return actual < target;
    case ">=": return actual >= target;
    case "<=": return actual <= target;
    default: return false;
  }
}

function evaluateCondition(tick: DataTick, condition: RuleCondition): { triggered: boolean; details?: string } {
  const value = tick.metrics[condition.metric];
  if (value === undefined) return { triggered: false, details: "metric not present" };

  if (condition.type === "threshold") {
    const triggered = compare(value, condition.operator, condition.value);
    return {
      triggered,
      details: `${condition.metric}=${value} ${condition.operator} ${condition.value}`,
    };
  }

  if (condition.type === "percent_change") {
    if (condition.baseline === 0) return { triggered: false, details: "baseline is 0" };
    const pctChange = ((value - condition.baseline) / condition.baseline) * 100;
    const triggered = compare(pctChange, condition.operator, condition.value);
    return {
      triggered,
      details: `${condition.metric} change=${pctChange.toFixed(1)}% ${condition.operator} ${condition.value}%`,
    };
  }

  return { triggered: false };
}

export class RuleEngine {
  private rules: Rule[] = [];

  loadRules(rules: Rule[]): void {
    this.rules = [...rules];
  }

  loadRulesFromJSON(json: string): void {
    this.rules = JSON.parse(json) as Rule[];
  }

  listRules(): Rule[] {
    return [...this.rules];
  }

  evaluate(tick: DataTick): RuleResult[] {
    return this.rules.map((rule) => {
      const { triggered, details } = evaluateCondition(tick, rule.condition);
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        triggered,
        score: triggered ? rule.confidence : 0,
        severity: rule.severity,
        details,
      };
    });
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/analysis/__tests__/rule-engine.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add agent/src/analysis/__tests__/rule-engine.test.ts agent/src/analysis/rule-engine.ts
git commit -m "feat(analysis): add rule engine for pre-screening"
```

---

### Task 4: Pre-screen Orchestrator

**Files:**
- Create: `agent/src/analysis/__tests__/pre-screen.test.ts`
- Create: `agent/src/analysis/pre-screen.ts`

**Step 1: Write the failing test**

```typescript
// agent/src/analysis/__tests__/pre-screen.test.ts
import { describe, it, expect } from "vitest";
import type { DataTick } from "@finwatch/shared";
import { PreScreen, type PreScreenResult, type PreScreenConfig } from "../pre-screen.js";

function makeTick(metrics: Record<string, number>, source = "test"): DataTick {
  return { sourceId: source, timestamp: Date.now(), metrics, metadata: {} };
}

describe("PreScreen", () => {
  it("scores a tick combining z-score, MA deviation, and rules", () => {
    const ps = new PreScreen({
      zScoreThreshold: 3.0,
      maShortWindow: 3,
      maLongWindow: 5,
      rules: [],
      weights: { zScore: 0.4, maDeviation: 0.3, rules: 0.3 },
    });

    // Feed history
    const history = Array.from({ length: 20 }, (_, i) => makeTick({ price: 100 + (i % 3) }));
    for (const tick of history) ps.addHistory(tick);

    // Normal tick
    const normalResult = ps.score(makeTick({ price: 101 }));
    expect(normalResult.score).toBeLessThan(0.3);
    expect(normalResult.route).toBe("skip");
  });

  it("routes high-score ticks to immediate analysis", () => {
    const ps = new PreScreen({
      zScoreThreshold: 3.0,
      maShortWindow: 3,
      maLongWindow: 5,
      rules: [
        { id: "r1", name: "Spike", condition: { type: "threshold", metric: "price", operator: ">", value: 200 }, severity: "critical", confidence: 0.95 },
      ],
      weights: { zScore: 0.4, maDeviation: 0.3, rules: 0.3 },
    });

    const history = Array.from({ length: 20 }, () => makeTick({ price: 100 }));
    for (const tick of history) ps.addHistory(tick);

    const result = ps.score(makeTick({ price: 500 }));
    expect(result.score).toBeGreaterThan(0.6);
    expect(result.route).toBe("immediate");
  });

  it("routes medium-score ticks to batch review", () => {
    const ps = new PreScreen({
      zScoreThreshold: 3.0,
      maShortWindow: 3,
      maLongWindow: 5,
      rules: [],
      weights: { zScore: 0.4, maDeviation: 0.3, rules: 0.3 },
    });

    const history = Array.from({ length: 20 }, (_, i) => makeTick({ price: 100 + (i % 5) }));
    for (const tick of history) ps.addHistory(tick);

    // Moderately unusual
    const result = ps.score(makeTick({ price: 112 }));
    // Should be between 0.2 and 0.6 for batch review
    expect(result.score).toBeGreaterThanOrEqual(0.2);
  });

  it("returns component scores for debugging", () => {
    const ps = new PreScreen({
      zScoreThreshold: 3.0,
      maShortWindow: 3,
      maLongWindow: 5,
      rules: [],
      weights: { zScore: 0.4, maDeviation: 0.3, rules: 0.3 },
    });

    const history = Array.from({ length: 20 }, () => makeTick({ price: 100 }));
    for (const tick of history) ps.addHistory(tick);

    const result = ps.score(makeTick({ price: 100 }));
    expect(result.components).toBeDefined();
    expect(result.components.zScore).toBeDefined();
    expect(result.components.maDeviation).toBeDefined();
    expect(result.components.rules).toBeDefined();
  });

  it("respects routing thresholds from spec: <0.2 skip, 0.2-0.6 batch, >0.6 immediate", () => {
    const ps = new PreScreen({
      zScoreThreshold: 3.0,
      maShortWindow: 3,
      maLongWindow: 5,
      rules: [],
      weights: { zScore: 0.4, maDeviation: 0.3, rules: 0.3 },
    });

    // Feed steady history
    const history = Array.from({ length: 20 }, () => makeTick({ price: 100 }));
    for (const tick of history) ps.addHistory(tick);

    const low = ps.score(makeTick({ price: 100 }));
    expect(low.route).toBe("skip");

    // Force a high score
    const high = ps.score(makeTick({ price: 999 }));
    expect(high.route).toBe("immediate");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/analysis/__tests__/pre-screen.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// agent/src/analysis/pre-screen.ts
import type { DataTick, Severity } from "@finwatch/shared";
import { zScoreBatch } from "./z-score.js";
import { RuleEngine, type Rule } from "./rule-engine.js";

export type PreScreenConfig = {
  zScoreThreshold: number;
  maShortWindow: number;
  maLongWindow: number;
  rules: Rule[];
  weights: { zScore: number; maDeviation: number; rules: number };
};

export type PreScreenRoute = "skip" | "batch" | "immediate";

export type PreScreenResult = {
  score: number;
  route: PreScreenRoute;
  components: {
    zScore: number;
    maDeviation: number;
    rules: number;
  };
  triggeredRules: string[];
};

export class PreScreen {
  private config: PreScreenConfig;
  private ruleEngine: RuleEngine;
  private historyByMetric: Map<string, number[]> = new Map();
  private maxHistory = 100;

  constructor(config: PreScreenConfig) {
    this.config = config;
    this.ruleEngine = new RuleEngine();
    this.ruleEngine.loadRules(config.rules);
  }

  addHistory(tick: DataTick): void {
    for (const [metric, value] of Object.entries(tick.metrics)) {
      let arr = this.historyByMetric.get(metric);
      if (!arr) {
        arr = [];
        this.historyByMetric.set(metric, arr);
      }
      arr.push(value);
      if (arr.length > this.maxHistory) arr.shift();
    }
  }

  reloadRules(rules: Rule[]): void {
    this.config.rules = rules;
    this.ruleEngine.loadRules(rules);
  }

  score(tick: DataTick): PreScreenResult {
    const { weights } = this.config;

    // Z-score component
    const history: Record<string, number>[] = [];
    const metrics = Object.keys(tick.metrics);
    if (metrics.length > 0) {
      const histLen = this.historyByMetric.get(metrics[0]!)?.length ?? 0;
      for (let i = 0; i < histLen; i++) {
        const entry: Record<string, number> = {};
        for (const m of metrics) {
          const arr = this.historyByMetric.get(m);
          if (arr && arr[i] !== undefined) entry[m] = arr[i]!;
        }
        history.push(entry);
      }
    }

    const zResults = zScoreBatch(tick.metrics, history);
    const maxZ = zResults.length > 0 ? Math.max(...zResults.map((r) => Math.abs(r.zScore))) : 0;
    const zScoreNorm = Math.min(maxZ / this.config.zScoreThreshold, 1);

    // MA deviation component — simplified: compare short-term avg to long-term avg
    let maDevNorm = 0;
    for (const metric of metrics) {
      const arr = this.historyByMetric.get(metric);
      if (!arr || arr.length < this.config.maLongWindow) continue;
      const recent = arr.slice(-this.config.maShortWindow);
      const shortAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const longAvg = arr.slice(-this.config.maLongWindow).reduce((a, b) => a + b, 0) / this.config.maLongWindow;
      if (longAvg !== 0) {
        const dev = Math.abs((shortAvg - longAvg) / longAvg);
        maDevNorm = Math.max(maDevNorm, Math.min(dev * 10, 1)); // scale: 10% dev = score 1.0
      }
    }

    // Rule engine component
    const ruleResults = this.ruleEngine.evaluate(tick);
    const triggeredRules = ruleResults.filter((r) => r.triggered);
    const rulesNorm = triggeredRules.length > 0
      ? Math.max(...triggeredRules.map((r) => r.score))
      : 0;

    // Weighted combination
    const score = zScoreNorm * weights.zScore + maDevNorm * weights.maDeviation + rulesNorm * weights.rules;
    const clampedScore = Math.min(Math.max(score, 0), 1);

    const route: PreScreenRoute =
      clampedScore < 0.2 ? "skip" :
      clampedScore > 0.6 ? "immediate" :
      "batch";

    return {
      score: clampedScore,
      route,
      components: {
        zScore: zScoreNorm,
        maDeviation: maDevNorm,
        rules: rulesNorm,
      },
      triggeredRules: triggeredRules.map((r) => r.ruleId),
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/analysis/__tests__/pre-screen.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add agent/src/analysis/__tests__/pre-screen.test.ts agent/src/analysis/pre-screen.ts
git commit -m "feat(analysis): add pre-screen orchestrator combining z-score, MA, and rules"
```

---

### Task 5: Context Assembly

**Files:**
- Create: `agent/src/analysis/__tests__/context-assembly.test.ts`
- Create: `agent/src/analysis/context-assembly.ts`

**Step 1: Write the failing test**

```typescript
// agent/src/analysis/__tests__/context-assembly.test.ts
import { describe, it, expect } from "vitest";
import type { DataTick, Anomaly, SearchResult, DomainPattern, DomainThreshold, MemoryEntry } from "@finwatch/shared";
import {
  assembleContext,
  type ContextAssemblyInput,
  type AssembledContext,
  CONTEXT_BUDGET,
} from "../context-assembly.js";

function makeTick(price: number): DataTick {
  return { sourceId: "test", timestamp: Date.now(), metrics: { price }, metadata: {} };
}

function makeAnomaly(desc: string): Anomaly {
  return {
    id: `a-${Math.random().toString(36).slice(2)}`,
    severity: "high",
    source: "test",
    timestamp: Date.now(),
    description: desc,
    metrics: { price: 100 },
    preScreenScore: 0.8,
    sessionId: "s1",
  };
}

function makeMemoryResult(content: string): SearchResult {
  return {
    entry: { id: "m1", content, embedding: [], source: "test", timestamp: Date.now(), tags: [] },
    score: 0.9,
    matchType: "hybrid",
  };
}

describe("assembleContext", () => {
  it("includes system prompt", () => {
    const result = assembleContext({
      systemPrompt: "You are a financial analyst.",
      rules: [],
      memories: [],
      patterns: [],
      thresholds: [],
      sessionHistory: [],
      dataBatch: [],
      recentAnomalies: [],
      tokenBudget: 200000,
    });
    expect(result.system).toContain("financial analyst");
  });

  it("includes rules in system context", () => {
    const result = assembleContext({
      systemPrompt: "Analyze.",
      rules: [{ id: "r1", name: "High price rule", condition: { type: "threshold", metric: "price", operator: ">", value: 200 }, severity: "high", confidence: 0.9 }],
      memories: [],
      patterns: [],
      thresholds: [],
      sessionHistory: [],
      dataBatch: [],
      recentAnomalies: [],
      tokenBudget: 200000,
    });
    expect(result.system).toContain("High price rule");
  });

  it("includes recalled memories", () => {
    const result = assembleContext({
      systemPrompt: "Analyze.",
      rules: [],
      memories: [makeMemoryResult("AAPL had a 10% spike last Tuesday")],
      patterns: [],
      thresholds: [],
      sessionHistory: [],
      dataBatch: [],
      recentAnomalies: [],
      tokenBudget: 200000,
    });
    expect(result.contextBlock).toContain("AAPL had a 10% spike");
  });

  it("includes data batch as user message", () => {
    const ticks = [makeTick(100), makeTick(105), makeTick(110)];
    const result = assembleContext({
      systemPrompt: "Analyze.",
      rules: [],
      memories: [],
      patterns: [],
      thresholds: [],
      sessionHistory: [],
      dataBatch: ticks,
      recentAnomalies: [],
      tokenBudget: 200000,
    });
    expect(result.userMessage).toContain("100");
    expect(result.userMessage).toContain("110");
  });

  it("includes recent anomalies for context", () => {
    const result = assembleContext({
      systemPrompt: "Analyze.",
      rules: [],
      memories: [],
      patterns: [],
      thresholds: [],
      sessionHistory: [],
      dataBatch: [makeTick(100)],
      recentAnomalies: [makeAnomaly("Volume spike detected")],
      tokenBudget: 200000,
    });
    expect(result.contextBlock).toContain("Volume spike detected");
  });

  it("respects token budget by truncating data batch", () => {
    const largeBatch = Array.from({ length: 5000 }, (_, i) => makeTick(100 + i));
    const result = assembleContext({
      systemPrompt: "Analyze.",
      rules: [],
      memories: [],
      patterns: [],
      thresholds: [],
      sessionHistory: [],
      dataBatch: largeBatch,
      recentAnomalies: [],
      tokenBudget: 1000, // very small budget
    });
    expect(result.truncated).toBe(true);
    expect(result.estimatedTokens).toBeLessThanOrEqual(1000);
  });

  it("exports budget constants matching the spec", () => {
    expect(CONTEXT_BUDGET.systemAndRules).toBe(8000);
    expect(CONTEXT_BUDGET.memories).toBe(3000);
    expect(CONTEXT_BUDGET.domainKnowledge).toBe(5000);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/analysis/__tests__/context-assembly.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// agent/src/analysis/context-assembly.ts
import { encode } from "gpt-tokenizer";
import type {
  DataTick,
  Anomaly,
  SearchResult,
  DomainPattern,
  DomainThreshold,
  AgentMessage,
} from "@finwatch/shared";
import type { Rule } from "./rule-engine.js";

export const CONTEXT_BUDGET = {
  systemAndRules: 8000,
  memories: 3000,
  domainKnowledge: 5000,
  sessionHistory: 80000,
  dataBatch: 20000,
  anomaliesAndFeedback: 7000,
  reservedForResponse: 77000,
} as const;

export type ContextAssemblyInput = {
  systemPrompt: string;
  rules: Rule[];
  memories: SearchResult[];
  patterns: DomainPattern[];
  thresholds: DomainThreshold[];
  sessionHistory: AgentMessage[];
  dataBatch: DataTick[];
  recentAnomalies: Anomaly[];
  tokenBudget: number;
};

export type AssembledContext = {
  system: string;
  contextBlock: string;
  userMessage: string;
  estimatedTokens: number;
  truncated: boolean;
};

function estimateTokens(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}

function truncateToTokenBudget(text: string, budget: number): { text: string; truncated: boolean } {
  const tokens = estimateTokens(text);
  if (tokens <= budget) return { text, truncated: false };

  // Binary search for the right length
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (estimateTokens(text.slice(0, mid)) <= budget) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return { text: text.slice(0, low), truncated: true };
}

export function assembleContext(input: ContextAssemblyInput): AssembledContext {
  let truncated = false;

  // System prompt + rules
  let system = input.systemPrompt;
  if (input.rules.length > 0) {
    system += "\n\n## Active Detection Rules\n";
    for (const rule of input.rules) {
      system += `- **${rule.name}** (${rule.severity}, confidence: ${rule.confidence}): ${rule.condition.metric} ${rule.condition.type === "threshold" ? `${rule.condition.operator} ${rule.condition.value}` : `change ${rule.condition.operator} ${rule.condition.value}%`}\n`;
    }
  }
  const systemResult = truncateToTokenBudget(system, CONTEXT_BUDGET.systemAndRules);
  system = systemResult.text;
  truncated = truncated || systemResult.truncated;

  // Context block: memories + domain knowledge + recent anomalies
  let contextBlock = "";

  if (input.memories.length > 0) {
    contextBlock += "<relevant-context>\n";
    for (const mem of input.memories) {
      contextBlock += `- ${mem.entry.content} (relevance: ${mem.score.toFixed(2)})\n`;
    }
    contextBlock += "</relevant-context>\n\n";
  }

  if (input.patterns.length > 0 || input.thresholds.length > 0) {
    contextBlock += "<domain-knowledge>\n";
    for (const p of input.patterns) {
      contextBlock += `- Pattern: ${p.pattern} (confidence: ${p.confidence})\n`;
    }
    for (const t of input.thresholds) {
      contextBlock += `- Threshold: ${t.source}/${t.metric} ${t.direction} ${t.value}\n`;
    }
    contextBlock += "</domain-knowledge>\n\n";
  }

  if (input.recentAnomalies.length > 0) {
    contextBlock += "<recent-anomalies>\n";
    for (const a of input.recentAnomalies) {
      contextBlock += `- [${a.severity}] ${a.description} (score: ${a.preScreenScore})\n`;
    }
    contextBlock += "</recent-anomalies>\n";
  }

  // User message: data batch
  let userMessage = "<data-batch>\n";
  for (const tick of input.dataBatch) {
    const metricsStr = Object.entries(tick.metrics).map(([k, v]) => `${k}=${v}`).join(", ");
    userMessage += `[${new Date(tick.timestamp).toISOString()}] ${tick.sourceId}: ${metricsStr}\n`;
  }
  userMessage += "</data-batch>\n\nAnalyze this data batch for anomalies. Use your tools to flag any findings.";

  // Check total budget
  const totalTokens = estimateTokens(system) + estimateTokens(contextBlock) + estimateTokens(userMessage);
  if (totalTokens > input.tokenBudget) {
    // Truncate the data batch to fit
    const available = input.tokenBudget - estimateTokens(system) - estimateTokens(contextBlock) - 100;
    const batchResult = truncateToTokenBudget(userMessage, Math.max(available, 100));
    userMessage = batchResult.text;
    truncated = true;
  }

  return {
    system,
    contextBlock,
    userMessage,
    estimatedTokens: estimateTokens(system) + estimateTokens(contextBlock) + estimateTokens(userMessage),
    truncated,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/analysis/__tests__/context-assembly.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add agent/src/analysis/__tests__/context-assembly.test.ts agent/src/analysis/context-assembly.ts
git commit -m "feat(analysis): add context assembly with token budget management"
```

---

### Task 6: Analysis Turn Orchestration

**Files:**
- Create: `agent/src/analysis/__tests__/analysis-turn.test.ts`
- Create: `agent/src/analysis/analysis-turn.ts`

**Step 1: Write the failing test**

```typescript
// agent/src/analysis/__tests__/analysis-turn.test.ts
import { describe, it, expect, vi } from "vitest";
import type { LLMProvider, CreateMessageParams, StreamEvent, DataTick, Anomaly } from "@finwatch/shared";
import { AnalysisTurn, type AnalysisTurnDeps, type TurnResult } from "../analysis-turn.js";

function makeTick(price: number): DataTick {
  return { sourceId: "test", timestamp: Date.now(), metrics: { price }, metadata: {} };
}

function mockProvider(response: string): LLMProvider {
  return {
    id: "mock",
    name: "Mock",
    async *createMessage(_params: CreateMessageParams): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", text: response };
      yield { type: "usage", input: 100, output: 50 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi.fn().mockResolvedValue({ providerId: "mock", status: "healthy", latencyMs: 10 }),
    listModels: vi.fn().mockReturnValue(["mock-model"]),
  };
}

function mockToolProvider(): LLMProvider {
  return {
    id: "mock-tool",
    name: "Mock Tool",
    async *createMessage(_params: CreateMessageParams): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", text: "I detected an anomaly in the price data. The price spike of 500 is significantly above normal levels." };
      yield { type: "usage", input: 200, output: 100 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi.fn().mockResolvedValue({ providerId: "mock-tool", status: "healthy", latencyMs: 10 }),
    listModels: vi.fn().mockReturnValue(["mock-model"]),
  };
}

describe("AnalysisTurn", () => {
  it("runs a full analysis turn and returns result", async () => {
    const deps: AnalysisTurnDeps = {
      provider: mockProvider("No anomalies detected in this batch."),
      model: "mock-model",
      systemPrompt: "You are a financial analyst.",
    };

    const turn = new AnalysisTurn(deps);
    const result = await turn.run({
      dataBatch: [makeTick(100), makeTick(101)],
      memories: [],
      patterns: [],
      thresholds: [],
      recentAnomalies: [],
      rules: [],
      sessionHistory: [],
      tokenBudget: 200000,
    });

    expect(result.response).toContain("No anomalies");
    expect(result.usage).toBeDefined();
    expect(result.usage.input).toBeGreaterThan(0);
  });

  it("streams response text via callback", async () => {
    const chunks: string[] = [];
    const deps: AnalysisTurnDeps = {
      provider: mockProvider("Analysis complete."),
      model: "mock-model",
      systemPrompt: "Analyze.",
      onTextDelta: (text) => chunks.push(text),
    };

    const turn = new AnalysisTurn(deps);
    await turn.run({
      dataBatch: [makeTick(100)],
      memories: [],
      patterns: [],
      thresholds: [],
      recentAnomalies: [],
      rules: [],
      sessionHistory: [],
      tokenBudget: 200000,
    });

    expect(chunks.join("")).toBe("Analysis complete.");
  });

  it("produces turn result with timing info", async () => {
    const deps: AnalysisTurnDeps = {
      provider: mockProvider("Done."),
      model: "mock-model",
      systemPrompt: "Analyze.",
    };

    const turn = new AnalysisTurn(deps);
    const result = await turn.run({
      dataBatch: [makeTick(100)],
      memories: [],
      patterns: [],
      thresholds: [],
      recentAnomalies: [],
      rules: [],
      sessionHistory: [],
      tokenBudget: 200000,
    });

    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.tickCount).toBe(1);
  });

  it("handles provider errors gracefully", async () => {
    const errorProvider: LLMProvider = {
      id: "error",
      name: "Error",
      async *createMessage(): AsyncIterable<StreamEvent> {
        throw new Error("Provider unavailable");
      },
      healthCheck: vi.fn().mockResolvedValue({ providerId: "error", status: "offline", latencyMs: 0 }),
      listModels: vi.fn().mockReturnValue([]),
    };

    const deps: AnalysisTurnDeps = {
      provider: errorProvider,
      model: "mock-model",
      systemPrompt: "Analyze.",
    };

    const turn = new AnalysisTurn(deps);
    await expect(
      turn.run({
        dataBatch: [makeTick(100)],
        memories: [],
        patterns: [],
        thresholds: [],
        recentAnomalies: [],
        rules: [],
        sessionHistory: [],
        tokenBudget: 200000,
      })
    ).rejects.toThrow("Provider unavailable");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/analysis/__tests__/analysis-turn.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// agent/src/analysis/analysis-turn.ts
import type {
  LLMProvider,
  DataTick,
  Anomaly,
  SearchResult,
  DomainPattern,
  DomainThreshold,
  AgentMessage,
} from "@finwatch/shared";
import { assembleContext, type ContextAssemblyInput } from "./context-assembly.js";
import type { Rule } from "./rule-engine.js";

export type AnalysisTurnDeps = {
  provider: LLMProvider;
  model: string;
  systemPrompt: string;
  onTextDelta?: (text: string) => void;
};

export type AnalysisTurnInput = {
  dataBatch: DataTick[];
  memories: SearchResult[];
  patterns: DomainPattern[];
  thresholds: DomainThreshold[];
  recentAnomalies: Anomaly[];
  rules: Rule[];
  sessionHistory: AgentMessage[];
  tokenBudget: number;
};

export type TurnResult = {
  response: string;
  usage: { input: number; output: number };
  durationMs: number;
  tickCount: number;
  truncated: boolean;
};

export class AnalysisTurn {
  private deps: AnalysisTurnDeps;

  constructor(deps: AnalysisTurnDeps) {
    this.deps = deps;
  }

  async run(input: AnalysisTurnInput): Promise<TurnResult> {
    const startTime = Date.now();

    const assembled = assembleContext({
      systemPrompt: this.deps.systemPrompt,
      rules: input.rules,
      memories: input.memories,
      patterns: input.patterns,
      thresholds: input.thresholds,
      sessionHistory: input.sessionHistory,
      dataBatch: input.dataBatch,
      recentAnomalies: input.recentAnomalies,
      tokenBudget: input.tokenBudget,
    });

    const userContent = assembled.contextBlock
      ? `${assembled.contextBlock}\n\n${assembled.userMessage}`
      : assembled.userMessage;

    let response = "";
    let usage = { input: 0, output: 0 };

    const stream = this.deps.provider.createMessage({
      model: this.deps.model,
      system: assembled.system,
      messages: [{ role: "user", content: userContent }],
      maxTokens: 4096,
      temperature: 0.3,
    });

    for await (const event of stream) {
      if (event.type === "text_delta") {
        response += event.text;
        this.deps.onTextDelta?.(event.text);
      } else if (event.type === "usage") {
        usage = { input: event.input, output: event.output };
      }
    }

    return {
      response,
      usage,
      durationMs: Date.now() - startTime,
      tickCount: input.dataBatch.length,
      truncated: assembled.truncated,
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/analysis/__tests__/analysis-turn.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add agent/src/analysis/__tests__/analysis-turn.test.ts agent/src/analysis/analysis-turn.ts
git commit -m "feat(analysis): add analysis turn orchestration with LLM streaming"
```

---

### Task 7: Monitor Loop

**Files:**
- Create: `agent/src/analysis/__tests__/monitor-loop.test.ts`
- Create: `agent/src/analysis/monitor-loop.ts`

**Step 1: Write the failing test**

```typescript
// agent/src/analysis/__tests__/monitor-loop.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import type { LLMProvider, CreateMessageParams, StreamEvent, DataTick } from "@finwatch/shared";
import { MonitorLoop, type MonitorLoopDeps, type MonitorLoopConfig } from "../monitor-loop.js";

function makeTick(price: number): DataTick {
  return { sourceId: "test", timestamp: Date.now(), metrics: { price }, metadata: {} };
}

function mockProvider(response = "No anomalies."): LLMProvider {
  return {
    id: "mock",
    name: "Mock",
    async *createMessage(): AsyncIterable<StreamEvent> {
      yield { type: "text_delta", text: response };
      yield { type: "usage", input: 100, output: 50 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi.fn().mockResolvedValue({ providerId: "mock", status: "healthy", latencyMs: 10 }),
    listModels: vi.fn().mockReturnValue(["mock-model"]),
  };
}

class MockDataBuffer extends EventEmitter {
  private ticks: DataTick[] = [];
  private resolvers: Array<(ticks: DataTick[]) => void> = [];

  push(tick: DataTick): void {
    this.ticks.push(tick);
  }

  async nextBatch(): Promise<DataTick[]> {
    if (this.ticks.length > 0) {
      const batch = [...this.ticks];
      this.ticks = [];
      return batch;
    }
    return new Promise((resolve) => {
      this.resolvers.push(resolve);
    });
  }

  flush(ticks: DataTick[]): void {
    const resolver = this.resolvers.shift();
    if (resolver) resolver(ticks);
  }

  get size(): number { return this.ticks.length; }
  destroy(): void { this.resolvers = []; }
}

describe("MonitorLoop", () => {
  it("starts, runs one cycle, and stops", async () => {
    const buffer = new MockDataBuffer();
    buffer.push(makeTick(100));
    buffer.push(makeTick(101));

    const onCycleComplete = vi.fn();

    const loop = new MonitorLoop({
      provider: mockProvider(),
      model: "mock-model",
      systemPrompt: "Analyze.",
      buffer: buffer as any,
      onCycleComplete,
      preScreenConfig: {
        zScoreThreshold: 3.0,
        maShortWindow: 3,
        maLongWindow: 5,
        rules: [],
        weights: { zScore: 0.4, maDeviation: 0.3, rules: 0.3 },
      },
      tokenBudget: 200000,
      maxCycles: 1,
    });

    await loop.start();
    // Wait for cycle to complete
    await vi.waitFor(() => expect(onCycleComplete).toHaveBeenCalledOnce());
    loop.stop();
  });

  it("runs multiple cycles", async () => {
    const buffer = new MockDataBuffer();
    // Pre-fill two batches
    buffer.push(makeTick(100));

    const onCycleComplete = vi.fn();
    let cycleCount = 0;

    const loop = new MonitorLoop({
      provider: mockProvider(),
      model: "mock-model",
      systemPrompt: "Analyze.",
      buffer: buffer as any,
      onCycleComplete: (result) => {
        onCycleComplete(result);
        cycleCount++;
        if (cycleCount < 3) {
          buffer.push(makeTick(100 + cycleCount));
        }
      },
      preScreenConfig: {
        zScoreThreshold: 3.0,
        maShortWindow: 3,
        maLongWindow: 5,
        rules: [],
        weights: { zScore: 0.4, maDeviation: 0.3, rules: 0.3 },
      },
      tokenBudget: 200000,
      maxCycles: 3,
    });

    await loop.start();
    await vi.waitFor(() => expect(onCycleComplete).toHaveBeenCalledTimes(3), { timeout: 5000 });
    loop.stop();
  });

  it("reports running state", async () => {
    const buffer = new MockDataBuffer();
    buffer.push(makeTick(100));

    const loop = new MonitorLoop({
      provider: mockProvider(),
      model: "mock-model",
      systemPrompt: "Analyze.",
      buffer: buffer as any,
      onCycleComplete: vi.fn(),
      preScreenConfig: {
        zScoreThreshold: 3.0,
        maShortWindow: 3,
        maLongWindow: 5,
        rules: [],
        weights: { zScore: 0.4, maDeviation: 0.3, rules: 0.3 },
      },
      tokenBudget: 200000,
      maxCycles: 1,
    });

    expect(loop.isRunning).toBe(false);
    const startPromise = loop.start();
    expect(loop.isRunning).toBe(true);
    await startPromise;
    loop.stop();
    expect(loop.isRunning).toBe(false);
  });

  it("tracks cycle count", async () => {
    const buffer = new MockDataBuffer();
    buffer.push(makeTick(100));

    const loop = new MonitorLoop({
      provider: mockProvider(),
      model: "mock-model",
      systemPrompt: "Analyze.",
      buffer: buffer as any,
      onCycleComplete: () => { buffer.push(makeTick(101)); },
      preScreenConfig: {
        zScoreThreshold: 3.0,
        maShortWindow: 3,
        maLongWindow: 5,
        rules: [],
        weights: { zScore: 0.4, maDeviation: 0.3, rules: 0.3 },
      },
      tokenBudget: 200000,
      maxCycles: 2,
    });

    await loop.start();
    await vi.waitFor(() => expect(loop.cycleCount).toBe(2));
    loop.stop();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/analysis/__tests__/monitor-loop.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// agent/src/analysis/monitor-loop.ts
import type {
  LLMProvider,
  DataTick,
  Anomaly,
  SearchResult,
  DomainPattern,
  DomainThreshold,
  AgentMessage,
} from "@finwatch/shared";
import { PreScreen, type PreScreenConfig } from "./pre-screen.js";
import { AnalysisTurn, type TurnResult } from "./analysis-turn.js";

export type MonitorLoopDeps = {
  provider: LLMProvider;
  model: string;
  systemPrompt: string;
  buffer: { nextBatch(): Promise<DataTick[]>; size: number };
  onCycleComplete: (result: CycleResult) => void;
  onTextDelta?: (text: string) => void;
  preScreenConfig: PreScreenConfig;
  tokenBudget: number;
  maxCycles?: number;
  // Optional injected dependencies for memory/knowledge
  getMemories?: (query: string) => Promise<SearchResult[]>;
  getPatterns?: () => DomainPattern[];
  getThresholds?: () => DomainThreshold[];
  getRecentAnomalies?: () => Anomaly[];
};

export type MonitorLoopConfig = MonitorLoopDeps;

export type CycleResult = {
  cycleNumber: number;
  turnResult: TurnResult;
  preScreenResults: Array<{ tick: DataTick; score: number; route: string }>;
  immediateCount: number;
  batchCount: number;
  skippedCount: number;
};

export class MonitorLoop {
  private deps: MonitorLoopDeps;
  private preScreen: PreScreen;
  private running = false;
  private stopped = false;
  private _cycleCount = 0;

  constructor(deps: MonitorLoopDeps) {
    this.deps = deps;
    this.preScreen = new PreScreen(deps.preScreenConfig);
  }

  get isRunning(): boolean {
    return this.running;
  }

  get cycleCount(): number {
    return this._cycleCount;
  }

  async start(): Promise<void> {
    this.running = true;
    this.stopped = false;
    this._cycleCount = 0;

    const maxCycles = this.deps.maxCycles ?? Infinity;

    while (!this.stopped && this._cycleCount < maxCycles) {
      const batch = await this.deps.buffer.nextBatch();
      if (this.stopped) break;
      if (batch.length === 0) continue;

      // Pre-screen each tick
      const screenResults = batch.map((tick) => {
        const result = this.preScreen.score(tick);
        this.preScreen.addHistory(tick);
        return { tick, score: result.score, route: result.route };
      });

      const immediate = screenResults.filter((r) => r.route === "immediate");
      const batched = screenResults.filter((r) => r.route === "batch");
      const skipped = screenResults.filter((r) => r.route === "skip");

      // Combine immediate + batch ticks for analysis (skip the skipped ones)
      const analysisData = [...immediate.map((r) => r.tick), ...batched.map((r) => r.tick)];
      if (analysisData.length === 0) {
        // All ticks were skipped — still count as a cycle
        this._cycleCount++;
        this.deps.onCycleComplete({
          cycleNumber: this._cycleCount,
          turnResult: { response: "", usage: { input: 0, output: 0 }, durationMs: 0, tickCount: 0, truncated: false },
          preScreenResults: screenResults,
          immediateCount: 0,
          batchCount: 0,
          skippedCount: skipped.length,
        });
        continue;
      }

      // Run analysis turn
      const turn = new AnalysisTurn({
        provider: this.deps.provider,
        model: this.deps.model,
        systemPrompt: this.deps.systemPrompt,
        onTextDelta: this.deps.onTextDelta,
      });

      const memories = this.deps.getMemories ? await this.deps.getMemories("current analysis") : [];
      const patterns = this.deps.getPatterns?.() ?? [];
      const thresholds = this.deps.getThresholds?.() ?? [];
      const recentAnomalies = this.deps.getRecentAnomalies?.() ?? [];

      const turnResult = await turn.run({
        dataBatch: analysisData,
        memories,
        patterns,
        thresholds,
        recentAnomalies,
        rules: this.deps.preScreenConfig.rules,
        sessionHistory: [],
        tokenBudget: this.deps.tokenBudget,
      });

      this._cycleCount++;
      this.deps.onCycleComplete({
        cycleNumber: this._cycleCount,
        turnResult,
        preScreenResults: screenResults,
        immediateCount: immediate.length,
        batchCount: batched.length,
        skippedCount: skipped.length,
      });
    }

    this.running = false;
  }

  stop(): void {
    this.stopped = true;
    this.running = false;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/analysis/__tests__/monitor-loop.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add agent/src/analysis/__tests__/monitor-loop.test.ts agent/src/analysis/monitor-loop.ts
git commit -m "feat(analysis): add continuous monitor loop with pre-screening and analysis turns"
```

---

### Task 8: Subagent Spawner & Concurrency Limiter

**Files:**
- Create: `agent/src/subagents/__tests__/subagent-spawner.test.ts`
- Create: `agent/src/subagents/subagent-spawner.ts`

**Step 1: Write the failing test**

```typescript
// agent/src/subagents/__tests__/subagent-spawner.test.ts
import { describe, it, expect, vi } from "vitest";
import type { LLMProvider, CreateMessageParams, StreamEvent } from "@finwatch/shared";
import { SubagentSpawner, type SubagentTask, type SubagentResult } from "../subagent-spawner.js";

function mockProvider(response: string, delay = 0): LLMProvider {
  return {
    id: "mock",
    name: "Mock",
    async *createMessage(): AsyncIterable<StreamEvent> {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      yield { type: "text_delta", text: response };
      yield { type: "usage", input: 50, output: 25 };
      yield { type: "stop", reason: "end_turn" };
    },
    healthCheck: vi.fn().mockResolvedValue({ providerId: "mock", status: "healthy", latencyMs: 10 }),
    listModels: vi.fn().mockReturnValue(["mock-model"]),
  };
}

describe("SubagentSpawner", () => {
  it("spawns a subagent and returns its result", async () => {
    const spawner = new SubagentSpawner({
      provider: mockProvider("Volume analysis complete: no anomalies."),
      model: "mock-model",
      maxConcurrent: 3,
    });

    const task: SubagentTask = {
      type: "volume_analysis",
      prompt: "Analyze volume data for AAPL",
      data: { symbol: "AAPL", volume: [1000, 1100, 5000] },
    };

    const result = await spawner.spawn(task);
    expect(result.response).toContain("Volume analysis complete");
    expect(result.taskType).toBe("volume_analysis");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("enforces concurrency limit", async () => {
    let activeCount = 0;
    let maxActive = 0;

    const slowProvider: LLMProvider = {
      id: "slow",
      name: "Slow",
      async *createMessage(): AsyncIterable<StreamEvent> {
        activeCount++;
        maxActive = Math.max(maxActive, activeCount);
        await new Promise((r) => setTimeout(r, 50));
        yield { type: "text_delta", text: "done" };
        yield { type: "usage", input: 10, output: 5 };
        yield { type: "stop", reason: "end_turn" };
        activeCount--;
      },
      healthCheck: vi.fn().mockResolvedValue({ providerId: "slow", status: "healthy", latencyMs: 10 }),
      listModels: vi.fn().mockReturnValue(["mock-model"]),
    };

    const spawner = new SubagentSpawner({
      provider: slowProvider,
      model: "mock-model",
      maxConcurrent: 2,
    });

    const tasks: SubagentTask[] = Array.from({ length: 5 }, (_, i) => ({
      type: "volume_analysis",
      prompt: `Task ${i}`,
      data: {},
    }));

    const results = await Promise.all(tasks.map((t) => spawner.spawn(t)));
    expect(results).toHaveLength(5);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("assigns unique session IDs to each subagent", async () => {
    const spawner = new SubagentSpawner({
      provider: mockProvider("done"),
      model: "mock-model",
      maxConcurrent: 3,
    });

    const r1 = await spawner.spawn({ type: "volume_analysis", prompt: "A", data: {} });
    const r2 = await spawner.spawn({ type: "price_divergence", prompt: "B", data: {} });
    expect(r1.sessionId).not.toBe(r2.sessionId);
  });

  it("handles subagent errors without crashing the spawner", async () => {
    const errorProvider: LLMProvider = {
      id: "error",
      name: "Error",
      async *createMessage(): AsyncIterable<StreamEvent> {
        throw new Error("Subagent failed");
      },
      healthCheck: vi.fn().mockResolvedValue({ providerId: "error", status: "offline", latencyMs: 0 }),
      listModels: vi.fn().mockReturnValue([]),
    };

    const spawner = new SubagentSpawner({
      provider: errorProvider,
      model: "mock-model",
      maxConcurrent: 3,
    });

    const result = await spawner.spawn({ type: "volume_analysis", prompt: "fail", data: {} });
    expect(result.error).toBeDefined();
    expect(result.response).toBe("");
  });

  it("subagents cannot spawn subagents (no nesting)", async () => {
    const spawner = new SubagentSpawner({
      provider: mockProvider("done"),
      model: "mock-model",
      maxConcurrent: 3,
    });

    // The subagent task should have restricted tool access (no spawn_subagent)
    const result = await spawner.spawn({ type: "volume_analysis", prompt: "test", data: {} });
    expect(result.allowedTools).not.toContain("spawn_subagent");
  });

  it("reports active and queued counts", async () => {
    const slowProvider: LLMProvider = {
      id: "slow",
      name: "Slow",
      async *createMessage(): AsyncIterable<StreamEvent> {
        await new Promise((r) => setTimeout(r, 100));
        yield { type: "text_delta", text: "done" };
        yield { type: "usage", input: 10, output: 5 };
        yield { type: "stop", reason: "end_turn" };
      },
      healthCheck: vi.fn().mockResolvedValue({ providerId: "slow", status: "healthy", latencyMs: 10 }),
      listModels: vi.fn().mockReturnValue(["mock-model"]),
    };

    const spawner = new SubagentSpawner({
      provider: slowProvider,
      model: "mock-model",
      maxConcurrent: 1,
    });

    const p1 = spawner.spawn({ type: "volume_analysis", prompt: "A", data: {} });
    // Give p1 time to start
    await new Promise((r) => setTimeout(r, 10));
    expect(spawner.activeCount).toBe(1);

    const p2 = spawner.spawn({ type: "volume_analysis", prompt: "B", data: {} });
    await new Promise((r) => setTimeout(r, 10));
    expect(spawner.queuedCount).toBe(1);

    await Promise.all([p1, p2]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/subagents/__tests__/subagent-spawner.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// agent/src/subagents/subagent-spawner.ts
import { randomUUID } from "crypto";
import type { LLMProvider, StreamEvent } from "@finwatch/shared";

export type SubagentType = "volume_analysis" | "price_divergence" | "correlation" | "sentiment";

export type SubagentTask = {
  type: string;
  prompt: string;
  data: Record<string, unknown>;
};

export type SubagentResult = {
  sessionId: string;
  taskType: string;
  response: string;
  usage: { input: number; output: number };
  durationMs: number;
  error?: string;
  allowedTools: string[];
};

type QueuedTask = {
  task: SubagentTask;
  resolve: (result: SubagentResult) => void;
};

const SUBAGENT_ALLOWED_TOOLS = ["analyze_data", "search_memory"];

export class SubagentSpawner {
  private provider: LLMProvider;
  private model: string;
  private maxConcurrent: number;
  private active = 0;
  private queue: QueuedTask[] = [];

  constructor(config: { provider: LLMProvider; model: string; maxConcurrent: number }) {
    this.provider = config.provider;
    this.model = config.model;
    this.maxConcurrent = config.maxConcurrent;
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  async spawn(task: SubagentTask): Promise<SubagentResult> {
    if (this.active >= this.maxConcurrent) {
      return new Promise<SubagentResult>((resolve) => {
        this.queue.push({ task, resolve });
      });
    }

    return this.execute(task);
  }

  private async execute(task: SubagentTask): Promise<SubagentResult> {
    this.active++;
    const sessionId = `subagent-${randomUUID()}`;
    const startTime = Date.now();

    try {
      const systemPrompt = `You are a specialized ${task.type} subagent. Analyze the provided data and report findings. You have access to these tools only: ${SUBAGENT_ALLOWED_TOOLS.join(", ")}. You cannot spawn other subagents.`;

      const dataStr = JSON.stringify(task.data);
      let response = "";
      let usage = { input: 0, output: 0 };

      const stream = this.provider.createMessage({
        model: this.model,
        system: systemPrompt,
        messages: [{ role: "user", content: `${task.prompt}\n\nData:\n${dataStr}` }],
        maxTokens: 2048,
        temperature: 0.3,
      });

      for await (const event of stream) {
        if (event.type === "text_delta") {
          response += event.text;
        } else if (event.type === "usage") {
          usage = { input: event.input, output: event.output };
        }
      }

      return {
        sessionId,
        taskType: task.type,
        response,
        usage,
        durationMs: Date.now() - startTime,
        allowedTools: SUBAGENT_ALLOWED_TOOLS,
      };
    } catch (err) {
      return {
        sessionId,
        taskType: task.type,
        response: "",
        usage: { input: 0, output: 0 },
        durationMs: Date.now() - startTime,
        error: err instanceof Error ? err.message : String(err),
        allowedTools: SUBAGENT_ALLOWED_TOOLS,
      };
    } finally {
      this.active--;
      this.processQueue();
    }
  }

  private processQueue(): void {
    if (this.queue.length === 0 || this.active >= this.maxConcurrent) return;
    const next = this.queue.shift()!;
    this.execute(next.task).then(next.resolve);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/subagents/__tests__/subagent-spawner.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add agent/src/subagents/__tests__/subagent-spawner.test.ts agent/src/subagents/subagent-spawner.ts
git commit -m "feat(subagents): add subagent spawner with concurrency limiter"
```

---

### Task 9: Agent Tools (7 tools from spec)

**Files:**
- Create: `agent/src/analysis/__tests__/agent-tools.test.ts`
- Create: `agent/src/analysis/agent-tools.ts`
- Create: `agent/src/analysis/index.ts`

**Step 1: Write the failing test**

```typescript
// agent/src/analysis/__tests__/agent-tools.test.ts
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "../../tools/tool-registry.js";
import { registerAgentTools, type AgentToolDeps } from "../agent-tools.js";

function mockDeps(): AgentToolDeps {
  return {
    flagAnomaly: vi.fn().mockResolvedValue({ id: "a1" }),
    dismissSignal: vi.fn().mockResolvedValue({ dismissed: true }),
    searchMemory: vi.fn().mockResolvedValue([{ entry: { id: "m1", content: "test" }, score: 0.9, matchType: "hybrid" }]),
    updateKnowledge: vi.fn().mockResolvedValue({ updated: true }),
    spawnSubagent: vi.fn().mockResolvedValue({ sessionId: "sub-1", response: "done", taskType: "volume_analysis", usage: { input: 0, output: 0 }, durationMs: 0, allowedTools: [] }),
    getSourceHealth: vi.fn().mockResolvedValue({ test: { sourceId: "test", status: "healthy", lastSuccess: Date.now(), failCount: 0, latencyMs: 10 } }),
    analyzeData: vi.fn().mockResolvedValue({ annotated: true }),
  };
}

describe("Agent Tools Registration", () => {
  it("registers all 7 tools", () => {
    const registry = new ToolRegistry();
    const deps = mockDeps();
    registerAgentTools(registry, deps);

    const tools = registry.listTools();
    expect(tools).toContain("flag_anomaly");
    expect(tools).toContain("dismiss_signal");
    expect(tools).toContain("search_memory");
    expect(tools).toContain("update_knowledge");
    expect(tools).toContain("spawn_subagent");
    expect(tools).toContain("get_source_health");
    expect(tools).toContain("analyze_data");
    expect(tools).toHaveLength(7);
  });

  it("flag_anomaly tool calls handler with correct args", async () => {
    const registry = new ToolRegistry();
    const deps = mockDeps();
    registerAgentTools(registry, deps);

    await registry.execute("flag_anomaly", {
      severity: "high",
      description: "Unusual price spike",
      source: "yahoo",
      metrics: { price: 500, volume: 10000 },
    });

    expect(deps.flagAnomaly).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: "high",
        description: "Unusual price spike",
      })
    );
  });

  it("dismiss_signal tool calls handler", async () => {
    const registry = new ToolRegistry();
    const deps = mockDeps();
    registerAgentTools(registry, deps);

    await registry.execute("dismiss_signal", {
      signalId: "sig-1",
      reason: "Normal market behavior",
    });

    expect(deps.dismissSignal).toHaveBeenCalledWith(
      expect.objectContaining({ signalId: "sig-1", reason: "Normal market behavior" })
    );
  });

  it("search_memory tool calls handler with query", async () => {
    const registry = new ToolRegistry();
    const deps = mockDeps();
    registerAgentTools(registry, deps);

    const result = await registry.execute("search_memory", { query: "AAPL price spikes" });
    expect(deps.searchMemory).toHaveBeenCalledWith("AAPL price spikes");
    expect(result).toEqual(
      expect.arrayContaining([expect.objectContaining({ score: 0.9 })])
    );
  });

  it("update_knowledge tool calls handler", async () => {
    const registry = new ToolRegistry();
    const deps = mockDeps();
    registerAgentTools(registry, deps);

    await registry.execute("update_knowledge", {
      type: "pattern",
      content: "AAPL tends to spike on earnings days",
      confidence: 0.85,
    });

    expect(deps.updateKnowledge).toHaveBeenCalled();
  });

  it("spawn_subagent tool calls handler", async () => {
    const registry = new ToolRegistry();
    const deps = mockDeps();
    registerAgentTools(registry, deps);

    const result = await registry.execute("spawn_subagent", {
      type: "volume_analysis",
      prompt: "Deep dive on AAPL volume",
      data: { symbol: "AAPL" },
    });

    expect(deps.spawnSubagent).toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({ sessionId: "sub-1" }));
  });

  it("get_source_health tool returns health map", async () => {
    const registry = new ToolRegistry();
    const deps = mockDeps();
    registerAgentTools(registry, deps);

    const result = await registry.execute("get_source_health", {});
    expect(deps.getSourceHealth).toHaveBeenCalled();
  });

  it("analyze_data tool calls handler with batch", async () => {
    const registry = new ToolRegistry();
    const deps = mockDeps();
    registerAgentTools(registry, deps);

    await registry.execute("analyze_data", {
      ticks: [{ sourceId: "test", timestamp: Date.now(), metrics: { price: 100 }, metadata: {} }],
      annotations: ["Check for volume anomalies"],
    });

    expect(deps.analyzeData).toHaveBeenCalled();
  });

  it("validates flag_anomaly severity enum", async () => {
    const registry = new ToolRegistry();
    const deps = mockDeps();
    registerAgentTools(registry, deps);

    await expect(
      registry.execute("flag_anomaly", {
        severity: "invalid_severity",
        description: "test",
        source: "test",
        metrics: {},
      })
    ).rejects.toThrow();
  });

  it("tool definitions are LLM-compatible", () => {
    const registry = new ToolRegistry();
    const deps = mockDeps();
    registerAgentTools(registry, deps);

    const definitions = registry.getToolDefinitions();
    expect(definitions).toHaveLength(7);
    for (const def of definitions) {
      expect(def.name).toBeDefined();
      expect(def.description).toBeDefined();
      expect(def.inputSchema).toBeDefined();
      expect(def.inputSchema.type).toBe("object");
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/analysis/__tests__/agent-tools.test.ts`
Expected: FAIL

**Step 3: Write minimal implementation**

```typescript
// agent/src/analysis/agent-tools.ts
import { z } from "zod";
import type { ToolRegistry } from "../tools/tool-registry.js";
import type { SearchResult, SourceHealth } from "@finwatch/shared";
import type { SubagentResult } from "../subagents/subagent-spawner.js";

export type AgentToolDeps = {
  flagAnomaly: (args: { severity: string; description: string; source: string; metrics: Record<string, number>; symbol?: string }) => Promise<{ id: string }>;
  dismissSignal: (args: { signalId: string; reason: string }) => Promise<{ dismissed: boolean }>;
  searchMemory: (query: string) => Promise<SearchResult[]>;
  updateKnowledge: (args: { type: string; content: string; confidence: number }) => Promise<{ updated: boolean }>;
  spawnSubagent: (args: { type: string; prompt: string; data: Record<string, unknown> }) => Promise<SubagentResult>;
  getSourceHealth: () => Promise<Record<string, SourceHealth>>;
  analyzeData: (args: { ticks: unknown[]; annotations: string[] }) => Promise<{ annotated: boolean }>;
};

export function registerAgentTools(registry: ToolRegistry, deps: AgentToolDeps): void {
  registry.register({
    name: "flag_anomaly",
    description: "Create an anomaly entry with severity and details. Use when you detect something unusual in the data.",
    inputSchema: z.object({
      severity: z.enum(["low", "medium", "high", "critical"]),
      description: z.string().describe("Description of the anomaly"),
      source: z.string().describe("Data source ID"),
      symbol: z.string().optional().describe("Ticker symbol if applicable"),
      metrics: z.record(z.number()).describe("Relevant metric values"),
    }),
    handler: async (args) => deps.flagAnomaly(args),
  });

  registry.register({
    name: "dismiss_signal",
    description: "Explicitly dismiss a pre-screened signal with a reason. Use when a flagged signal is normal behavior.",
    inputSchema: z.object({
      signalId: z.string().describe("ID of the signal to dismiss"),
      reason: z.string().describe("Reason for dismissal"),
    }),
    handler: async (args) => deps.dismissSignal(args),
  });

  registry.register({
    name: "search_memory",
    description: "Hybrid search against semantic memory. Use to recall relevant historical context.",
    inputSchema: z.object({
      query: z.string().describe("Search query for memory lookup"),
    }),
    handler: async (args) => deps.searchMemory(args.query),
  });

  registry.register({
    name: "update_knowledge",
    description: "Write to domain knowledge tables. Use to store learned patterns, thresholds, or correlations.",
    inputSchema: z.object({
      type: z.enum(["pattern", "threshold", "correlation", "observation"]).describe("Type of knowledge"),
      content: z.string().describe("Knowledge content"),
      confidence: z.number().min(0).max(1).describe("Confidence score 0-1"),
    }),
    handler: async (args) => deps.updateKnowledge(args),
  });

  registry.register({
    name: "spawn_subagent",
    description: "Dispatch a parallel analysis task to a specialized subagent. Types: volume_analysis, price_divergence, correlation, sentiment.",
    inputSchema: z.object({
      type: z.string().describe("Subagent type"),
      prompt: z.string().describe("Task description for the subagent"),
      data: z.record(z.unknown()).describe("Data payload for the subagent"),
    }),
    handler: async (args) => deps.spawnSubagent(args),
  });

  registry.register({
    name: "get_source_health",
    description: "Check data source status. Use to verify data quality before analysis.",
    inputSchema: z.object({}),
    handler: async () => deps.getSourceHealth(),
  });

  registry.register({
    name: "analyze_data",
    description: "Process and annotate a data batch. Use to add context or metadata to ticks before deeper analysis.",
    inputSchema: z.object({
      ticks: z.array(z.unknown()).describe("Data ticks to annotate"),
      annotations: z.array(z.string()).describe("Annotation instructions"),
    }),
    handler: async (args) => deps.analyzeData(args),
  });
}
```

Now create the barrel export:

```typescript
// agent/src/analysis/index.ts
export { zScore, zScoreBatch, type ZScoreResult } from "./z-score.js";
export {
  simpleMovingAverage,
  exponentialMovingAverage,
  detectMACrossover,
  type CrossoverSignal,
} from "./moving-average.js";
export { RuleEngine, type Rule, type RuleCondition, type RuleResult } from "./rule-engine.js";
export { PreScreen, type PreScreenConfig, type PreScreenResult, type PreScreenRoute } from "./pre-screen.js";
export {
  assembleContext,
  CONTEXT_BUDGET,
  type ContextAssemblyInput,
  type AssembledContext,
} from "./context-assembly.js";
export { AnalysisTurn, type AnalysisTurnDeps, type AnalysisTurnInput, type TurnResult } from "./analysis-turn.js";
export { MonitorLoop, type MonitorLoopDeps, type MonitorLoopConfig, type CycleResult } from "./monitor-loop.js";
export { registerAgentTools, type AgentToolDeps } from "./agent-tools.js";
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/analysis/__tests__/agent-tools.test.ts`
Expected: PASS

**Step 5: Run all analysis tests**

Run: `cd /Users/jdsingh/Projects/AI/finwatch && npx vitest run agent/src/analysis/`
Expected: All pass

**Step 6: Commit**

```bash
git add agent/src/analysis/__tests__/agent-tools.test.ts agent/src/analysis/agent-tools.ts agent/src/analysis/index.ts
git commit -m "feat(analysis): add all 7 agent tools and barrel export"
```

---

## Verification Checklist

After all tasks are complete, verify:

```
[ ] npx vitest run agent/src/analysis/ — all pass
[ ] npx vitest run agent/src/subagents/ — all pass
[ ] Pre-screen correctly routes synthetic anomalies (z-score + MA + rules)
[ ] Full analysis turn produces anomaly flags from mock data
[ ] Monitor loop starts, runs 3 cycles, stops cleanly
[ ] Subagents spawn, execute, return results with concurrency limit
[ ] All 7 agent tools registered and callable
[ ] No files modified outside agent/src/analysis/ and agent/src/subagents/
[ ] All work committed to feat/analysis-loop branch
```
