import type { TradeAuditEntry, TradeOutcome } from "@finwatch/shared";

export type SymbolMetrics = {
  count: number;
  wins: number;
  losses: number;
  winRate: number;
};

export type SideMetrics = {
  count: number;
  wins: number;
  losses: number;
  winRate: number;
};

export type TradingMetrics = {
  totalTrades: number;
  resolvedCount: number;
  winRate: number;
  bySymbol: Map<string, SymbolMetrics>;
  bySide: Map<string, SideMetrics>;
};

const RESOLVED_OUTCOMES = new Set<TradeOutcome>(["profit", "loss"]);

function computeWinRate(wins: number, total: number): number {
  if (total === 0) return 0;
  return wins / total;
}

export class TradingPerformanceAnalyzer {
  analyze(history: TradeAuditEntry[]): TradingMetrics {
    const resolved = history.filter((e) => RESOLVED_OUTCOMES.has(e.outcome));
    const wins = resolved.filter((e) => e.outcome === "profit").length;

    const bySymbol = new Map<string, SymbolMetrics>();
    const bySide = new Map<string, SideMetrics>();

    for (const entry of resolved) {
      const symbol = entry.action.symbol;
      const side = entry.action.side;
      const isWin = entry.outcome === "profit";

      // Per-symbol
      if (!bySymbol.has(symbol)) {
        bySymbol.set(symbol, { count: 0, wins: 0, losses: 0, winRate: 0 });
      }
      const sym = bySymbol.get(symbol)!;
      sym.count++;
      if (isWin) sym.wins++;
      else sym.losses++;
      sym.winRate = computeWinRate(sym.wins, sym.count);

      // Per-side
      if (!bySide.has(side)) {
        bySide.set(side, { count: 0, wins: 0, losses: 0, winRate: 0 });
      }
      const s = bySide.get(side)!;
      s.count++;
      if (isWin) s.wins++;
      else s.losses++;
      s.winRate = computeWinRate(s.wins, s.count);
    }

    return {
      totalTrades: history.length,
      resolvedCount: resolved.length,
      winRate: computeWinRate(wins, resolved.length),
      bySymbol,
      bySide,
    };
  }

  generateReport(history: TradeAuditEntry[]): string {
    const metrics = this.analyze(history);
    const lines: string[] = [];

    lines.push("# Trading Performance");
    lines.push("");
    lines.push(`- **Total Trades:** ${metrics.totalTrades}`);
    lines.push(`- **Resolved:** ${metrics.resolvedCount}`);
    lines.push(`- **Win Rate:** ${(metrics.winRate * 100).toFixed(1)}%`);
    lines.push("");

    if (metrics.bySymbol.size > 0) {
      lines.push("## By Symbol");
      lines.push("");
      lines.push("| Symbol | Trades | Wins | Losses | Win Rate |");
      lines.push("|--------|--------|------|--------|----------|");
      for (const [symbol, m] of metrics.bySymbol) {
        lines.push(
          `| ${symbol} | ${m.count} | ${m.wins} | ${m.losses} | ${(m.winRate * 100).toFixed(1)}% |`,
        );
      }
      lines.push("");
    }

    if (metrics.bySide.size > 0) {
      lines.push("## By Side");
      lines.push("");
      lines.push("| Side | Trades | Wins | Losses | Win Rate |");
      lines.push("|------|--------|------|--------|----------|");
      for (const [side, m] of metrics.bySide) {
        lines.push(
          `| ${side} | ${m.count} | ${m.wins} | ${m.losses} | ${(m.winRate * 100).toFixed(1)}% |`,
        );
      }
      lines.push("");
    }

    return lines.join("\n");
  }
}
