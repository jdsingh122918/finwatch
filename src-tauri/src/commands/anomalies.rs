use crate::db::DbPool;
use crate::types::anomaly::{Anomaly, AnomalyFeedback, AnomalyFilter, Severity};

pub fn anomalies_insert_db(pool: &DbPool, anomaly: &Anomaly) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let metrics_json = serde_json::to_string(&anomaly.metrics).map_err(|e| e.to_string())?;
    let severity_str = serde_json::to_value(anomaly.severity)
        .map_err(|e| e.to_string())?
        .as_str()
        .unwrap_or("low")
        .to_string();

    conn.execute(
        "INSERT INTO anomalies (id, severity, source, symbol, timestamp, description, metrics, pre_screen_score, session_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            anomaly.id,
            severity_str,
            anomaly.source,
            anomaly.symbol,
            anomaly.timestamp,
            anomaly.description,
            metrics_json,
            anomaly.pre_screen_score,
            anomaly.session_id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn anomalies_list_db(
    pool: &DbPool,
    filter: &Option<AnomalyFilter>,
) -> Result<Vec<Anomaly>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut sql = "SELECT id, severity, source, symbol, timestamp, description, metrics, pre_screen_score, session_id FROM anomalies WHERE 1=1".to_string();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(f) = filter {
        if let Some(ref sevs) = f.severity {
            if !sevs.is_empty() {
                let placeholders: Vec<String> = sevs
                    .iter()
                    .enumerate()
                    .map(|(i, _)| format!("?{}", params.len() + i + 1))
                    .collect();
                sql.push_str(&format!(" AND severity IN ({})", placeholders.join(",")));
                for s in sevs {
                    let s_str = serde_json::to_value(s).unwrap();
                    params.push(Box::new(s_str.as_str().unwrap().to_string()));
                }
            }
        }
        if let Some(ref source) = f.source {
            params.push(Box::new(source.clone()));
            sql.push_str(&format!(" AND source = ?{}", params.len()));
        }
        if let Some(ref symbol) = f.symbol {
            params.push(Box::new(symbol.clone()));
            sql.push_str(&format!(" AND symbol = ?{}", params.len()));
        }
        if let Some(since) = f.since {
            params.push(Box::new(since as i64));
            sql.push_str(&format!(" AND timestamp >= ?{}", params.len()));
        }
    }

    sql.push_str(" ORDER BY timestamp DESC");

    if let Some(f) = filter {
        if let Some(limit) = f.limit {
            sql.push_str(&format!(" LIMIT {}", limit));
        }
    }

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            let severity_str: String = row.get(1)?;
            let metrics_str: String = row.get(6)?;
            Ok(Anomaly {
                id: row.get(0)?,
                severity: serde_json::from_str(&format!("\"{}\"", severity_str))
                    .unwrap_or(Severity::Low),
                source: row.get(2)?,
                symbol: row.get(3)?,
                timestamp: row.get(4)?,
                description: row.get(5)?,
                metrics: serde_json::from_str(&metrics_str).unwrap_or_default(),
                pre_screen_score: row.get(7)?,
                session_id: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut results = Vec::new();
    for row in rows {
        results.push(row.map_err(|e| e.to_string())?);
    }
    Ok(results)
}

pub fn anomalies_feedback_db(pool: &DbPool, feedback: &AnomalyFeedback) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let verdict_str = serde_json::to_value(feedback.verdict)
        .map_err(|e| e.to_string())?
        .as_str()
        .unwrap_or("needs_review")
        .to_string();

    conn.execute(
        "INSERT INTO feedback (anomaly_id, verdict, note, timestamp) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![feedback.anomaly_id, verdict_str, feedback.note, feedback.timestamp],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// Tauri command wrappers
#[tauri::command]
pub fn anomalies_list(
    pool: tauri::State<'_, DbPool>,
    filter: Option<AnomalyFilter>,
) -> Result<Vec<Anomaly>, String> {
    anomalies_list_db(&pool, &filter)
}

#[tauri::command]
pub fn anomalies_feedback(
    pool: tauri::State<'_, DbPool>,
    id: String,
    feedback: AnomalyFeedback,
) -> Result<(), String> {
    let _ = id; // anomaly_id is in the feedback struct
    anomalies_feedback_db(&pool, &feedback)
}
