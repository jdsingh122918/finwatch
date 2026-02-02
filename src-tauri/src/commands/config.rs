use crate::db::DbPool;

/// Direct DB access for testing (no Tauri State)
pub fn config_get_db(pool: &DbPool) -> Result<String, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let result: Option<String> = conn
        .query_row(
            "SELECT value FROM config WHERE key = 'main'",
            [],
            |row| row.get(0),
        )
        .ok();
    Ok(result.unwrap_or_else(|| "{}".to_string()))
}

pub fn config_set_db(pool: &DbPool, json: &str) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO config (key, value) VALUES ('main', ?1)
         ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = datetime('now')",
        [json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn config_update_db(pool: &DbPool, patch_json: &str) -> Result<String, String> {
    let current = config_get_db(pool)?;
    let mut current_val: serde_json::Value =
        serde_json::from_str(&current).map_err(|e| e.to_string())?;
    let patch_val: serde_json::Value =
        serde_json::from_str(patch_json).map_err(|e| e.to_string())?;

    merge_json(&mut current_val, &patch_val);
    let merged = serde_json::to_string(&current_val).map_err(|e| e.to_string())?;
    config_set_db(pool, &merged)?;
    Ok(merged)
}

fn merge_json(base: &mut serde_json::Value, patch: &serde_json::Value) {
    if let (serde_json::Value::Object(base_map), serde_json::Value::Object(patch_map)) =
        (base, patch)
    {
        for (key, value) in patch_map {
            if value.is_object() && base_map.get(key).is_some_and(|v| v.is_object()) {
                merge_json(base_map.get_mut(key).unwrap(), value);
            } else {
                base_map.insert(key.clone(), value.clone());
            }
        }
    }
}

// Tauri command wrappers — these use State<DbPool>
#[tauri::command]
pub fn config_get(pool: tauri::State<'_, DbPool>) -> Result<String, String> {
    config_get_db(&pool)
}

#[tauri::command]
pub fn config_update(pool: tauri::State<'_, DbPool>, patch: String) -> Result<String, String> {
    config_update_db(&pool, &patch)
}
