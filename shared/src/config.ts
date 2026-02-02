import { z } from "zod";

const ProviderConfigSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["anthropic", "claude-max", "openrouter"]),
  apiKeyEnv: z.string().optional(),
});

const ModelAssignmentSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
});

const ModelConfigSchema = z.object({
  analysis: ModelAssignmentSchema,
  subagent: ModelAssignmentSchema,
  improvement: ModelAssignmentSchema,
  fallbacks: z.array(ModelAssignmentSchema).default([]),
  temperature: z.number().min(0).max(2).default(0.3),
  maxTokens: z.number().int().positive().default(8192),
});

const PreScreenConfigSchema = z.object({
  zScoreThreshold: z.number().nonnegative().default(3.0),
  urgentThreshold: z.number().min(0).max(1).default(0.6),
  skipThreshold: z.number().min(0).max(1).default(0.2),
});

const MonitorConfigSchema = z.object({
  analysisIntervalMs: z.number().int().positive().default(60000),
  preScreen: PreScreenConfigSchema,
  maxCycleTokenRatio: z.number().min(0).max(1).default(0.8),
  maxCycleAgeMs: z.number().int().positive().default(14400000),
});

const SourceConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["polling", "streaming", "file"]),
  plugin: z.string().min(1),
  config: z.record(z.unknown()),
  pollIntervalMs: z.number().int().positive().optional(),
  enabled: z.boolean().default(true),
});

const MemoryConfigSchema = z.object({
  embedding: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
  }),
  search: z.object({
    vectorWeight: z.number().min(0).max(1).default(0.7),
    textWeight: z.number().min(0).max(1).default(0.3),
    maxResults: z.number().int().positive().default(6),
    minScore: z.number().min(0).max(1).default(0.35),
  }),
  chunking: z.object({
    tokens: z.number().int().positive().default(400),
    overlap: z.number().int().nonnegative().default(80),
  }),
});

const ImprovementConfigSchema = z.object({
  feedback: z.object({
    batchSize: z.number().int().positive().default(10),
    batchIntervalMs: z.number().int().positive().default(7200000),
  }),
  evolution: z.object({
    enabled: z.boolean().default(true),
    intervalMs: z.number().int().positive().default(86400000),
    autoRevertThreshold: z.number().min(0).max(1).default(0.5),
  }),
  consolidation: z.object({
    enabled: z.boolean().default(true),
    intervalMs: z.number().int().positive().default(604800000),
  }),
});

const SubagentConfigSchema = z.object({
  maxConcurrent: z.number().int().positive().default(3),
  defaultTimeoutSeconds: z.number().int().positive().default(120),
});

export const ConfigSchema = z.object({
  providers: z.array(ProviderConfigSchema).min(1),
  model: ModelConfigSchema,
  monitor: MonitorConfigSchema,
  sources: z.array(SourceConfigSchema).default([]),
  memory: MemoryConfigSchema,
  improvement: ImprovementConfigSchema,
  subagents: SubagentConfigSchema,
});

export type Config = z.infer<typeof ConfigSchema>;

export function parseConfig(raw: unknown): Config {
  return ConfigSchema.parse(raw);
}
