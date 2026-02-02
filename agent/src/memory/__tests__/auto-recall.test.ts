import { describe, it, expect, vi } from "vitest";
import { buildRecallContext } from "../auto-recall.js";
import type { SearchResult, DomainPattern, DomainThreshold } from "@finwatch/shared";

const mockSearch = vi.fn<(q: string) => SearchResult[]>();
const mockPatterns = vi.fn<() => DomainPattern[]>();
const mockThresholds = vi.fn<() => DomainThreshold[]>();
const sources = { search: mockSearch, getPatterns: mockPatterns, getThresholds: mockThresholds };
const cfg = { maxMemoryResults: 3, maxPatterns: 5, maxThresholds: 5 };

describe("buildRecallContext", () => {
  it("includes memory results", () => {
    mockSearch.mockReturnValue([{ entry: { id: "e1", content: "AAPL spike", embedding: [], source: "a", timestamp: 1, tags: [] }, score: 0.8, matchType: "hybrid" }]);
    mockPatterns.mockReturnValue([]); mockThresholds.mockReturnValue([]);
    const ctx = buildRecallContext("AAPL", sources, cfg);
    expect(ctx).toContain("AAPL spike");
    expect(ctx).toContain("<relevant-context>");
  });

  it("includes patterns", () => {
    mockSearch.mockReturnValue([]); mockThresholds.mockReturnValue([]);
    mockPatterns.mockReturnValue([{ id: "p1", pattern: "earnings cause spikes", confidence: 0.9, source: "a", createdAt: 1, updatedAt: 1 }]);
    expect(buildRecallContext("test", sources, cfg)).toContain("earnings cause spikes");
  });

  it("includes thresholds", () => {
    mockSearch.mockReturnValue([]); mockPatterns.mockReturnValue([]);
    mockThresholds.mockReturnValue([{ id: "t1", source: "yahoo", metric: "volume", value: 5e6, direction: "above", updatedAt: 1 }]);
    expect(buildRecallContext("test", sources, cfg)).toContain("5000000");
  });

  it("returns fallback when empty", () => {
    mockSearch.mockReturnValue([]); mockPatterns.mockReturnValue([]); mockThresholds.mockReturnValue([]);
    expect(buildRecallContext("test", sources, cfg)).toContain("No prior context");
  });
});
