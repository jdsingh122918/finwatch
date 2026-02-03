import type { TradingMode } from "@finwatch/shared";

export type GateThresholds = {
  minPaperDays: number;
  minPaperTrades: number;
};

export type PaperHistory = {
  paperTradeDays: number;
  paperTradeCount: number;
};

export type GateCheckResult = {
  allowed: boolean;
  reasons: string[];
};

export type SetModeResult = {
  success: boolean;
  reasons: string[];
};

const DEFAULT_THRESHOLDS: GateThresholds = {
  minPaperDays: 7,
  minPaperTrades: 20,
};

export class TradingGate {
  private _mode: TradingMode = "paper";
  private _killed = false;
  private thresholds: GateThresholds;

  onKill?: () => void;

  constructor(thresholds?: Partial<GateThresholds>) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  get mode(): TradingMode {
    return this._mode;
  }

  get killed(): boolean {
    return this._killed;
  }

  canGoLive(history: PaperHistory): GateCheckResult {
    const reasons: string[] = [];

    if (history.paperTradeDays < this.thresholds.minPaperDays) {
      reasons.push(
        `Requires ${this.thresholds.minPaperDays}+ days of paper trading (current: ${history.paperTradeDays})`,
      );
    }

    if (history.paperTradeCount < this.thresholds.minPaperTrades) {
      reasons.push(
        `Requires ${this.thresholds.minPaperTrades}+ paper trades (current: ${history.paperTradeCount})`,
      );
    }

    return { allowed: reasons.length === 0, reasons };
  }

  setMode(mode: TradingMode, history: PaperHistory): SetModeResult {
    if (mode === "paper") {
      this._mode = "paper";
      return { success: true, reasons: [] };
    }

    // Switching to live
    if (this._killed) {
      return {
        success: false,
        reasons: ["Kill switch active — reset required"],
      };
    }

    const check = this.canGoLive(history);
    if (!check.allowed) {
      return { success: false, reasons: check.reasons };
    }

    this._mode = "live";
    return { success: true, reasons: [] };
  }

  killSwitch(): void {
    this._mode = "paper";
    this._killed = true;
    this.onKill?.();
  }

  reset(): void {
    this._killed = false;
    this._mode = "paper";
  }
}
