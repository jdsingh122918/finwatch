import { describe, it, expect } from "vitest";
import { extractKnowledge } from "../auto-capture.js";

const cfg = { maxUpdatesPerTurn: 5, dedupThreshold: 0.9 };

describe("extractKnowledge", () => {
  it("extracts patterns from response", () => {
    const r = extractKnowledge("Observation: AAPL volume spikes consistently before earnings.", cfg);
    expect(r.length).toBeGreaterThan(0);
    expect(r.length).toBeLessThanOrEqual(5);
  });

  it("respects max limit", () => {
    const r = extractKnowledge(Array(20).fill("Pattern: new thing detected in data.").join("\n"), { ...cfg, maxUpdatesPerTurn: 3 });
    expect(r.length).toBeLessThanOrEqual(3);
  });

  it("extracts typed facts", () => {
    const r = extractKnowledge("Threshold recommendation: flag AAPL if volume exceeds 5M.\nCorrelation: BTC price leads COIN stock.", cfg);
    expect(r.some(x => x.type === "threshold" || x.type === "correlation")).toBe(true);
  });

  it("returns empty for uninformative response", () => {
    expect(extractKnowledge("No anomalies detected. Everything looks normal.", cfg)).toHaveLength(0);
  });
});
