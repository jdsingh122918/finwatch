use crate::db::DbPool;
use crate::types::data::{SourceHealth, SourceHealthStatus};
use std::collections::HashMap;

pub fn sources_health_set_db(pool: &DbPool, health: &SourceHealth) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let status_str = serde_json::to_value(health.status)
        .map_err(|e| e.to_string())?
        .as_str()
        .unwrap_or("offline")
        .to_string();

    conn.execute(
        "INSERT INTO source_health (source_id, status, last_success, last_failure, fail_count, latency_ms, message)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(source_id) DO UPDATE SET
            status = ?2, last_success = ?3, last_failure = ?4,
            fail_count = ?5, latency_ms = ?6, message = ?7,
            updated_at = datetime('now')",
        rusqlite::params![
            health.source_id,
            status_str,
            health.last_success,
            health.last_failure,
            health.fail_count,
            health.latency_ms,
            health.message,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn sources_health_db(pool: &DbPool) -> Result<HashMap<String, SourceHealth>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT source_id, status, last_success, last_failure, fail_count, latency_ms, message FROM source_health")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let status_str: String = row.get(1)?;
            Ok(SourceHealth {
                source_id: row.get(0)?,
                status: serde_json::from_str(&format!("\"{}\"", status_str))
                    .unwrap_or(SourceHealthStatus::Offline),
                last_success: row.get(2)?,
                last_failure: row.get(3)?,
                fail_count: row.get(4)?,
                latency_ms: row.get(5)?,
                message: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut map = HashMap::new();
    for row in rows {
        let health = row.map_err(|e| e.to_string())?;
        map.insert(health.source_id.clone(), health);
    }
    Ok(map)
}

// Tauri command wrapper
#[tauri::command]
pub fn sources_health(
    pool: tauri::State<'_, DbPool>,
) -> Result<HashMap<String, SourceHealth>, String> {
    sources_health_db(&pool)
}
