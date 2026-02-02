import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import type { DataTick, SourceHealth, SourceConfig } from "@finwatch/shared";
import { SourceRegistry } from "../source-registry.js";
import { CustomSourceLoader } from "../custom-source-loader.js";

const TEST_DIR = path.join(import.meta.dirname ?? ".", ".test-custom-sources");

function writeSourceFile(filename: string, content: string): string {
  const filePath = path.join(TEST_DIR, filename);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

describe("CustomSourceLoader", () => {
  let registry: SourceRegistry;

  beforeEach(() => {
    fs.mkdirSync(TEST_DIR, { recursive: true });
    registry = new SourceRegistry();
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("constructs with a registry and source directory", () => {
    const loader = new CustomSourceLoader(registry, TEST_DIR);
    expect(loader).toBeDefined();
  });

  it("loads a valid custom source file and registers it", async () => {
    writeSourceFile(
      "test-source.ts",
      `
      export const sourceConfig = {
        id: "custom-test",
        name: "Custom Test",
        type: "polling",
        plugin: "custom-test",
        config: {},
        enabled: true,
      };

      export function createSource(config) {
        return {
          id: config.id,
          config,
          start: async () => {},
          stop: async () => {},
          healthCheck: async () => ({
            sourceId: config.id,
            status: "healthy",
            lastSuccess: Date.now(),
            failCount: 0,
            latencyMs: 0,
          }),
          fetch: async () => [],
        };
      }
      `
    );

    const loader = new CustomSourceLoader(registry, TEST_DIR);
    const loaded = await loader.loadAll();

    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toBe("custom-test");
    expect(registry.get("custom-test")).toBeDefined();
  });

  it("skips files that do not export createSource function", async () => {
    writeSourceFile(
      "bad-source.ts",
      `
      export const sourceConfig = {
        id: "bad",
        name: "Bad",
        type: "polling",
        plugin: "bad",
        config: {},
        enabled: true,
      };
      // Missing createSource export
      `
    );

    const loader = new CustomSourceLoader(registry, TEST_DIR);
    const errorHandler = vi.fn();
    loader.on("error", errorHandler);
    const loaded = await loader.loadAll();

    expect(loaded).toHaveLength(0);
    expect(errorHandler).toHaveBeenCalledOnce();
  });

  it("skips files that do not export sourceConfig", async () => {
    writeSourceFile(
      "no-config.ts",
      `
      export function createSource(config) {
        return {
          id: config.id,
          config,
          start: async () => {},
          stop: async () => {},
          healthCheck: async () => ({
            sourceId: config.id, status: "healthy",
            lastSuccess: Date.now(), failCount: 0, latencyMs: 0,
          }),
          fetch: async () => [],
        };
      }
      `
    );

    const loader = new CustomSourceLoader(registry, TEST_DIR);
    const errorHandler = vi.fn();
    loader.on("error", errorHandler);
    const loaded = await loader.loadAll();

    expect(loaded).toHaveLength(0);
    expect(errorHandler).toHaveBeenCalledOnce();
  });

  it("handles import errors gracefully", async () => {
    writeSourceFile("syntax-error.ts", "export const x = {{{{");

    const loader = new CustomSourceLoader(registry, TEST_DIR);
    const errorHandler = vi.fn();
    loader.on("error", errorHandler);
    const loaded = await loader.loadAll();

    expect(loaded).toHaveLength(0);
    expect(errorHandler).toHaveBeenCalled();
  });

  it("loads multiple source files from directory", async () => {
    const makeSource = (id: string) => `
      export const sourceConfig = {
        id: "${id}",
        name: "${id}",
        type: "polling",
        plugin: "${id}",
        config: {},
        enabled: true,
      };
      export function createSource(config) {
        return {
          id: config.id, config,
          start: async () => {}, stop: async () => {},
          healthCheck: async () => ({
            sourceId: config.id, status: "healthy",
            lastSuccess: Date.now(), failCount: 0, latencyMs: 0,
          }),
          fetch: async () => [],
        };
      }
    `;

    writeSourceFile("source-a.ts", makeSource("source-a"));
    writeSourceFile("source-b.ts", makeSource("source-b"));

    const loader = new CustomSourceLoader(registry, TEST_DIR);
    const loaded = await loader.loadAll();

    expect(loaded).toHaveLength(2);
    expect(registry.get("source-a")).toBeDefined();
    expect(registry.get("source-b")).toBeDefined();
  });

  it("ignores non-.ts files in the directory", async () => {
    fs.writeFileSync(path.join(TEST_DIR, "readme.md"), "# notes", "utf-8");
    fs.writeFileSync(path.join(TEST_DIR, "data.json"), "{}", "utf-8");

    const loader = new CustomSourceLoader(registry, TEST_DIR);
    const loaded = await loader.loadAll();

    expect(loaded).toHaveLength(0);
  });

  it("returns empty array when directory does not exist", async () => {
    const loader = new CustomSourceLoader(
      registry,
      path.join(TEST_DIR, "nonexistent")
    );
    const loaded = await loader.loadAll();
    expect(loaded).toEqual([]);
  });

  it("validates that createSource returns an object with required methods", async () => {
    writeSourceFile(
      "incomplete.ts",
      `
      export const sourceConfig = {
        id: "incomplete",
        name: "Incomplete",
        type: "polling",
        plugin: "incomplete",
        config: {},
        enabled: true,
      };
      export function createSource(config) {
        return { id: config.id, config };
        // Missing start, stop, healthCheck, fetch
      }
      `
    );

    const loader = new CustomSourceLoader(registry, TEST_DIR);
    const errorHandler = vi.fn();
    loader.on("error", errorHandler);
    const loaded = await loader.loadAll();

    expect(loaded).toHaveLength(0);
    expect(errorHandler).toHaveBeenCalled();
  });

  it("emits 'loaded' event for each successfully loaded source", async () => {
    writeSourceFile(
      "emitter.ts",
      `
      export const sourceConfig = {
        id: "emitter-src",
        name: "Emitter",
        type: "polling",
        plugin: "emitter",
        config: {},
        enabled: true,
      };
      export function createSource(config) {
        return {
          id: config.id, config,
          start: async () => {}, stop: async () => {},
          healthCheck: async () => ({
            sourceId: config.id, status: "healthy",
            lastSuccess: Date.now(), failCount: 0, latencyMs: 0,
          }),
          fetch: async () => [],
        };
      }
      `
    );

    const loader = new CustomSourceLoader(registry, TEST_DIR);
    const loadedHandler = vi.fn();
    loader.on("loaded", loadedHandler);
    await loader.loadAll();

    expect(loadedHandler).toHaveBeenCalledOnce();
    expect(loadedHandler.mock.calls[0]![0]).toBe("emitter-src");
  });
});
