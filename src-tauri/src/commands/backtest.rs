use tracing::warn;

use crate::bridge::SidecarBridge;
use crate::commands::agent::config_or_env;
use crate::db::DbPool;
use crate::types::backtest::{BacktestConfig, BacktestSummary, BacktestTrade};

/// Insert a new backtest run into the database with status `"running"`.
///
/// Stores the full config JSON and records the current timestamp as `created_at`.
pub fn backtest_insert_db(pool: &DbPool, id: &str, config_json: &str) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;

    conn.execute(
        "INSERT INTO backtests (id, status, config, created_at) VALUES (?1, 'running', ?2, ?3)",
        rusqlite::params![id, config_json, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Update the status of an existing backtest run.
///
/// Sets `completed_at` to the current timestamp, and optionally stores
/// computed metrics JSON or an error message.
pub fn backtest_update_status_db(
    pool: &DbPool,
    id: &str,
    status: &str,
    metrics_json: Option<&str>,
    error: Option<&str>,
) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;

    conn.execute(
        "UPDATE backtests SET status = ?1, metrics = ?2, completed_at = ?3, error = ?4 WHERE id = ?5",
        rusqlite::params![status, metrics_json, now, error, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Update the tick progress counters for a running backtest.
pub fn backtest_update_progress_db(
    pool: &DbPool,
    id: &str,
    ticks_processed: i64,
    total_ticks: i64,
) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE backtests SET ticks_processed = ?1, total_ticks = ?2 WHERE id = ?3",
        rusqlite::params![ticks_processed, total_ticks, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Insert a batch of trades for a backtest run inside a single transaction.
///
/// If any insert fails, the entire batch is rolled back to maintain atomicity.
pub fn backtest_insert_trades_db(pool: &DbPool, trades: &[BacktestTrade]) -> Result<(), String> {
    let mut conn = pool.get().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for trade in trades {
        tx.execute(
            "INSERT INTO backtest_trades (id, backtest_id, symbol, side, qty, fill_price, timestamp, anomaly_id, rationale, realized_pnl)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            rusqlite::params![
                trade.id,
                trade.backtest_id,
                trade.symbol,
                trade.side,
                trade.qty,
                trade.fill_price,
                trade.timestamp,
                trade.anomaly_id,
                trade.rationale,
                trade.realized_pnl,
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// List all backtest runs ordered by creation time (newest first).
pub fn backtest_list_db(pool: &DbPool) -> Result<Vec<BacktestSummary>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, status, config, metrics, created_at, completed_at, ticks_processed, total_ticks, error FROM backtests ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let config_str: String = row.get(2)?;
            let metrics_str: Option<String> = row.get(3)?;
            Ok(BacktestSummary {
                id: row.get(0)?,
                status: row.get(1)?,
                config: serde_json::from_str(&config_str).unwrap_or_else(|e| {
                    warn!(error = %e, "Failed to parse backtest config JSON");
                    serde_json::Value::Null
                }),
                metrics: metrics_str.map(|s| {
                    serde_json::from_str(&s).unwrap_or_else(|e| {
                        warn!(error = %e, "Failed to parse backtest metrics JSON");
                        serde_json::Value::Null
                    })
                }),
                created_at: row.get(4)?,
                completed_at: row.get(5)?,
                ticks_processed: row.get(6)?,
                total_ticks: row.get(7)?,
                error: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

/// Retrieve a single backtest run by ID.
///
/// Returns an error if no backtest with the given ID exists.
pub fn backtest_get_db(pool: &DbPool, id: &str) -> Result<BacktestSummary, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, status, config, metrics, created_at, completed_at, ticks_processed, total_ticks, error FROM backtests WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    stmt.query_row([id], |row| {
        let config_str: String = row.get(2)?;
        let metrics_str: Option<String> = row.get(3)?;
        Ok(BacktestSummary {
            id: row.get(0)?,
            status: row.get(1)?,
            config: serde_json::from_str(&config_str).unwrap_or_else(|e| {
                warn!(backtest_id = id, error = %e, "Failed to parse backtest config JSON");
                serde_json::Value::Null
            }),
            metrics: metrics_str.map(|s| {
                serde_json::from_str(&s).unwrap_or_else(|e| {
                    warn!(backtest_id = id, error = %e, "Failed to parse backtest metrics JSON");
                    serde_json::Value::Null
                })
            }),
            created_at: row.get(4)?,
            completed_at: row.get(5)?,
            ticks_processed: row.get(6)?,
            total_ticks: row.get(7)?,
            error: row.get(8)?,
        })
    })
    .map_err(|e| e.to_string())
}

/// Retrieve all trades belonging to a backtest run, ordered by timestamp.
pub fn backtest_get_trades_db(pool: &DbPool, backtest_id: &str) -> Result<Vec<BacktestTrade>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, backtest_id, symbol, side, qty, fill_price, timestamp, anomaly_id, rationale, realized_pnl FROM backtest_trades WHERE backtest_id = ?1 ORDER BY timestamp")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([backtest_id], |row| {
            Ok(BacktestTrade {
                id: row.get(0)?,
                backtest_id: row.get(1)?,
                symbol: row.get(2)?,
                side: row.get(3)?,
                qty: row.get(4)?,
                fill_price: row.get(5)?,
                timestamp: row.get(6)?,
                anomaly_id: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                rationale: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                realized_pnl: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

/// Delete a backtest run and all associated trades.
///
/// Only deletes from `backtests`; trades are removed automatically via `ON DELETE CASCADE`
/// as defined in the `backtest_trades` foreign key constraint.
pub fn backtest_delete_db(pool: &DbPool, id: &str) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM backtests WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tauri command wrappers
// ---------------------------------------------------------------------------

/// Start a new backtest run.
///
/// Deserializes the config JSON into a typed `BacktestConfig`, validates it,
/// inserts a new row with status `"running"`, resolves credentials, spawns
/// the sidecar if needed, and sends a `backtest:run` JSON-RPC request.
#[tauri::command]
pub async fn backtest_start(
    app: tauri::AppHandle,
    pool: tauri::State<'_, DbPool>,
    bridge: tauri::State<'_, SidecarBridge>,
    config: String,
) -> Result<String, String> {
    let parsed: BacktestConfig = serde_json::from_str(&config)
        .map_err(|e| format!("Invalid backtest config: {}", e))?;
    backtest_insert_db(&pool, &parsed.id, &config)?;

    // Resolve Alpaca credentials: DB first, then env vars
    let creds = crate::commands::credentials::credentials_get_db(&pool, "paper")?;
    let (alpaca_key, alpaca_secret) = match creds {
        Some(c) => (c.key_id, c.secret_key),
        None => {
            let key = std::env::var("ALPACA_KEY_ID")
                .map_err(|_| "Alpaca credentials not set. Configure in Settings or set ALPACA_KEY_ID/ALPACA_SECRET_KEY env vars.")?;
            let secret = std::env::var("ALPACA_SECRET_KEY")
                .map_err(|_| "ALPACA_SECRET_KEY env var not set.")?;
            (key, secret)
        }
    };

    // Resolve LLM keys from config DB, falling back to env vars
    let app_config = crate::commands::config::config_get_db(&pool)?;
    let app_config: serde_json::Value =
        serde_json::from_str(&app_config).unwrap_or(serde_json::json!({}));

    let anthropic_key = config_or_env(&app_config, "anthropicApiKey", "ANTHROPIC_API_KEY");
    let openrouter_key = config_or_env(&app_config, "openrouterApiKey", "OPENROUTER_API_KEY");

    let model = app_config
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("claude-haiku-4-5-20251001");

    // Auto-spawn sidecar if not running
    if !bridge.is_running() {
        bridge.spawn(app, "agent/src/index.ts")?;
    }

    // Send backtest:run JSON-RPC request
    let parsed_config: serde_json::Value = serde_json::from_str(&config)
        .map_err(|e| format!("Invalid config: {}", e))?;
    let backtest_params = serde_json::json!({
        "config": parsed_config,
        "alpaca": { "keyId": alpaca_key, "secretKey": alpaca_secret },
        "llm": {
            "anthropicApiKey": anthropic_key,
            "openrouterApiKey": openrouter_key,
            "model": model,
            "maxTokens": 4096,
            "temperature": 0.3
        }
    });
    bridge.send_request("backtest:run", Some(backtest_params))?;

    Ok(parsed.id)
}

/// List all backtest runs, newest first.
#[tauri::command]
pub fn backtest_list(pool: tauri::State<'_, DbPool>) -> Result<Vec<BacktestSummary>, String> {
    backtest_list_db(&pool)
}

/// Retrieve a single backtest run by ID.
#[tauri::command]
pub fn backtest_get(
    pool: tauri::State<'_, DbPool>,
    backtest_id: String,
) -> Result<BacktestSummary, String> {
    backtest_get_db(&pool, &backtest_id)
}

/// Retrieve all trades for a given backtest run.
#[tauri::command]
pub fn backtest_get_trades(
    pool: tauri::State<'_, DbPool>,
    backtest_id: String,
) -> Result<Vec<BacktestTrade>, String> {
    backtest_get_trades_db(&pool, &backtest_id)
}

/// Delete a backtest run and its associated trades (via CASCADE).
#[tauri::command]
pub fn backtest_delete(
    pool: tauri::State<'_, DbPool>,
    backtest_id: String,
) -> Result<(), String> {
    backtest_delete_db(&pool, &backtest_id)
}

/// Cancel a running backtest by setting its status to `"cancelled"`.
///
/// Updates the DB status and sends a `backtest:cancel` JSON-RPC request
/// to the agent sidecar (best-effort).
#[tauri::command]
pub fn backtest_cancel(
    pool: tauri::State<'_, DbPool>,
    bridge: tauri::State<'_, SidecarBridge>,
    backtest_id: String,
) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;

    conn.execute(
        "UPDATE backtests SET status = 'cancelled', completed_at = ?1 WHERE id = ?2 AND status = 'running'",
        rusqlite::params![now, backtest_id],
    )
    .map_err(|e| e.to_string())?;

    // Best-effort: notify the agent to cancel the running backtest
    if bridge.is_running() {
        let _ = bridge.send_notification("backtest:cancel", Some(serde_json::json!({ "backtestId": backtest_id })));
    }

    Ok(())
}

/// Update the status of an existing backtest run from the frontend.
///
/// Called when the UI receives a `backtest:complete` event to persist
/// the final status, metrics, and any error message to the database.
#[tauri::command]
pub fn backtest_update_status(
    pool: tauri::State<'_, DbPool>,
    backtest_id: String,
    status: String,
    metrics: Option<String>,
    error: Option<String>,
) -> Result<(), String> {
    backtest_update_status_db(&pool, &backtest_id, &status, metrics.as_deref(), error.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::migrations;

    fn test_pool() -> DbPool {
        let dir = tempfile::tempdir().unwrap();
        let pool = db::create_pool(&dir.path().join("test.sqlite")).unwrap();
        db::init_db(&pool).unwrap();
        migrations::run_pending(&pool).unwrap();
        pool
    }

    fn sample_config_json() -> &'static str {
        r#"{"id":"bt-1","symbols":["AAPL"],"startDate":"2024-01-01","endDate":"2024-12-31","timeframe":"1Day","initialCapital":100000,"riskLimits":{},"severityThreshold":"high","confidenceThreshold":0.7,"preScreenerSensitivity":0.5,"tradeSizingStrategy":"pct_of_capital","modelId":"test"}"#
    }

    fn sample_trade(id: &str, backtest_id: &str) -> BacktestTrade {
        BacktestTrade {
            id: id.to_string(),
            backtest_id: backtest_id.to_string(),
            symbol: "AAPL".to_string(),
            side: "buy".to_string(),
            qty: 10.0,
            fill_price: 185.50,
            timestamp: 1706800000,
            anomaly_id: "anom-1".to_string(),
            rationale: "Test trade".to_string(),
            realized_pnl: None,
        }
    }

    #[test]
    fn backtest_insert_and_get() {
        let pool = test_pool();
        let config = sample_config_json();
        backtest_insert_db(&pool, "bt-1", config).unwrap();

        let result = backtest_get_db(&pool, "bt-1").unwrap();
        assert_eq!(result.id, "bt-1");
        assert_eq!(result.status, "running");
        assert!(result.created_at > 0);
        let parsed: serde_json::Value = serde_json::from_value(result.config).unwrap();
        assert_eq!(parsed["id"], "bt-1");
        assert_eq!(parsed["symbols"][0], "AAPL");
    }

    #[test]
    fn backtest_insert_duplicate_fails() {
        let pool = test_pool();
        let config = sample_config_json();
        backtest_insert_db(&pool, "bt-dup", config).unwrap();
        let result = backtest_insert_db(&pool, "bt-dup", config);
        assert!(result.is_err());
    }

    #[test]
    fn backtest_list_returns_all() {
        let pool = test_pool();
        let config = sample_config_json();
        backtest_insert_db(&pool, "bt-a", config).unwrap();
        backtest_insert_db(&pool, "bt-b", config).unwrap();
        backtest_insert_db(&pool, "bt-c", config).unwrap();

        let list = backtest_list_db(&pool).unwrap();
        assert_eq!(list.len(), 3);
    }

    #[test]
    fn backtest_list_orders_by_created_at_desc() {
        let pool = test_pool();
        let config = sample_config_json();
        backtest_insert_db(&pool, "bt-1", config).unwrap();
        backtest_insert_db(&pool, "bt-2", config).unwrap();

        let list = backtest_list_db(&pool).unwrap();
        assert_eq!(list.len(), 2);
        assert!(list[0].created_at >= list[1].created_at);
    }

    #[test]
    fn backtest_update_status() {
        let pool = test_pool();
        let config = sample_config_json();
        backtest_insert_db(&pool, "bt-status", config).unwrap();

        let metrics_json = r#"{"totalReturn":0.15,"sharpeRatio":1.2}"#;
        backtest_update_status_db(&pool, "bt-status", "completed", Some(metrics_json), None)
            .unwrap();

        let result = backtest_get_db(&pool, "bt-status").unwrap();
        assert_eq!(result.status, "completed");
        assert!(result.metrics.is_some());
        let metrics = result.metrics.unwrap();
        assert_eq!(metrics["totalReturn"], 0.15);
        assert_eq!(metrics["sharpeRatio"], 1.2);
        assert!(result.completed_at.is_some());
    }

    #[test]
    fn backtest_delete_removes_record() {
        let pool = test_pool();
        let config = sample_config_json();
        backtest_insert_db(&pool, "bt-del", config).unwrap();

        backtest_delete_db(&pool, "bt-del").unwrap();

        let result = backtest_get_db(&pool, "bt-del");
        assert!(result.is_err());
    }

    #[test]
    fn backtest_delete_cascades_to_trades() {
        let pool = test_pool();
        let config = sample_config_json();
        backtest_insert_db(&pool, "bt-cascade", config).unwrap();

        let trades = vec![
            sample_trade("btt-1", "bt-cascade"),
            sample_trade("btt-2", "bt-cascade"),
        ];
        backtest_insert_trades_db(&pool, &trades).unwrap();

        let before = backtest_get_trades_db(&pool, "bt-cascade").unwrap();
        assert_eq!(before.len(), 2);

        backtest_delete_db(&pool, "bt-cascade").unwrap();

        let conn = pool.get().unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM backtest_trades WHERE backtest_id = ?1",
                ["bt-cascade"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn backtest_get_nonexistent_returns_error() {
        let pool = test_pool();
        let result = backtest_get_db(&pool, "does-not-exist");
        assert!(result.is_err());
    }

    #[test]
    fn backtest_insert_trades_in_transaction() {
        let pool = test_pool();
        let config = sample_config_json();
        backtest_insert_db(&pool, "bt-trades", config).unwrap();

        let trades = vec![
            sample_trade("btt-1", "bt-trades"),
            sample_trade("btt-2", "bt-trades"),
            BacktestTrade {
                id: "btt-3".to_string(),
                backtest_id: "bt-trades".to_string(),
                symbol: "MSFT".to_string(),
                side: "sell".to_string(),
                qty: 5.0,
                fill_price: 420.00,
                timestamp: 1706900000,
                anomaly_id: "anom-2".to_string(),
                rationale: "Sell signal".to_string(),
                realized_pnl: Some(250.0),
            },
        ];
        backtest_insert_trades_db(&pool, &trades).unwrap();

        let stored = backtest_get_trades_db(&pool, "bt-trades").unwrap();
        assert_eq!(stored.len(), 3);
        assert_eq!(stored[0].id, "btt-1");
        assert_eq!(stored[0].symbol, "AAPL");
        assert_eq!(stored[2].id, "btt-3");
        assert_eq!(stored[2].symbol, "MSFT");
        assert_eq!(stored[2].realized_pnl, Some(250.0));
    }

    #[test]
    fn backtest_update_progress() {
        let pool = test_pool();
        let config = sample_config_json();
        backtest_insert_db(&pool, "bt-progress", config).unwrap();

        backtest_update_progress_db(&pool, "bt-progress", 50, 200).unwrap();

        let result = backtest_get_db(&pool, "bt-progress").unwrap();
        assert_eq!(result.ticks_processed, 50);
        assert_eq!(result.total_ticks, 200);
    }
}
