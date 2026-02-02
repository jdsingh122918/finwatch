import type { LLMProvider, ProviderHealth } from "@finwatch/shared";

export class ProviderRegistry {
  private providers = new Map<string, LLMProvider>();

  register(provider: LLMProvider): void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
  }

  unregister(id: string): void {
    this.providers.delete(id);
  }

  get(id: string): LLMProvider | undefined {
    return this.providers.get(id);
  }

  list(): LLMProvider[] {
    return [...this.providers.values()];
  }

  async health(): Promise<ProviderHealth[]> {
    const results: ProviderHealth[] = [];

    for (const provider of this.providers.values()) {
      try {
        const h = await provider.healthCheck();
        results.push(h);
      } catch (err) {
        results.push({
          providerId: provider.id,
          status: "offline",
          latencyMs: -1,
          lastError: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return results;
  }
}
