export type AutoRevertDeps = {
  fpRateThreshold: number;
  revert: (previousRulesJson: string) => void;
  notify: (message: string) => void;
  getPreviousVersion: () => string | null;
  readFile: (path: string) => string;
  minFeedbackCount?: number;
};

export type RevertResult = {
  reverted: boolean;
  reason?: string;
  previousVersion?: string;
  fpRate: number;
};

export class AutoRevert {
  private deps: AutoRevertDeps;

  constructor(deps: AutoRevertDeps) { this.deps = deps; }

  check(currentFpRate: number, feedbackCount: number): RevertResult {
    const minCount = this.deps.minFeedbackCount ?? 0;

    if (feedbackCount < minCount) {
      return { reverted: false, reason: "insufficient feedback count", fpRate: currentFpRate };
    }

    if (currentFpRate <= this.deps.fpRateThreshold) {
      return { reverted: false, fpRate: currentFpRate };
    }

    const previousVersion = this.deps.getPreviousVersion();
    if (!previousVersion) {
      return { reverted: false, reason: "no previous version available", fpRate: currentFpRate };
    }

    const previousRules = this.deps.readFile(previousVersion);
    this.deps.revert(previousRules);
    this.deps.notify(`Auto-revert triggered: FP rate ${(currentFpRate * 100).toFixed(1)}% exceeds threshold ${(this.deps.fpRateThreshold * 100).toFixed(1)}%. Reverted to ${previousVersion}.`);

    return { reverted: true, previousVersion, fpRate: currentFpRate };
  }
}
