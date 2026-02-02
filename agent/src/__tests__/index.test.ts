import { describe, it, expect } from "vitest";

describe("agent entry", () => {
  it("exports a start function", async () => {
    const mod = await import("../index.js");
    expect(typeof mod.start).toBe("function");
  });
});
