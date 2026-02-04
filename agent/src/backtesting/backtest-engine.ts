import type {
  BacktestConfig,
  BacktestResult,
  BacktestProgress,
  DataTick,
  Anomaly,
  TradeAction,
  Severity,
} from "@finwatch/shared";
import { BacktestExecutor } from "./backtest-executor.js";
import { calculateMetrics } from "./metrics-calculator.js";
import { TradeGenerator } from "../trading/trade-generator.js";
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

  constructor(config: BacktestConfig, deps?: BacktestDeps) {
    this.config = config;
    this.deps = deps ?? {
      fetchData: async () => [],
      runAnalysis: async () => [],
    };
  }

  cancel(): void {
    this.cancelled = true;
  }

  async run(): Promise<BacktestResult> {
    const startedAt = Date.now();
    this.cancelled = false;

    const result: BacktestResult = {
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
      const tradeGenerator = new TradeGenerator(executor);
      const riskManager = new RiskManager(this.config.riskLimits);

      // ---------------------------------------------------------------
      // 3. Group ticks by date and iterate chronologically
      // ---------------------------------------------------------------
      const dateGroups = groupByDate(ticks);
      const totalTicks = ticks.length;
      let ticksProcessed = 0;
      let anomaliesFound = 0;
      let tradesExecuted = 0;
      let dailyTradeCount = 0;
      let lastTradeTimestamp: number | undefined;
      let lastTradeSymbol: string | undefined;
      let previousDate: string | undefined;

      for (const [date, dateTicks] of dateGroups) {
        if (this.cancelled) {
          return this.finishCancelled(result);
        }

        // Reset daily trade count on new date
        if (previousDate !== date) {
          dailyTradeCount = 0;
          previousDate = date;
        }

        // Run analysis on this date batch
        const anomalies = await this.deps.runAnalysis(dateTicks);

        if (this.cancelled) {
          return this.finishCancelled(result);
        }

        // Filter anomalies by severity threshold and confidence
        const thresholdRank = severityRank(this.config.severityThreshold);
        const qualifying = anomalies.filter(
          (a) =>
            severityRank(a.severity) >= thresholdRank &&
            a.preScreenScore >= this.config.confidenceThreshold,
        );

        anomaliesFound += qualifying.length;

        // Get current prices for this date
        const prices = latestPrices(dateTicks);

        // Generate and execute trades for qualifying anomalies
        for (const anomaly of qualifying) {
          if (this.cancelled) {
            return this.finishCancelled(result);
          }

          const action = tradeGenerator.evaluate(anomaly);
          if (!action) continue;

          // Run risk check
          const symbol = action.symbol;
          const currentPrice = prices[symbol] ?? anomaly.metrics.close ?? 0;
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

      this.log.info("Backtest completed", {
        totalTrades: trades.length.toString(),
        totalReturn: metrics.totalReturn.toFixed(2),
      });

      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error("Backtest failed", { error: message });

      result.status = "failed";
      result.error = message;
      result.completedAt = Date.now();
      return result;
    }
  }

  private finishCancelled(result: BacktestResult): BacktestResult {
    this.log.info("Backtest cancelled");
    result.status = "cancelled";
    result.completedAt = Date.now();
    return result;
  }

  private emitProgress(progress: BacktestProgress): void {
    this.onProgress?.(progress);
  }
}
