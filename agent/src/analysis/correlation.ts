const MIN_RETURNS = 10;
const EMA_ALPHA = 0.05;

export type CorrelationPair = {
  symbolA: string;
  symbolB: string;
  correlation: number;
  historicalCorrelation: number;
  deviation: number;
};

export function pearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return NaN;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i]!;
    sumY += y[i]!;
    sumXY += x[i]! * y[i]!;
    sumX2 += x[i]! * x[i]!;
    sumY2 += y[i]! * y[i]!;
  }

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt(
    (n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY)
  );

  if (denominator === 0) return 0;
  return numerator / denominator;
}

export function computeReturns(prices: number[]): number[] {
  if (prices.length < 2) return [];
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i]! - prices[i - 1]!) / prices[i - 1]!);
  }
  return returns;
}

export class CorrelationDetector {
  private historicalCorrelations = new Map<string, number>();

  private pairKey(a: string, b: string): string {
    return a < b ? `${a}:${b}` : `${b}:${a}`;
  }

  computeCorrelations(priceHistory: Map<string, number[]>): CorrelationPair[] {
    const symbols = [...priceHistory.keys()];
    if (symbols.length < 2) return [];

    // Compute returns for each symbol
    const returnsMap = new Map<string, number[]>();
    for (const [symbol, prices] of priceHistory) {
      const returns = computeReturns(prices);
      if (returns.length >= MIN_RETURNS) {
        returnsMap.set(symbol, returns);
      }
    }

    const validSymbols = [...returnsMap.keys()];
    if (validSymbols.length < 2) return [];

    const pairs: CorrelationPair[] = [];

    // Pairwise correlations
    for (let i = 0; i < validSymbols.length; i++) {
      for (let j = i + 1; j < validSymbols.length; j++) {
        const a = validSymbols[i]!;
        const b = validSymbols[j]!;
        const returnsA = returnsMap.get(a)!;
        const returnsB = returnsMap.get(b)!;

        // Use overlapping window (shorter of the two)
        const minLen = Math.min(returnsA.length, returnsB.length);
        const sliceA = returnsA.slice(returnsA.length - minLen);
        const sliceB = returnsB.slice(returnsB.length - minLen);

        const correlation = pearsonCorrelation(sliceA, sliceB);
        if (Number.isNaN(correlation)) continue;

        const key = this.pairKey(a, b);
        const historical = this.historicalCorrelations.get(key) ?? correlation;

        pairs.push({
          symbolA: a,
          symbolB: b,
          correlation,
          historicalCorrelation: historical,
          deviation: Math.abs(correlation - historical),
        });
      }
    }

    return pairs.sort((a, b) => b.deviation - a.deviation);
  }

  detectBreakdowns(pairs: CorrelationPair[], threshold: number = 0.3): CorrelationPair[] {
    return pairs
      .filter(p => p.deviation >= threshold)
      .sort((a, b) => b.deviation - a.deviation);
  }

  updateHistorical(symbolA: string, symbolB: string, newCorrelation: number): void {
    const key = this.pairKey(symbolA, symbolB);
    const existing = this.historicalCorrelations.get(key);

    if (existing === undefined) {
      this.historicalCorrelations.set(key, newCorrelation);
    } else {
      this.historicalCorrelations.set(
        key,
        (1 - EMA_ALPHA) * existing + EMA_ALPHA * newCorrelation
      );
    }
  }

  getHistorical(symbolA: string, symbolB: string): number | undefined {
    return this.historicalCorrelations.get(this.pairKey(symbolA, symbolB));
  }
}
