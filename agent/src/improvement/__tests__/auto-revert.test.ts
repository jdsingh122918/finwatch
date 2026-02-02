import { describe, it, expect, vi } from "vitest";
import { AutoRevert, type AutoRevertDeps, type RevertResult } from "../auto-revert.js";

describe("AutoRevert", () => {
  it("reverts when FP rate exceeds 50%", () => {
    const revertFn = vi.fn();
    const notifyFn = vi.fn();

    const revert = new AutoRevert({
      fpRateThreshold: 0.5, revert: revertFn, notify: notifyFn,
      getPreviousVersion: vi.fn().mockReturnValue("rules_v001.json"),
      readFile: vi.fn().mockReturnValue('[{"id":"r1"}]'),
    });

    const result = revert.check(0.55, 3);
    expect(result.reverted).toBe(true);
    expect(revertFn).toHaveBeenCalledWith('[{"id":"r1"}]');
    expect(notifyFn).toHaveBeenCalledWith(expect.stringContaining("Auto-revert"));
  });

  it("does not revert when FP rate is within threshold", () => {
    const revertFn = vi.fn();
    const revert = new AutoRevert({
      fpRateThreshold: 0.5, revert: revertFn, notify: vi.fn(),
      getPreviousVersion: vi.fn(), readFile: vi.fn(),
    });

    const result = revert.check(0.3, 3);
    expect(result.reverted).toBe(false);
    expect(revertFn).not.toHaveBeenCalled();
  });

  it("does not revert at exact threshold", () => {
    const revert = new AutoRevert({
      fpRateThreshold: 0.5, revert: vi.fn(), notify: vi.fn(),
      getPreviousVersion: vi.fn(), readFile: vi.fn(),
    });
    expect(revert.check(0.5, 3).reverted).toBe(false);
  });

  it("does not revert without previous version", () => {
    const revert = new AutoRevert({
      fpRateThreshold: 0.5, revert: vi.fn(), notify: vi.fn(),
      getPreviousVersion: vi.fn().mockReturnValue(null), readFile: vi.fn(),
    });

    const result = revert.check(0.8, 3);
    expect(result.reverted).toBe(false);
    expect(result.reason).toContain("no previous version");
  });

  it("does not revert below minimum feedback count", () => {
    const revert = new AutoRevert({
      fpRateThreshold: 0.5, revert: vi.fn(), notify: vi.fn(),
      getPreviousVersion: vi.fn().mockReturnValue("rules_v001.json"),
      readFile: vi.fn().mockReturnValue("[]"), minFeedbackCount: 5,
    });

    const result = revert.check(0.9, 3);
    expect(result.reverted).toBe(false);
    expect(result.reason).toContain("insufficient feedback");
  });

  it("returns revert metadata", () => {
    const revert = new AutoRevert({
      fpRateThreshold: 0.5, revert: vi.fn(), notify: vi.fn(),
      getPreviousVersion: vi.fn().mockReturnValue("rules_v002.json"),
      readFile: vi.fn().mockReturnValue("[{}]"),
    });

    const result = revert.check(0.7, 10);
    expect(result.reverted).toBe(true);
    expect(result.previousVersion).toBe("rules_v002.json");
    expect(result.fpRate).toBe(0.7);
  });
});
