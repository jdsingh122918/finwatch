import type { TradeAction, TradeSuggestion, SuggestionStatus } from "@finwatch/shared";

export type LiveSuggesterConfig = {
  expirationMs: number;
};

let suggestionSeq = 0;

export class LiveSuggester {
  private config: LiveSuggesterConfig;
  private suggestions: Map<string, TradeSuggestion> = new Map();

  onSuggestion?: (suggestion: TradeSuggestion) => void;
  onApproved?: (suggestion: TradeSuggestion) => void;
  onDismissed?: (suggestion: TradeSuggestion) => void;
  onExpired?: (suggestion: TradeSuggestion) => void;

  constructor(config: LiveSuggesterConfig) {
    this.config = config;
  }

  suggest(action: TradeAction): TradeSuggestion {
    const suggestion: TradeSuggestion = {
      id: `suggestion-${++suggestionSeq}-${Date.now()}`,
      action,
      expiresAt: Date.now() + this.config.expirationMs,
      status: "pending",
    };

    this.suggestions.set(suggestion.id, suggestion);
    this.onSuggestion?.(suggestion);
    return suggestion;
  }

  approve(id: string): boolean {
    return this.transition(id, "approved", this.onApproved);
  }

  dismiss(id: string): boolean {
    return this.transition(id, "dismissed", this.onDismissed);
  }

  expireStale(): number {
    const now = Date.now();
    let count = 0;

    for (const suggestion of this.suggestions.values()) {
      if (suggestion.status === "pending" && now > suggestion.expiresAt) {
        suggestion.status = "expired";
        this.onExpired?.(suggestion);
        count++;
      }
    }

    return count;
  }

  getPending(): TradeSuggestion[] {
    return Array.from(this.suggestions.values()).filter(
      (s) => s.status === "pending",
    );
  }

  getAll(): TradeSuggestion[] {
    return Array.from(this.suggestions.values());
  }

  private transition(
    id: string,
    newStatus: SuggestionStatus,
    callback?: (suggestion: TradeSuggestion) => void,
  ): boolean {
    const suggestion = this.suggestions.get(id);
    if (!suggestion || suggestion.status !== "pending") {
      return false;
    }

    suggestion.status = newStatus;
    callback?.(suggestion);
    return true;
  }
}
