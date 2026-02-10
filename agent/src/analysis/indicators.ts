const RSI_PERIOD = 14;
const MACD_FAST = 12;
const MACD_SLOW = 26;
const MACD_SIGNAL = 9;
const ATR_PERIOD = 14;

function ema(values: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);

  // Start with SMA for the first period
  let sum = 0;
  for (let i = 0; i < period && i < values.length; i++) {
    sum += values[i]!;
  }
  if (values.length < period) return [];

  result.push(sum / period);

  for (let i = period; i < values.length; i++) {
    const prev = result[result.length - 1]!;
    result.push(values[i]! * k + prev * (1 - k));
  }

  return result;
}

/**
 * Compute RSI using Wilder's smoothing method.
 * Requires at least RSI_PERIOD + 1 prices (15).
 */
export function computeRSI(prices: number[], period: number = RSI_PERIOD): number | undefined {
  if (prices.length < period + 1) return undefined;

  const changes: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    changes.push(prices[i]! - prices[i - 1]!);
  }

  // Initial averages
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    const change = changes[i]!;
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder's smoothing
  for (let i = period; i < changes.length; i++) {
    const change = changes[i]!;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? Math.abs(change) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export type MACDResult = {
  macdLine: number;
  signalLine: number;
  histogram: number;
};

/**
 * Compute MACD (12,26,9).
 * Requires at least MACD_SLOW + 1 prices (27) for meaningful output.
 */
export function computeMACD(
  prices: number[],
  fast: number = MACD_FAST,
  slow: number = MACD_SLOW,
  signal: number = MACD_SIGNAL,
): MACDResult | undefined {
  if (prices.length < slow + 1) return undefined;

  const fastEMA = ema(prices, fast);
  const slowEMA = ema(prices, slow);

  // Align: slowEMA starts at index 0 (corresponding to prices[slow-1])
  // fastEMA starts at index 0 (corresponding to prices[fast-1])
  // We need to align them: offset = slow - fast
  const offset = slow - fast;
  const macdLine: number[] = [];

  for (let i = 0; i < slowEMA.length; i++) {
    const fastIdx = i + offset;
    if (fastIdx >= 0 && fastIdx < fastEMA.length) {
      macdLine.push(fastEMA[fastIdx]! - slowEMA[i]!);
    }
  }

  if (macdLine.length < signal) return undefined;

  const signalLine = ema(macdLine, signal);
  if (signalLine.length === 0) return undefined;

  const lastMACD = macdLine[macdLine.length - 1]!;
  const lastSignal = signalLine[signalLine.length - 1]!;

  return {
    macdLine: lastMACD,
    signalLine: lastSignal,
    histogram: lastMACD - lastSignal,
  };
}

/**
 * Compute ATR using Wilder's smoothing.
 * Requires at least ATR_PERIOD + 1 bars (15).
 */
export function computeATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = ATR_PERIOD,
): number | undefined {
  const len = Math.min(highs.length, lows.length, closes.length);
  if (len < period + 1) return undefined;

  // Compute true ranges
  const trueRanges: number[] = [];
  for (let i = 1; i < len; i++) {
    const hl = highs[i]! - lows[i]!;
    const hc = Math.abs(highs[i]! - closes[i - 1]!);
    const lc = Math.abs(lows[i]! - closes[i - 1]!);
    trueRanges.push(Math.max(hl, hc, lc));
  }

  // Initial ATR = SMA of first `period` true ranges
  let atr = 0;
  for (let i = 0; i < period; i++) {
    atr += trueRanges[i]!;
  }
  atr /= period;

  // Wilder's smoothing
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]!) / period;
  }

  return atr;
}
