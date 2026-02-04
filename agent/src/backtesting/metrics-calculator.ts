import type { BacktestTrade, BacktestMetrics } from "@finwatch/shared";

type EquityPoint = { date: string; value: number };

function emptyBaseMetrics(): Omit<BacktestMetrics, "perSymbol"> {
  return {
    totalReturn: 0,
    totalReturnPct: 0,
    sharpeRatio: 0,
    sortinoRatio: 0,
    maxDrawdownPct: 0,
    maxDrawdownDuration: 0,
    recoveryFactor: 0,
    winRate: 0,
    totalTrades: 0,
    profitFactor: 0,
    avgWinLossRatio: 0,
    maxConsecutiveWins: 0,
    maxConsecutiveLosses: 0,
    largestWin: 0,
    largestLoss: 0,
    avgTradeDuration: 0,
    monthlyReturns: [],
  };
}

function computeBaseMetrics(
  trades: BacktestTrade[],
  curve: EquityPoint[],
  initialCapital: number,
): Omit<BacktestMetrics, "perSymbol"> {
  // Only sell trades count as "completed trades" for win/loss metrics
  const sellTrades = trades.filter((t) => t.side === "sell" && t.realizedPnl !== null);

  if (sellTrades.length === 0 && curve.length === 0) {
    return emptyBaseMetrics();
  }

  // Total return from equity curve or trade PnLs
  const lastValue = curve.length > 0 ? curve[curve.length - 1].value : initialCapital;
  const totalReturn = lastValue - initialCapital;
  const totalReturnPct = initialCapital > 0 ? (totalReturn / initialCapital) * 100 : 0;

  // Win rate
  const wins = sellTrades.filter((t) => (t.realizedPnl ?? 0) > 0);
  const losses = sellTrades.filter((t) => (t.realizedPnl ?? 0) < 0);
  const winRate = sellTrades.length > 0 ? wins.length / sellTrades.length : 0;

  // Profit factor
  const grossProfit = wins.reduce((s, t) => s + (t.realizedPnl ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.realizedPnl ?? 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 9999.99 : 0;

  // Avg win/loss ratio
  const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
  const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;
  const avgWinLossRatio = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 9999.99 : 0;

  // Largest win/loss
  const pnls = sellTrades.map((t) => t.realizedPnl ?? 0);
  const largestWin = pnls.length > 0 ? Math.max(...pnls, 0) : 0;
  const largestLoss = pnls.length > 0 ? Math.min(...pnls, 0) : 0;

  // Max consecutive wins/losses
  let maxConsWins = 0, maxConsLosses = 0, consWins = 0, consLosses = 0;
  for (const t of sellTrades) {
    if ((t.realizedPnl ?? 0) > 0) {
      consWins++;
      consLosses = 0;
    } else if ((t.realizedPnl ?? 0) < 0) {
      consLosses++;
      consWins = 0;
    }
    maxConsWins = Math.max(maxConsWins, consWins);
    maxConsLosses = Math.max(maxConsLosses, consLosses);
  }

  // Drawdown from equity curve
  let maxDDPct = 0;
  // maxDrawdownDuration measured in equity curve data points (trading days)
  let maxDDDuration = 0;
  if (curve.length > 1) {
    let peak = curve[0].value;
    let ddStart = 0;
    for (let i = 1; i < curve.length; i++) {
      if (curve[i].value > peak) {
        peak = curve[i].value;
        ddStart = i;
      }
      const dd = ((peak - curve[i].value) / peak) * 100;
      if (dd > maxDDPct) {
        maxDDPct = dd;
        maxDDDuration = i - ddStart;
      }
    }
  }

  const recoveryFactor = maxDDPct > 0 ? totalReturnPct / maxDDPct : 0;

  // Daily returns for Sharpe/Sortino
  const dailyReturns: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    if (curve[i - 1].value > 0) {
      dailyReturns.push((curve[i].value - curve[i - 1].value) / curve[i - 1].value);
    }
  }

  let sharpeRatio = 0;
  let sortinoRatio = 0;
  if (dailyReturns.length > 1) {
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    // Population variance (N divisor, not N-1)
    const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyReturns.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev > 0) {
      // Annualize: 252 trading days/year, multiply daily ratio by sqrt(252)
      sharpeRatio = (mean / stdDev) * Math.sqrt(252);
    }

    // Downside deviation uses MAR=0; only negative daily returns contribute
    const downside = dailyReturns.filter((r) => r < 0);
    if (downside.length > 0) {
      const downsideVariance = downside.reduce((s, r) => s + r ** 2, 0) / downside.length;
      const downsideStd = Math.sqrt(downsideVariance);
      if (downsideStd > 0) {
        sortinoRatio = (mean / downsideStd) * Math.sqrt(252);
      }
    }
  }

  // Avg trade duration (hours) using FIFO timestamp matching: each sell is matched to the oldest buy for that symbol. Limitation: does not account for partial fills or position sizing.
  let totalDuration = 0;
  let durationCount = 0;
  const openTimestamps = new Map<string, number[]>();
  for (const t of trades) {
    if (t.side === "buy") {
      const arr = openTimestamps.get(t.symbol) ?? [];
      arr.push(t.timestamp);
      openTimestamps.set(t.symbol, arr);
    } else if (t.side === "sell") {
      const arr = openTimestamps.get(t.symbol);
      if (arr && arr.length > 0) {
        const openTs = arr.shift()!;
        totalDuration += (t.timestamp - openTs) / 3600000;
        durationCount++;
      }
    }
  }
  const avgTradeDuration = durationCount > 0 ? totalDuration / durationCount : 0;

  // Monthly returns
  const monthlyReturns: { month: string; return: number }[] = [];
  if (curve.length > 0) {
    const byMonth = new Map<string, { first: number; last: number }>();
    for (const p of curve) {
      const month = p.date.slice(0, 7); // "YYYY-MM"
      const existing = byMonth.get(month);
      if (!existing) {
        byMonth.set(month, { first: p.value, last: p.value });
      } else {
        existing.last = p.value;
      }
    }
    for (const [month, { first, last }] of byMonth) {
      monthlyReturns.push({
        month,
        return: first > 0 ? ((last - first) / first) * 100 : 0,
      });
    }
  }

  return {
    totalReturn,
    totalReturnPct,
    sharpeRatio,
    sortinoRatio,
    maxDrawdownPct: Math.round(maxDDPct * 100) / 100,
    maxDrawdownDuration: maxDDDuration,
    recoveryFactor,
    winRate,
    totalTrades: sellTrades.length,
    profitFactor,
    avgWinLossRatio,
    maxConsecutiveWins: maxConsWins,
    maxConsecutiveLosses: maxConsLosses,
    largestWin,
    largestLoss,
    avgTradeDuration,
    monthlyReturns,
  };
}

export function calculateMetrics(
  trades: BacktestTrade[],
  curve: EquityPoint[],
  initialCapital: number,
): BacktestMetrics {
  const base = computeBaseMetrics(trades, curve, initialCapital);

  // Per-symbol breakdown
  const symbols = new Set(trades.map((t) => t.symbol));
  const perSymbol: Record<string, Omit<BacktestMetrics, "perSymbol">> = {};

  for (const symbol of symbols) {
    // Per-symbol: empty equity curve -> Sharpe/Sortino/drawdown will be 0. Only trade-based metrics are meaningful.
    const symbolTrades = trades.filter((t) => t.symbol === symbol);
    perSymbol[symbol] = computeBaseMetrics(symbolTrades, [], initialCapital);
    // Compute totalReturn from trade PnLs for per-symbol
    const symbolPnl = symbolTrades
      .filter((t) => t.realizedPnl !== null)
      .reduce((s, t) => s + (t.realizedPnl ?? 0), 0);
    perSymbol[symbol].totalReturn = symbolPnl;
    perSymbol[symbol].totalReturnPct = initialCapital > 0 ? (symbolPnl / initialCapital) * 100 : 0;
  }

  return { ...base, perSymbol };
}
