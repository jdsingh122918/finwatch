import { z } from "zod";

// Stub: full schema implemented in Task 4
export const ConfigSchema = z.object({}).passthrough();

export type Config = z.infer<typeof ConfigSchema>;

export function parseConfig(raw: unknown): Config {
  return ConfigSchema.parse(raw);
}
