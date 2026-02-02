import { describe, it, expect } from "vitest";
import { ConfigSchema, parseConfig } from "../config.js";

const validConfig = {
  providers: [
    { id: "anthropic", type: "anthropic" as const, apiKeyEnv: "ANTHROPIC_API_KEY" },
  ],
  model: {
    analysis: { provider: "anthropic", model: "claude-opus-4-5-20251101" },
    subagent: { provider: "anthropic", model: "claude-sonnet-4-5-20241022" },
    improvement: { provider: "anthropic", model: "claude-opus-4-5-20251101" },
    fallbacks: [],
    temperature: 0.3,
    maxTokens: 8192,
  },
  monitor: {
    analysisIntervalMs: 60000,
    preScreen: { zScoreThreshold: 3.0, urgentThreshold: 0.6, skipThreshold: 0.2 },
    maxCycleTokenRatio: 0.8,
    maxCycleAgeMs: 14400000,
  },
  sources: [
    {
      id: "yahoo-finance",
      name: "Yahoo Finance",
      type: "polling" as const,
      plugin: "market-api",
      config: { provider: "yahoo", symbols: ["AAPL", "GOOGL"], interval: "5m" },
      pollIntervalMs: 300000,
      enabled: true,
    },
  ],
  memory: {
    embedding: { provider: "openai", model: "text-embedding-3-small" },
    search: { vectorWeight: 0.7, textWeight: 0.3, maxResults: 6, minScore: 0.35 },
    chunking: { tokens: 400, overlap: 80 },
  },
  improvement: {
    feedback: { batchSize: 10, batchIntervalMs: 7200000 },
    evolution: { enabled: true, intervalMs: 86400000, autoRevertThreshold: 0.5 },
    consolidation: { enabled: true, intervalMs: 604800000 },
  },
  subagents: { maxConcurrent: 3, defaultTimeoutSeconds: 120 },
};

describe("ConfigSchema", () => {
  it("parses a valid full config", () => {
    const result = ConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it("rejects missing required fields", () => {
    const result = ConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects invalid provider type", () => {
    const bad = {
      ...validConfig,
      providers: [{ id: "x", type: "invalid", apiKeyEnv: "X" }],
    };
    const result = ConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects negative analysisIntervalMs", () => {
    const bad = {
      ...validConfig,
      monitor: { ...validConfig.monitor, analysisIntervalMs: -1 },
    };
    const result = ConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects zScoreThreshold below 0", () => {
    const bad = {
      ...validConfig,
      monitor: {
        ...validConfig.monitor,
        preScreen: { ...validConfig.monitor.preScreen, zScoreThreshold: -1 },
      },
    };
    const result = ConfigSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("applies defaults for optional fields", () => {
    const minimal = {
      providers: validConfig.providers,
      model: validConfig.model,
      monitor: validConfig.monitor,
      sources: [],
      memory: validConfig.memory,
      improvement: validConfig.improvement,
      subagents: validConfig.subagents,
    };
    const result = ConfigSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });
});

describe("parseConfig", () => {
  it("returns parsed config for valid input", () => {
    const config = parseConfig(validConfig);
    expect(config.providers[0].id).toBe("anthropic");
  });

  it("throws on invalid input", () => {
    expect(() => parseConfig({})).toThrow();
  });
});
