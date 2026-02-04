use crate::db::DbPool;
use crate::types::backtest::{BacktestSummary, BacktestTrade};

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

pub fn backtest_insert_trades_db(pool: &DbPool, trades: &[BacktestTrade]) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    for trade in trades {
        conn.execute(
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
    Ok(())
}

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
                config: serde_json::from_str(&config_str).unwrap_or_default(),
                metrics: metrics_str.and_then(|s| serde_json::from_str(&s).ok()),
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

pub fn backtest_get_db(pool: &DbPool, id: &str) -> Result<BacktestSummary, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let config_str: String = conn
        .query_row("SELECT config FROM backtests WHERE id = ?1", [id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, status, config, metrics, created_at, completed_at, ticks_processed, total_ticks, error FROM backtests WHERE id = ?1")
        .map_err(|e| e.to_string())?;

    stmt.query_row([id], |row| {
        let metrics_str: Option<String> = row.get(3)?;
        Ok(BacktestSummary {
            id: row.get(0)?,
            status: row.get(1)?,
            config: serde_json::from_str(&config_str).unwrap_or_default(),
            metrics: metrics_str.and_then(|s| serde_json::from_str(&s).ok()),
            created_at: row.get(4)?,
            completed_at: row.get(5)?,
            ticks_processed: row.get(6)?,
            total_ticks: row.get(7)?,
            error: row.get(8)?,
        })
    })
    .map_err(|e| e.to_string())
}

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
                anomaly_id: row.get(7)?,
                rationale: row.get(8)?,
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

pub fn backtest_delete_db(pool: &DbPool, id: &str) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM backtest_trades WHERE backtest_id = ?1", [id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM backtests WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// Tauri command wrappers
#[tauri::command]
pub fn backtest_start(
    pool: tauri::State<'_, DbPool>,
    config: String,
) -> Result<String, String> {
    let parsed: serde_json::Value = serde_json::from_str(&config).map_err(|e| e.to_string())?;
    let id = parsed["id"].as_str().unwrap_or("bt-unknown").to_string();
    backtest_insert_db(&pool, &id, &config)?;
    Ok(id)
}

#[tauri::command]
pub fn backtest_list(pool: tauri::State<'_, DbPool>) -> Result<Vec<BacktestSummary>, String> {
    backtest_list_db(&pool)
}

#[tauri::command]
pub fn backtest_get(
    pool: tauri::State<'_, DbPool>,
    backtest_id: String,
) -> Result<BacktestSummary, String> {
    backtest_get_db(&pool, &backtest_id)
}

#[tauri::command]
pub fn backtest_get_trades(
    pool: tauri::State<'_, DbPool>,
    backtest_id: String,
) -> Result<Vec<BacktestTrade>, String> {
    backtest_get_trades_db(&pool, &backtest_id)
}

#[tauri::command]
pub fn backtest_delete(
    pool: tauri::State<'_, DbPool>,
    backtest_id: String,
) -> Result<(), String> {
    backtest_delete_db(&pool, &backtest_id)
}
