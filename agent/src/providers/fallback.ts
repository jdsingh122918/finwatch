import type {
  LLMProvider,
  ProviderHealth,
  CreateMessageParams,
  StreamEvent,
} from "@finwatch/shared";

export type ProviderError = {
  providerId: string;
  error: Error;
};

export class AllProvidersFailedError extends Error {
  readonly errors: ProviderError[];

  constructor(errors: ProviderError[]) {
    const summary = errors.map((e) => `${e.providerId}: ${e.error.message}`).join("; ");
    super(`All providers failed: ${summary}`);
    this.name = "AllProvidersFailedError";
    this.errors = errors;
  }
}

export function withFallback(providers: LLMProvider[]): LLMProvider {
  if (providers.length === 0) {
    throw new Error("At least one provider is required");
  }

  return {
    id: "fallback",
    name: `Fallback(${providers.map((p) => p.id).join(", ")})`,

    async *createMessage(params: CreateMessageParams): AsyncIterable<StreamEvent> {
      const errors: ProviderError[] = [];

      for (const provider of providers) {
        try {
          const events: StreamEvent[] = [];
          for await (const event of provider.createMessage(params)) {
            events.push(event);
          }
          // Only yield if we successfully consumed the entire stream
          for (const event of events) {
            yield event;
          }
          return;
        } catch (err) {
          errors.push({
            providerId: provider.id,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      }

      throw new AllProvidersFailedError(errors);
    },

    async healthCheck(): Promise<ProviderHealth> {
      for (const provider of providers) {
        try {
          const health = await provider.healthCheck();
          if (health.status === "healthy" || health.status === "degraded") {
            return health;
          }
        } catch {
          // try next
        }
      }

      return {
        providerId: "fallback",
        status: "offline",
        latencyMs: -1,
        lastError: "All providers unhealthy",
      };
    },

    listModels(): string[] {
      const seen = new Set<string>();
      const models: string[] = [];
      for (const provider of providers) {
        for (const model of provider.listModels()) {
          if (!seen.has(model)) {
            seen.add(model);
            models.push(model);
          }
        }
      }
      return models;
    },
  };
}
