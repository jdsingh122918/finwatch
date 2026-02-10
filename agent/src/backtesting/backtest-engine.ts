import type {
  BacktestConfig,
  BacktestResult,
  BacktestProgress,
  DataTick,
  Anomaly,
  Severity,
} from "@finwatch/shared";
import { BacktestExecutor } from "./backtest-executor.js";
import { calculateMetrics, calculateV2Metrics } from "./metrics-calculator.js";
import type { TradeV2Info, V2Metrics } from "./metrics-calculator.js";
import { TradeGenerator } from "../trading/trade-generator.js";
import type { ComputeIndicatorsFn } from "../trading/trade-generator.js";
import type { IndicatorSnapshot } from "../trading/regime-detector.js";
import { detectRegime } from "../trading/regime-detector.js";
import { scoreConfluence } from "../trading/confluence-scorer.js";
import { RiskManager } from "../trading/risk-manager.js";
import { createLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Dependency injection types
// ---------------------------------------------------------------------------

export type FetchDataFn = (
  symbols: string[],
  startDate: string,
  endDate: string,
  timeframe: string,
) => Promise<DataTick[]>;

export type RunAnalysisFn = (
  ticks: DataTick[],
) => Promise<Anomaly[]>;

export type BacktestDeps = {
  fetchData: FetchDataFn;
  runAnalysis: RunAnalysisFn;
  computeIndicators?: ComputeIndicatorsFn;
};

// ---------------------------------------------------------------------------
// Extended result type (BacktestResult in shared/ is frozen)
// ---------------------------------------------------------------------------

export type BacktestResultV2 = BacktestResult & {
  v2Metrics?: V2Metrics;
};

// ---------------------------------------------------------------------------
// Severity ranking for threshold filtering
// ---------------------------------------------------------------------------

const SEVERITY_RANK: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function severityRank(severity: string): number {
  return SEVERITY_RANK[severity as Severity] ?? 0;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Group ticks by date string (YYYY-MM-DD) sorted chronologically. */
// Note: uses UTC date via toISOString() -- timestamps must be in UTC
function groupByDate(ticks: DataTick[]): Map<string, DataTick[]> {
  const sorted = [...ticks].sort((a, b) => a.timestamp - b.timestamp);
  const groups = new Map<string, DataTick[]>();
  for (const tick of sorted) {
    const date = new Date(tick.timestamp).toISOString().slice(0, 10);
    const arr = groups.get(date) ?? [];
    arr.push(tick);
    groups.set(date, arr);
  }
  return groups;
}

/** Extract latest close price per symbol from a batch of ticks. */
function latestPrices(ticks: DataTick[]): Record<string, number> {
  const prices: Record<string, number> = {};
  for (const tick of ticks) {
    if (tick.symbol && tick.metrics.close !== undefined) {
      prices[tick.symbol] = tick.metrics.close;
    }
  }
  return prices;
}

// ---------------------------------------------------------------------------
// BacktestEngine
// ---------------------------------------------------------------------------

export class BacktestEngine {
  private config: BacktestConfig;
  private deps: BacktestDeps;
  private cancelled = false;
  private log = createLogger("backtest-engine");

  onProgress?: (progress: BacktestProgress) => void;

  constructor(config: BacktestConfig, deps: BacktestDeps) {
    this.config = config;
    this.deps = deps;
  }

  cancel(): void {
    this.cancelled = true;
  }

  async run(): Promise<BacktestResultV2> {
    const startedAt = Date.now();
    this.cancelled = false;

    const result: BacktestResultV2 = {
      id: this.config.id,
      config: this.config,
      status: "running",
      metrics: null,
      trades: [],
      equityCurve: [],
      createdAt: startedAt,
      completedAt: null,
      error: null,
    };

    try {
      // ---------------------------------------------------------------
      // 1. Fetch historical data
      // ---------------------------------------------------------------
      this.log.info("Fetching data", {
        symbols: this.config.symbols.join(","),
        start: this.config.startDate,
        end: this.config.endDate,
      });

      const ticks = await this.deps.fetchData(
        this.config.symbols,
        this.config.startDate,
        this.config.endDate,
        this.config.timeframe,
      );

      if (this.cancelled) {
        return this.finishCancelled(result);
      }

      if (ticks.length === 0) {
        result.status = "completed";
        result.completedAt = Date.now();
        result.metrics = calculateMetrics([], [], this.config.initialCapital);
        return result;
      }

      // ---------------------------------------------------------------
      // 2. Set up executor, trade generator, and risk manager
      // ---------------------------------------------------------------
      const executor = new BacktestExecutor(this.config.id, this.config.initialCapital);
      const v2Mode = !!this.deps.computeIndicators;
      const positionLookup = { hasPosition: (s: string) => executor.hasPosition(s), getQty: (s: string) => executor.getQty(s) };
      const tradeGenerator = new TradeGenerator(
        v2Mode
          ? { positions: positionLookup, computeIndicators: this.deps.computeIndicators!, accountEquity: this.config.initialCapital }
          : positionLookup,
      );
      const riskManager = new RiskManager(this.config.riskLimits);

      // ---------------------------------------------------------------
      // 3. Group ticks by date and iterate chronologically
      // ---------------------------------------------------------------
      const dateGroups = groupByDate(ticks);
      const dateEntries = [...dateGroups.entries()];
      const totalTicks = ticks.length;
      let ticksProcessed = 0;
      let anomaliesFound = 0;
      let tradesExecuted = 0;
      let dailyTradeCount = 0;
      let lastTradeTimestamp: number | undefined;
      let lastTradeSymbol: string | undefined;
      let previousDate: string | undefined;

      // V2 metadata collection for extended metrics
      const v2TradeInfos: TradeV2Info[] = [];

      // Rolling window size: use prior N days as statistical context
      // so the pre-screener can compute meaningful z-scores
      const LOOKBACK_DAYS = 20;

      for (let dayIdx = 0; dayIdx < dateEntries.length; dayIdx++) {
        const [date, dateTicks] = dateEntries[dayIdx]!;

        if (this.cancelled) {
          return this.finishCancelled(result, executor);
        }

        // Reset daily trade count on new date
        if (previousDate !== date) {
          dailyTradeCount = 0;
          previousDate = date;
        }

        // Build rolling window: prior LOOKBACK_DAYS + today's ticks.
        // This gives the pre-screener enough data for meaningful z-scores.
        const windowStart = Math.max(0, dayIdx - LOOKBACK_DAYS);
        const windowTicks: DataTick[] = [];
        for (let i = windowStart; i < dayIdx; i++) {
          windowTicks.push(...dateEntries[i]![1]);
        }
        windowTicks.push(...dateTicks);

        // Run analysis on the rolling window
        const anomalies = await this.deps.runAnalysis(windowTicks);

        if (this.cancelled) {
          return this.finishCancelled(result, executor);
        }

        // Filter anomalies by severity threshold and preScreenScore
        const thresholdRank = severityRank(this.config.severityThreshold);
        const qualifying = anomalies.filter(
          (a) =>
            severityRank(a.severity) >= thresholdRank &&
            a.preScreenScore >= this.config.confidenceThreshold,
        );

        anomaliesFound += qualifying.length;

        // Get current prices for this date
        const prices = latestPrices(dateTicks);

        // Pre-compute indicators per symbol for this date (v2 mode only)
        const dateIndicators = new Map<string, IndicatorSnapshot>();
        if (v2Mode) {
          const symbolsInDate = new Set(dateTicks.map((t) => t.symbol).filter(Boolean) as string[]);
          for (const sym of symbolsInDate) {
            const symTicks = windowTicks.filter((t) => t.symbol === sym);
            if (symTicks.length > 0) {
              dateIndicators.set(sym, await this.deps.computeIndicators!(sym, symTicks));
            }
          }
        }

        // Generate and execute trades for qualifying anomalies
        for (const anomaly of qualifying) {
          if (this.cancelled) {
            return this.finishCancelled(result, executor);
          }

          const action = await tradeGenerator.evaluate(anomaly, v2Mode ? dateTicks : undefined);
          if (!action) continue;

          // Run risk check
          const symbol = action.symbol;
          const currentPrice = prices[symbol] ?? anomaly.metrics.close;
          if (currentPrice === undefined || currentPrice <= 0) {
            this.log.warn("Skipping trade: no valid price", { symbol });
            continue;
          }
          const portfolioValue = executor.portfolioValue(prices);

          const riskCheck = riskManager.check(action, {
            currentPrice,
            currentExposure: portfolioValue - executor.cash,
            dailyTradeCount,
            lastTradeTimestamp,
            lastTradeSymbol,
            portfolioValue,
          });

          if (!riskCheck.approved) {
            this.log.debug("Trade rejected by risk manager", {
              symbol,
              violations: riskCheck.violations.join(","),
            });
            continue;
          }

          // Execute trade
          const fillPrice = currentPrice;
          const timestamp = anomaly.timestamp;
          const trade = executor.execute(action, fillPrice, timestamp);

          if (trade) {
            tradesExecuted++;
            dailyTradeCount++;
            lastTradeTimestamp = timestamp;
            lastTradeSymbol = symbol;

            // Capture v2 metadata using pre-computed indicators
            if (v2Mode) {
              const indicators = dateIndicators.get(symbol);
              let confluenceScore = (action.confidence ?? 0) * 100;
              let regimeName = "unknown";
              let atr = 0;

              if (indicators) {
                const regime = detectRegime(indicators);
                const score = scoreConfluence(anomaly, indicators, regime);
                confluenceScore = score.total;
                regimeName = regime.regime;
                atr = indicators.atr;
              }

              v2TradeInfos.push({
                tradeId: trade.id,
                confluenceScore,
                regime: regimeName,
                atr,
                qty: trade.qty,
                realizedPnl: trade.realizedPnl,
              });
            }
          }
        }

        // Snapshot equity at end of day
        const dayPrices = latestPrices(dateTicks);
        executor.snapshot(date, dayPrices);

        ticksProcessed += dateTicks.length;

        // Emit progress
        this.emitProgress({
          backtestId: this.config.id,
          ticksProcessed,
          totalTicks,
          anomaliesFound,
          tradesExecuted,
          currentDate: date,
        });
      }

      // ---------------------------------------------------------------
      // 4. Compute final metrics
      // ---------------------------------------------------------------
      const trades = executor.getTradeLog();
      const equityCurve = executor.getEquityCurve();
      const metrics = calculateMetrics(trades, equityCurve, this.config.initialCapital);

      result.status = "completed";
      result.trades = trades;
      result.equityCurve = equityCurve;
      result.metrics = metrics;
      result.completedAt = Date.now();

      // Update v2 trade infos with final realizedPnl from executor
      if (v2Mode && v2TradeInfos.length > 0) {
        const tradeMap = new Map(trades.map((t) => [t.id, t]));
        for (const info of v2TradeInfos) {
          const executedTrade = tradeMap.get(info.tradeId);
          if (executedTrade) {
            info.realizedPnl = executedTrade.realizedPnl;
          }
        }
        result.v2Metrics = calculateV2Metrics(v2TradeInfos);
      }

      this.log.info("Backtest completed", {
        totalTrades: trades.length.toString(),
        totalReturn: metrics.totalReturn.toFixed(2),
      });

      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      this.log.error("Backtest failed", { error: message, stack: stack ?? "no stack" });

      result.status = "failed";
      result.error = message;
      result.completedAt = Date.now();
      return result;
    }
  }

  private finishCancelled(result: BacktestResultV2, executor?: BacktestExecutor): BacktestResultV2 {
    this.log.info("Backtest cancelled");
    result.status = "cancelled";
    result.completedAt = Date.now();
    if (executor) {
      result.trades = executor.getTradeLog();
      result.equityCurve = executor.getEquityCurve();
    }
    return result;
  }

  private emitProgress(progress: BacktestProgress): void {
    try {
      this.onProgress?.(progress);
    } catch (err) {
      this.log.warn("Progress callback error", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

}
