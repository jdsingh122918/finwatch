use serde::{Deserialize, Serialize};

/// Status of a backtest run. Maps 1:1 with the TypeScript `BacktestStatus` union.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BacktestStatus {
    #[serde(rename = "running")]
    Running,
    #[serde(rename = "completed")]
    Completed,
    #[serde(rename = "failed")]
    Failed,
    #[serde(rename = "cancelled")]
    Cancelled,
}

/// Trade direction. Maps 1:1 with the TypeScript `"buy" | "sell"` union in `BacktestTrade`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum TradeSide {
    #[serde(rename = "buy")]
    Buy,
    #[serde(rename = "sell")]
    Sell,
}

/// Configuration for a backtest run. Matches the TypeScript `BacktestConfig` in `shared/src/backtest.ts`.
/// Passed as JSON from the frontend and deserialized in `backtest_start`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestConfig {
    /// Unique identifier for this backtest run.
    pub id: String,
    /// Ticker symbols to backtest against (e.g. `["AAPL", "MSFT"]`).
    pub symbols: Vec<String>,
    /// Inclusive start date in `YYYY-MM-DD` format.
    pub start_date: String,
    /// Inclusive end date in `YYYY-MM-DD` format.
    pub end_date: String,
    /// Bar timeframe (e.g. `"1Day"`, `"1Hour"`).
    pub timeframe: String,
    /// Starting portfolio capital in USD.
    pub initial_capital: f64,
    /// Risk limit settings (stored as opaque JSON since the schema is defined in TypeScript).
    pub risk_limits: serde_json::Value,
    /// Minimum anomaly severity to act on (e.g. `"medium"`).
    pub severity_threshold: String,
    /// Minimum confidence score (0.0 - 1.0) for an anomaly to trigger a trade.
    pub confidence_threshold: f64,
    /// Pre-screener sensitivity (0.0 - 1.0).
    pub pre_screener_sensitivity: f64,
    /// Position sizing strategy (e.g. `"fixed_qty"`, `"pct_of_capital"`, `"kelly"`).
    pub trade_sizing_strategy: String,
    /// LLM model identifier used for anomaly analysis.
    pub model_id: String,
}

/// Summary of a backtest run as stored in the database.
/// Returned by `backtest_list` and `backtest_get` Tauri commands.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestSummary {
    /// Unique backtest identifier.
    pub id: String,
    /// Current status of the backtest run.
    pub status: String,
    /// Full configuration snapshot (stored as JSON in the DB).
    pub config: serde_json::Value,
    /// Computed performance metrics, present only when status is `"completed"`.
    pub metrics: Option<serde_json::Value>,
    /// Unix timestamp (milliseconds) when the backtest was created.
    pub created_at: i64,
    /// Unix timestamp (milliseconds) when the backtest finished, or `null` if still running.
    pub completed_at: Option<i64>,
    /// Number of price ticks processed so far.
    pub ticks_processed: i64,
    /// Total number of ticks to process.
    pub total_ticks: i64,
    /// Error message if status is `"failed"`, otherwise `null`.
    pub error: Option<String>,
}

/// A single trade executed during a backtest. Matches the TypeScript `BacktestTrade`.
/// `anomaly_id` and `rationale` are required strings (matching the TS type).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestTrade {
    /// Unique trade identifier.
    pub id: String,
    /// Parent backtest run this trade belongs to.
    pub backtest_id: String,
    /// Ticker symbol (e.g. `"AAPL"`).
    pub symbol: String,
    /// Trade direction: `"buy"` or `"sell"`.
    pub side: String,
    /// Number of shares traded.
    pub qty: f64,
    /// Execution price per share.
    pub fill_price: f64,
    /// Unix timestamp (milliseconds) of trade execution.
    pub timestamp: i64,
    /// Anomaly that triggered this trade.
    pub anomaly_id: String,
    /// Human-readable explanation of why this trade was taken.
    pub rationale: String,
    /// Realized PnL for sell trades; `null` for buy trades.
    pub realized_pnl: Option<f64>,
}
