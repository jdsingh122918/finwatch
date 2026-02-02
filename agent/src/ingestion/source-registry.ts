import type { SourceHealth } from "@finwatch/shared";
import type { DataSource } from "./types.js";

export class SourceRegistry {
  private sources = new Map<string, DataSource>();

  register(source: DataSource): void {
    if (this.sources.has(source.id)) {
      throw new Error(`Source already registered: ${source.id}`);
    }
    this.sources.set(source.id, source);
  }

  unregister(id: string): void {
    this.sources.delete(id);
  }

  get(id: string): DataSource | undefined {
    return this.sources.get(id);
  }

  list(): DataSource[] {
    return [...this.sources.values()];
  }

  async start(id: string): Promise<void> {
    const source = this.sources.get(id);
    if (!source) {
      throw new Error(`Source not found: ${id}`);
    }
    await source.start();
  }

  async stop(id: string): Promise<void> {
    const source = this.sources.get(id);
    if (!source) {
      throw new Error(`Source not found: ${id}`);
    }
    await source.stop();
  }

  async startAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const source of this.sources.values()) {
      if (source.config.enabled) {
        promises.push(source.start());
      }
    }
    await Promise.all(promises);
  }

  async stopAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const source of this.sources.values()) {
      promises.push(source.stop());
    }
    await Promise.all(promises);
  }

  async fetch(id: string): Promise<import("@finwatch/shared").DataTick[]> {
    const source = this.sources.get(id);
    if (!source) {
      throw new Error(`Source not found: ${id}`);
    }
    return source.fetch();
  }

  async healthCheck(): Promise<SourceHealth[]> {
    const results: SourceHealth[] = [];

    for (const source of this.sources.values()) {
      try {
        const h = await source.healthCheck();
        results.push(h);
      } catch (err) {
        results.push({
          sourceId: source.id,
          status: "offline",
          lastSuccess: 0,
          failCount: 0,
          latencyMs: -1,
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    return results;
  }
}
