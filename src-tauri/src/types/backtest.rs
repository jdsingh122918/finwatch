use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestConfig {
    pub id: String,
    pub symbols: Vec<String>,
    pub start_date: String,
    pub end_date: String,
    pub timeframe: String,
    pub initial_capital: f64,
    pub risk_limits: serde_json::Value,
    pub severity_threshold: String,
    pub confidence_threshold: f64,
    pub pre_screener_sensitivity: f64,
    pub trade_sizing_strategy: String,
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestSummary {
    pub id: String,
    pub status: String,
    pub config: serde_json::Value,
    pub metrics: Option<serde_json::Value>,
    pub created_at: i64,
    pub completed_at: Option<i64>,
    pub ticks_processed: i64,
    pub total_ticks: i64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestTrade {
    pub id: String,
    pub backtest_id: String,
    pub symbol: String,
    pub side: String,
    pub qty: f64,
    pub fill_price: f64,
    pub timestamp: i64,
    pub anomaly_id: Option<String>,
    pub rationale: Option<String>,
    pub realized_pnl: Option<f64>,
}
