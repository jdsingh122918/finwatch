import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { SourceConfig } from "@finwatch/shared";
import type { DataSource } from "./types.js";
import type { SourceRegistry } from "./source-registry.js";

type CustomSourceModule = {
  sourceConfig?: SourceConfig;
  createSource?: (config: SourceConfig) => DataSource;
};

export class CustomSourceLoader extends EventEmitter {
  private registry: SourceRegistry;
  private directory: string;

  constructor(registry: SourceRegistry, directory: string) {
    super();
    this.registry = registry;
    this.directory = directory;
  }

  async loadAll(): Promise<string[]> {
    if (!fs.existsSync(this.directory)) {
      return [];
    }

    const entries = await fs.promises.readdir(this.directory);
    const tsFiles = entries.filter((f) => f.endsWith(".ts")).sort();
    const loaded: string[] = [];

    for (const filename of tsFiles) {
      const filePath = path.join(this.directory, filename);
      try {
        const sourceId = await this.loadFile(filePath);
        if (sourceId) {
          loaded.push(sourceId);
        }
      } catch (err) {
        this.emit(
          "error",
          new Error(
            `Failed to load ${filename}: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
    }

    return loaded;
  }

  private async loadFile(filePath: string): Promise<string | null> {
    let mod: CustomSourceModule;

    try {
      const fileUrl = pathToFileURL(filePath).href;
      mod = (await import(fileUrl)) as CustomSourceModule;
    } catch (err) {
      throw new Error(
        `Import failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // Validate sourceConfig export
    if (!mod.sourceConfig || typeof mod.sourceConfig !== "object") {
      throw new Error("Missing or invalid 'sourceConfig' export");
    }

    // Validate createSource export
    if (typeof mod.createSource !== "function") {
      throw new Error("Missing 'createSource' function export");
    }

    const config = mod.sourceConfig;
    const source = mod.createSource(config);

    // Validate returned source object
    if (!this.isValidDataSource(source)) {
      throw new Error(
        "createSource() returned object missing required methods (start, stop, healthCheck, fetch)"
      );
    }

    this.registry.register(source);
    this.emit("loaded", source.id);
    return source.id;
  }

  private isValidDataSource(obj: unknown): obj is DataSource {
    if (typeof obj !== "object" || obj === null) return false;

    const source = obj as Record<string, unknown>;
    return (
      typeof source.id === "string" &&
      typeof source.config === "object" &&
      typeof source.start === "function" &&
      typeof source.stop === "function" &&
      typeof source.healthCheck === "function" &&
      typeof source.fetch === "function"
    );
  }
}
