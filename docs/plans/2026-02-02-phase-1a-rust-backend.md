# Phase 1A: Rust Backend — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the full Rust backend for FinWatch: SQLite persistence, real IPC command handlers, Tauri event emission, Node.js sidecar process management, and JSON-RPC bridge.

**Architecture:** Tauri v2 Rust backend with r2d2 SQLite connection pool, migration system, typed IPC commands backed by real database queries, sidecar process supervisor, and bidirectional JSON-RPC over stdio.

**Tech Stack:** Rust (edition 2021), Tauri v2, rusqlite + r2d2, serde_json, tauri-plugin-shell

**Worktree:** `/Users/jdsingh/Projects/AI/finwatch-rust-backend`
**Branch:** `feat/rust-backend`
**Owns:** `src-tauri/` — EXCLUSIVE

---

## Existing State (from Phase 0)

- `Cargo.toml`: tauri 2, tauri-plugin-opener 2, tauri-plugin-shell 2, tauri-plugin-process 2, serde 1 (derive), serde_json 1
- `src/lib.rs`: `pub mod commands; pub mod types;` + `run()` with invoke_handler registering all 10 command stubs
- `src/commands/`: agent.rs, config.rs, anomalies.rs, memory.rs, sources.rs — ALL STUBS
- `src/types/`: data.rs, anomaly.rs, memory.rs, agent.rs, provider.rs, config.rs — fully defined
- 8 passing tests (6 serde roundtrip + 2 command shape tests)

---

## Task 1A.1: SQLite Connection Pool

**Files:**
- Modify: `src-tauri/Cargo.toml` (add rusqlite, r2d2, r2d2_sqlite, dirs)
- Create: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod db;`)

**Step 1: Add dependencies to Cargo.toml**

Add under `[dependencies]`:

```toml
rusqlite = { version = "0.31", features = ["bundled"] }
r2d2 = "0.8"
r2d2_sqlite = "0.24"
dirs = "5"
```

**Step 2: Write the failing test**

Create `src-tauri/src/db.rs`:

```rust
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use std::path::PathBuf;

pub type DbPool = Pool<SqliteConnectionManager>;

pub fn finwatch_data_dir() -> PathBuf {
    todo!()
}

pub fn create_pool(db_path: &std::path::Path) -> Result<DbPool, Box<dyn std::error::Error>> {
    todo!()
}

pub fn init_db(pool: &DbPool) -> Result<(), Box<dyn std::error::Error>> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn finwatch_data_dir_ends_with_finwatch() {
        let dir = finwatch_data_dir();
        assert!(dir.ends_with(".finwatch"));
    }

    #[test]
    fn create_pool_returns_valid_pool() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.sqlite");
        let pool = create_pool(&db_path).unwrap();
        let conn = pool.get().unwrap();
        conn.execute_batch("SELECT 1").unwrap();
    }

    #[test]
    fn create_pool_creates_parent_dirs() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("nested").join("deep").join("test.sqlite");
        let pool = create_pool(&db_path).unwrap();
        let conn = pool.get().unwrap();
        conn.execute_batch("SELECT 1").unwrap();
    }

    #[test]
    fn init_db_creates_tables() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.sqlite");
        let pool = create_pool(&db_path).unwrap();
        init_db(&pool).unwrap();

        let conn = pool.get().unwrap();
        // Verify core tables exist
        let tables: Vec<String> = conn
            .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
            .unwrap()
            .query_map([], |row| row.get(0))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect();

        assert!(tables.contains(&"config".to_string()));
        assert!(tables.contains(&"anomalies".to_string()));
        assert!(tables.contains(&"feedback".to_string()));
        assert!(tables.contains(&"migrations".to_string()));
    }

    #[test]
    fn init_db_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("test.sqlite");
        let pool = create_pool(&db_path).unwrap();
        init_db(&pool).unwrap();
        init_db(&pool).unwrap(); // second call should not fail
    }
}
```

Also add `tempfile` as a dev dependency in `Cargo.toml`:

```toml
[dev-dependencies]
tempfile = "3"
```

**Step 3: Run tests — verify they FAIL**

```bash
cargo test --manifest-path src-tauri/Cargo.toml db::tests
```

Expected: FAIL — `todo!()` panics.

**Step 4: Write the implementation**

Replace the `todo!()` bodies in `src-tauri/src/db.rs`:

```rust
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use std::path::PathBuf;

pub type DbPool = Pool<SqliteConnectionManager>;

pub fn finwatch_data_dir() -> PathBuf {
    dirs::home_dir()
        .expect("Could not determine home directory")
        .join(".finwatch")
}

pub fn create_pool(db_path: &std::path::Path) -> Result<DbPool, Box<dyn std::error::Error>> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let manager = SqliteConnectionManager::file(db_path);
    let pool = Pool::builder().max_size(8).build(manager)?;

    // Enable WAL mode for better concurrent read performance
    let conn = pool.get()?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;

    Ok(pool)
}

pub fn init_db(pool: &DbPool) -> Result<(), Box<dyn std::error::Error>> {
    let conn = pool.get()?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS migrations (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL UNIQUE,
            applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS anomalies (
            id TEXT PRIMARY KEY,
            severity TEXT NOT NULL CHECK(severity IN ('low','medium','high','critical')),
            source TEXT NOT NULL,
            symbol TEXT,
            timestamp INTEGER NOT NULL,
            description TEXT NOT NULL,
            metrics TEXT NOT NULL,
            pre_screen_score REAL NOT NULL,
            session_id TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            anomaly_id TEXT NOT NULL REFERENCES anomalies(id),
            verdict TEXT NOT NULL CHECK(verdict IN ('confirmed','false_positive','needs_review')),
            note TEXT,
            timestamp INTEGER NOT NULL,
            processed INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_anomalies_timestamp ON anomalies(timestamp);
        CREATE INDEX IF NOT EXISTS idx_anomalies_severity ON anomalies(severity);
        CREATE INDEX IF NOT EXISTS idx_anomalies_source ON anomalies(source);
        CREATE INDEX IF NOT EXISTS idx_feedback_anomaly ON feedback(anomaly_id);
        CREATE INDEX IF NOT EXISTS idx_feedback_processed ON feedback(processed);"
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    // ... tests from Step 2
}
```

Add `pub mod db;` to `src-tauri/src/lib.rs`.

**Step 5: Run tests — verify they PASS**

```bash
cargo test --manifest-path src-tauri/Cargo.toml db::tests
```

Expected: ALL PASS.

**Step 6: Commit**

```bash
git add src-tauri/
git commit -m "feat: add SQLite connection pool with r2d2 and initial schema"
```

---

## Task 1A.2: Database Migrations System

**Files:**
- Create: `src-tauri/src/migrations.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod migrations;`)

**Step 1: Write the failing test**

Create `src-tauri/src/migrations.rs`:

```rust
use crate::db::DbPool;

pub struct Migration {
    pub name: &'static str,
    pub sql: &'static str,
}

pub fn all_migrations() -> Vec<Migration> {
    todo!()
}

pub fn run_pending(pool: &DbPool) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    todo!()
}

pub fn applied(pool: &DbPool) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn test_pool() -> DbPool {
        let dir = tempfile::tempdir().unwrap();
        let pool = db::create_pool(&dir.path().join("test.sqlite")).unwrap();
        db::init_db(&pool).unwrap();
        pool
    }

    #[test]
    fn run_pending_on_fresh_db_applies_all() {
        let pool = test_pool();
        let applied = run_pending(&pool).unwrap();
        let all = all_migrations();
        assert_eq!(applied.len(), all.len());
    }

    #[test]
    fn run_pending_is_idempotent() {
        let pool = test_pool();
        let first = run_pending(&pool).unwrap();
        let second = run_pending(&pool).unwrap();
        assert!(!first.is_empty());
        assert!(second.is_empty()); // nothing new to apply
    }

    #[test]
    fn applied_returns_names_in_order() {
        let pool = test_pool();
        run_pending(&pool).unwrap();
        let names = applied(&pool).unwrap();
        assert!(!names.is_empty());
        assert_eq!(names[0], all_migrations()[0].name);
    }
}
```

**Step 2: Run tests — verify they FAIL**

```bash
cargo test --manifest-path src-tauri/Cargo.toml migrations::tests
```

**Step 3: Implement**

Replace `todo!()` bodies:

```rust
use crate::db::DbPool;

pub struct Migration {
    pub name: &'static str,
    pub sql: &'static str,
}

pub fn all_migrations() -> Vec<Migration> {
    vec![
        Migration {
            name: "001_initial_schema",
            sql: "-- initial schema created by init_db, this is a placeholder
                  SELECT 1;",
        },
        Migration {
            name: "002_source_health_table",
            sql: "CREATE TABLE IF NOT EXISTS source_health (
                      source_id TEXT PRIMARY KEY,
                      status TEXT NOT NULL DEFAULT 'healthy',
                      last_success INTEGER,
                      last_failure INTEGER,
                      fail_count INTEGER NOT NULL DEFAULT 0,
                      latency_ms INTEGER NOT NULL DEFAULT 0,
                      message TEXT,
                      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                  );",
        },
    ]
}

pub fn run_pending(pool: &DbPool) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let conn = pool.get()?;
    let applied_set: std::collections::HashSet<String> = conn
        .prepare("SELECT name FROM migrations ORDER BY id")?
        .query_map([], |row| row.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .collect();

    let mut newly_applied = Vec::new();

    for migration in all_migrations() {
        if !applied_set.contains(migration.name) {
            conn.execute_batch(migration.sql)?;
            conn.execute(
                "INSERT INTO migrations (name) VALUES (?1)",
                [migration.name],
            )?;
            newly_applied.push(migration.name.to_string());
        }
    }

    Ok(newly_applied)
}

pub fn applied(pool: &DbPool) -> Result<Vec<String>, Box<dyn std::error::Error>> {
    let conn = pool.get()?;
    let names: Vec<String> = conn
        .prepare("SELECT name FROM migrations ORDER BY id")?
        .query_map([], |row| row.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(names)
}
```

Add `pub mod migrations;` to `src-tauri/src/lib.rs`.

**Step 4: Run tests — verify they PASS**

```bash
cargo test --manifest-path src-tauri/Cargo.toml migrations::tests
```

**Step 5: Commit**

```bash
git add src-tauri/
git commit -m "feat: add database migration system"
```

---

## Task 1A.3: IPC Command Handlers — Config CRUD

**Files:**
- Modify: `src-tauri/src/commands/config.rs` (replace stubs)
- Modify: `src-tauri/src/commands/mod.rs` (add tests)
- Modify: `src-tauri/src/lib.rs` (manage DbPool state)

**Step 1: Write the failing test**

Add to `src-tauri/src/commands/mod.rs` tests:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn test_pool() -> db::DbPool {
        let dir = tempfile::tempdir().unwrap();
        let pool = db::create_pool(&dir.path().join("test.sqlite")).unwrap();
        db::init_db(&pool).unwrap();
        pool
    }

    #[test]
    fn config_set_and_get() {
        let pool = test_pool();
        let config_json = serde_json::json!({
            "monitor": { "analysisIntervalMs": 60000 }
        });
        config::config_set_db(&pool, &config_json.to_string()).unwrap();
        let result = config::config_get_db(&pool).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(parsed["monitor"]["analysisIntervalMs"], 60000);
    }

    #[test]
    fn config_get_returns_empty_obj_when_no_config() {
        let pool = test_pool();
        let result = config::config_get_db(&pool).unwrap();
        assert_eq!(result, "{}");
    }

    #[test]
    fn config_update_merges_patch() {
        let pool = test_pool();
        let initial = serde_json::json!({ "a": 1, "b": 2 });
        config::config_set_db(&pool, &initial.to_string()).unwrap();

        let patch = serde_json::json!({ "b": 99, "c": 3 });
        let result = config::config_update_db(&pool, &patch.to_string()).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&result).unwrap();

        assert_eq!(parsed["a"], 1);
        assert_eq!(parsed["b"], 99);
        assert_eq!(parsed["c"], 3);
    }

    // Keep existing tests
    #[test]
    fn agent_status_returns_valid_json() {
        let status = agent::agent_status();
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"state\""));
    }

    #[test]
    fn sources_health_returns_map() {
        let health = sources::sources_health();
        let json = serde_json::to_string(&health).unwrap();
        assert!(json.starts_with('{'));
    }
}
```

**Step 2: Run tests — verify they FAIL**

```bash
cargo test --manifest-path src-tauri/Cargo.toml commands::tests
```

**Step 3: Implement config command handlers**

Replace `src-tauri/src/commands/config.rs`:

```rust
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
            if value.is_object() && base_map.get(key).map_or(false, |v| v.is_object()) {
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
```

Update `src-tauri/src/lib.rs` to manage DbPool as Tauri state:

```rust
pub mod commands;
pub mod db;
pub mod migrations;
pub mod types;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let data_dir = db::finwatch_data_dir();
    let db_path = data_dir.join("state").join("finwatch.sqlite");
    let pool = db::create_pool(&db_path).expect("Failed to create database pool");
    db::init_db(&pool).expect("Failed to initialize database");
    migrations::run_pending(&pool).expect("Failed to run migrations");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .manage(pool)
        .invoke_handler(tauri::generate_handler![
            commands::agent::agent_start,
            commands::agent::agent_stop,
            commands::agent::agent_status,
            commands::config::config_get,
            commands::config::config_update,
            commands::anomalies::anomalies_list,
            commands::anomalies::anomalies_feedback,
            commands::memory::memory_search,
            commands::sources::sources_health,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Remove the old `greet` command if it still exists in lib.rs.

**Step 4: Run tests — verify they PASS**

```bash
cargo test --manifest-path src-tauri/Cargo.toml commands::tests
```

**Step 5: Commit**

```bash
git add src-tauri/
git commit -m "feat: implement config CRUD with SQLite persistence"
```

---

## Task 1A.4: IPC Command Handlers — Anomalies, Memory, Sources

**Files:**
- Modify: `src-tauri/src/commands/anomalies.rs`
- Modify: `src-tauri/src/commands/sources.rs`
- Modify: `src-tauri/src/commands/mod.rs` (add tests)
- `src-tauri/src/commands/memory.rs` stays as stub (real implementation in Phase 2)

**Step 1: Write the failing tests**

Add to `src-tauri/src/commands/mod.rs` tests:

```rust
    #[test]
    fn anomalies_insert_and_list() {
        let pool = test_pool();
        let anomaly = crate::types::anomaly::Anomaly {
            id: "anom-001".to_string(),
            severity: crate::types::anomaly::Severity::High,
            source: "yahoo-finance".to_string(),
            symbol: Some("AAPL".to_string()),
            timestamp: 1706800000,
            description: "Volume spike".to_string(),
            metrics: [("volume".to_string(), 5000000.0)].into(),
            pre_screen_score: 0.85,
            session_id: "cycle-001".to_string(),
        };
        anomalies::anomalies_insert_db(&pool, &anomaly).unwrap();
        let list = anomalies::anomalies_list_db(&pool, &None).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "anom-001");
    }

    #[test]
    fn anomalies_filter_by_severity() {
        let pool = test_pool();
        let mut a1 = crate::types::anomaly::Anomaly {
            id: "anom-low".to_string(),
            severity: crate::types::anomaly::Severity::Low,
            source: "test".to_string(),
            symbol: None,
            timestamp: 1000,
            description: "low".to_string(),
            metrics: Default::default(),
            pre_screen_score: 0.3,
            session_id: "s1".to_string(),
        };
        anomalies::anomalies_insert_db(&pool, &a1).unwrap();
        a1.id = "anom-high".to_string();
        a1.severity = crate::types::anomaly::Severity::High;
        anomalies::anomalies_insert_db(&pool, &a1).unwrap();

        let filter = crate::types::anomaly::AnomalyFilter {
            severity: Some(vec![crate::types::anomaly::Severity::High]),
            source: None, symbol: None, since: None, limit: None,
        };
        let list = anomalies::anomalies_list_db(&pool, &Some(filter)).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "anom-high");
    }

    #[test]
    fn feedback_insert_and_query() {
        let pool = test_pool();
        // Insert anomaly first (FK constraint)
        let anomaly = crate::types::anomaly::Anomaly {
            id: "anom-fb".to_string(),
            severity: crate::types::anomaly::Severity::Medium,
            source: "test".to_string(),
            symbol: None,
            timestamp: 1000,
            description: "test".to_string(),
            metrics: Default::default(),
            pre_screen_score: 0.5,
            session_id: "s1".to_string(),
        };
        anomalies::anomalies_insert_db(&pool, &anomaly).unwrap();

        let fb = crate::types::anomaly::AnomalyFeedback {
            anomaly_id: "anom-fb".to_string(),
            verdict: crate::types::anomaly::FeedbackVerdict::Confirmed,
            note: Some("Looks correct".to_string()),
            timestamp: 2000,
        };
        anomalies::anomalies_feedback_db(&pool, &fb).unwrap();
    }

    #[test]
    fn sources_health_set_and_get() {
        let pool = test_pool();
        crate::migrations::run_pending(&pool).unwrap();
        let health = crate::types::data::SourceHealth {
            source_id: "yahoo".to_string(),
            status: crate::types::data::SourceHealthStatus::Healthy,
            last_success: 1000,
            last_failure: None,
            fail_count: 0,
            latency_ms: 50,
            message: None,
        };
        sources::sources_health_set_db(&pool, &health).unwrap();
        let all = sources::sources_health_db(&pool).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all["yahoo"].status, crate::types::data::SourceHealthStatus::Healthy);
    }
```

**Step 2: Run tests — verify they FAIL**

```bash
cargo test --manifest-path src-tauri/Cargo.toml commands::tests
```

**Step 3: Implement anomalies commands**

Replace `src-tauri/src/commands/anomalies.rs`:

```rust
use crate::db::DbPool;
use crate::types::anomaly::{Anomaly, AnomalyFeedback, AnomalyFilter, Severity};
use std::collections::HashMap;

pub fn anomalies_insert_db(pool: &DbPool, anomaly: &Anomaly) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let metrics_json = serde_json::to_string(&anomaly.metrics).map_err(|e| e.to_string())?;
    let severity_str = serde_json::to_value(&anomaly.severity)
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
    let verdict_str = serde_json::to_value(&feedback.verdict)
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
```

Replace `src-tauri/src/commands/sources.rs`:

```rust
use crate::db::DbPool;
use crate::types::data::{SourceHealth, SourceHealthStatus};
use std::collections::HashMap;

pub fn sources_health_set_db(pool: &DbPool, health: &SourceHealth) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let status_str = serde_json::to_value(&health.status)
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
```

**Step 4: Run tests — verify they PASS**

```bash
cargo test --manifest-path src-tauri/Cargo.toml commands::tests
```

**Step 5: Commit**

```bash
git add src-tauri/
git commit -m "feat: implement anomaly and source health commands with SQLite"
```

---

## Task 1A.5: Event Emission System

**Files:**
- Create: `src-tauri/src/events.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod events;`)

**Step 1: Write the failing test**

Create `src-tauri/src/events.rs`:

```rust
use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

/// Event names as constants — matches shared/src/ipc.ts IpcEvents
pub mod event_names {
    pub const AGENT_ACTIVITY: &str = "agent:activity";
    pub const DATA_TICK: &str = "data:tick";
    pub const ANOMALY_DETECTED: &str = "anomaly:detected";
    pub const SOURCE_HEALTH_CHANGE: &str = "source:health-change";
    pub const MEMORY_UPDATED: &str = "memory:updated";
}

pub fn emit_event<R: Runtime, T: Serialize + Clone>(
    app: &AppHandle<R>,
    event: &str,
    payload: T,
) -> Result<(), String> {
    app.emit(event, payload).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::event_names::*;

    #[test]
    fn event_names_match_ipc_contract() {
        assert_eq!(AGENT_ACTIVITY, "agent:activity");
        assert_eq!(DATA_TICK, "data:tick");
        assert_eq!(ANOMALY_DETECTED, "anomaly:detected");
        assert_eq!(SOURCE_HEALTH_CHANGE, "source:health-change");
        assert_eq!(MEMORY_UPDATED, "memory:updated");
    }

    #[test]
    fn emit_event_compiles_with_typed_payloads() {
        // This test verifies the function signature compiles with our types.
        // Actual emission requires a running Tauri app, tested in integration.
        use crate::types::agent::{AgentActivity, AgentActivityType};
        let _activity = AgentActivity {
            activity_type: AgentActivityType::CycleStart,
            message: "test".to_string(),
            timestamp: 1000,
            data: None,
        };
        // If this compiles, the types are compatible with Serialize + Clone
        fn _assert_serialize_clone<T: serde::Serialize + Clone>(_: &T) {}
        _assert_serialize_clone(&_activity);
    }
}
```

**Step 2: Run tests — verify they PASS (these are compile-time + constant tests)**

```bash
cargo test --manifest-path src-tauri/Cargo.toml events::tests
```

Add `pub mod events;` to lib.rs.

**Step 3: Commit**

```bash
git add src-tauri/
git commit -m "feat: add typed event emission system"
```

---

## Task 1A.6: Node.js Sidecar Process Supervisor

**Files:**
- Create: `src-tauri/src/sidecar.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod sidecar;`)

**Step 1: Write the failing test**

Create `src-tauri/src/sidecar.rs`:

```rust
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, PartialEq)]
pub enum SidecarState {
    Stopped,
    Starting,
    Running,
    Crashed { restart_count: u32 },
}

pub struct SidecarSupervisor {
    state: Arc<Mutex<SidecarState>>,
    max_restarts: u32,
}

impl SidecarSupervisor {
    pub fn new(max_restarts: u32) -> Self {
        Self {
            state: Arc::new(Mutex::new(SidecarState::Stopped)),
            max_restarts,
        }
    }

    pub fn state(&self) -> SidecarState {
        self.state.lock().unwrap().clone()
    }

    pub fn set_state(&self, new_state: SidecarState) {
        *self.state.lock().unwrap() = new_state;
    }

    pub fn should_restart(&self) -> bool {
        match self.state() {
            SidecarState::Crashed { restart_count } => restart_count < self.max_restarts,
            _ => false,
        }
    }

    pub fn record_crash(&self) {
        let mut state = self.state.lock().unwrap();
        let count = match *state {
            SidecarState::Crashed { restart_count } => restart_count + 1,
            _ => 1,
        };
        *state = SidecarState::Crashed { restart_count: count };
    }

    pub fn record_started(&self) {
        *self.state.lock().unwrap() = SidecarState::Running;
    }

    pub fn record_stopped(&self) {
        *self.state.lock().unwrap() = SidecarState::Stopped;
    }
}

/// Spawns the sidecar using Tauri's shell plugin.
/// This function requires a running Tauri app — tested in integration only.
/// The sidecar binary must be declared in tauri.conf.json under
/// "bundle" > "externalBin" as "binaries/finwatch-agent".
///
/// In dev mode, we use `tauri::api::shell::Command::new_sidecar("finwatch-agent")`
/// which maps to `src-tauri/binaries/finwatch-agent-{target_triple}`.
///
/// For development, we'll instead spawn via shell plugin using `node` directly.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_supervisor_starts_stopped() {
        let sup = SidecarSupervisor::new(3);
        assert_eq!(sup.state(), SidecarState::Stopped);
    }

    #[test]
    fn record_started_sets_running() {
        let sup = SidecarSupervisor::new(3);
        sup.record_started();
        assert_eq!(sup.state(), SidecarState::Running);
    }

    #[test]
    fn record_crash_increments_count() {
        let sup = SidecarSupervisor::new(3);
        sup.record_started();
        sup.record_crash();
        assert_eq!(sup.state(), SidecarState::Crashed { restart_count: 1 });
        sup.record_crash();
        assert_eq!(sup.state(), SidecarState::Crashed { restart_count: 2 });
    }

    #[test]
    fn should_restart_true_under_max() {
        let sup = SidecarSupervisor::new(3);
        sup.record_started();
        sup.record_crash(); // count = 1
        assert!(sup.should_restart());
        sup.record_crash(); // count = 2
        assert!(sup.should_restart());
    }

    #[test]
    fn should_restart_false_at_max() {
        let sup = SidecarSupervisor::new(2);
        sup.record_started();
        sup.record_crash(); // 1
        sup.record_crash(); // 2 = max
        assert!(!sup.should_restart());
    }

    #[test]
    fn should_restart_false_when_stopped() {
        let sup = SidecarSupervisor::new(3);
        assert!(!sup.should_restart());
    }

    #[test]
    fn record_stopped_resets() {
        let sup = SidecarSupervisor::new(3);
        sup.record_started();
        sup.record_crash();
        sup.record_stopped();
        assert_eq!(sup.state(), SidecarState::Stopped);
    }
}
```

**Step 2: Run tests — they should PASS (this is a state machine, no I/O)**

```bash
cargo test --manifest-path src-tauri/Cargo.toml sidecar::tests
```

Add `pub mod sidecar;` to lib.rs.

**Step 3: Commit**

```bash
git add src-tauri/
git commit -m "feat: add sidecar process supervisor state machine"
```

---

## Task 1A.7: JSON-RPC Bridge (Rust Side)

**Files:**
- Create: `src-tauri/src/jsonrpc.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod jsonrpc;`)

**Step 1: Write the failing test**

Create `src-tauri/src/jsonrpc.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};

static REQUEST_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: u64,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    pub data: Option<serde_json::Value>,
}

impl JsonRpcRequest {
    pub fn new(method: &str, params: Option<serde_json::Value>) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id: REQUEST_ID.fetch_add(1, Ordering::SeqCst),
            method: method.to_string(),
            params,
        }
    }

    pub fn to_line(&self) -> Result<String, serde_json::Error> {
        let mut s = serde_json::to_string(self)?;
        s.push('\n');
        Ok(s)
    }
}

impl JsonRpcResponse {
    pub fn is_success(&self) -> bool {
        self.error.is_none()
    }

    pub fn from_line(line: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(line.trim())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_serializes_to_valid_json() {
        let req = JsonRpcRequest::new("ping", None);
        let line = req.to_line().unwrap();
        assert!(line.ends_with('\n'));
        let parsed: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(parsed["jsonrpc"], "2.0");
        assert_eq!(parsed["method"], "ping");
    }

    #[test]
    fn request_with_params() {
        let params = serde_json::json!({"query": "test"});
        let req = JsonRpcRequest::new("memory:search", Some(params));
        let line = req.to_line().unwrap();
        let parsed: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(parsed["params"]["query"], "test");
    }

    #[test]
    fn request_ids_auto_increment() {
        let r1 = JsonRpcRequest::new("a", None);
        let r2 = JsonRpcRequest::new("b", None);
        assert!(r2.id > r1.id);
    }

    #[test]
    fn response_parses_success() {
        let json = r#"{"jsonrpc":"2.0","id":1,"result":{"status":"ok"}}"#;
        let resp = JsonRpcResponse::from_line(json).unwrap();
        assert!(resp.is_success());
        assert_eq!(resp.result.unwrap()["status"], "ok");
    }

    #[test]
    fn response_parses_error() {
        let json = r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found"}}"#;
        let resp = JsonRpcResponse::from_line(json).unwrap();
        assert!(!resp.is_success());
        assert_eq!(resp.error.unwrap().code, -32601);
    }

    #[test]
    fn roundtrip_request_matches_node_format() {
        // This must match what agent/src/ipc/json-rpc.ts expects
        let req = JsonRpcRequest::new("ping", Some(serde_json::json!({})));
        let line = req.to_line().unwrap();
        let parsed: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert!(parsed.get("jsonrpc").is_some());
        assert!(parsed.get("id").is_some());
        assert!(parsed.get("method").is_some());
    }
}
```

**Step 2: Run tests — verify they PASS**

```bash
cargo test --manifest-path src-tauri/Cargo.toml jsonrpc::tests
```

Add `pub mod jsonrpc;` to lib.rs.

**Step 3: Commit**

```bash
git add src-tauri/
git commit -m "feat: add JSON-RPC request/response types for sidecar bridge"
```

---

## Task 1A.8: File System Watcher for Config Hot-Reload

**Files:**
- Create: `src-tauri/src/watcher.rs`
- Modify: `src-tauri/src/lib.rs` (add `pub mod watcher;`)
- Modify: `src-tauri/Cargo.toml` (add notify)

**Step 1: Add notify dependency**

Add to `src-tauri/Cargo.toml`:

```toml
notify = "6"
```

**Step 2: Write the failing test**

Create `src-tauri/src/watcher.rs`:

```rust
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::mpsc;

pub enum WatchEvent {
    ConfigChanged,
    SourceFileChanged { path: PathBuf },
}

pub fn classify_event(event: &Event, config_path: &std::path::Path) -> Option<WatchEvent> {
    match event.kind {
        EventKind::Modify(_) | EventKind::Create(_) => {
            for path in &event.paths {
                if path == config_path {
                    return Some(WatchEvent::ConfigChanged);
                }
                if path.extension().map_or(false, |ext| ext == "csv") {
                    return Some(WatchEvent::SourceFileChanged {
                        path: path.clone(),
                    });
                }
            }
            None
        }
        _ => None,
    }
}

pub fn create_watcher(
    tx: mpsc::Sender<WatchEvent>,
    config_path: PathBuf,
) -> Result<RecommendedWatcher, notify::Error> {
    let watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            if let Some(watch_event) = classify_event(&event, &config_path) {
                let _ = tx.send(watch_event);
            }
        }
    })?;
    Ok(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, ModifyKind};
    use std::path::Path;

    fn make_event(kind: EventKind, paths: Vec<PathBuf>) -> Event {
        Event {
            kind,
            paths,
            attrs: Default::default(),
        }
    }

    #[test]
    fn classify_config_modify() {
        let config = PathBuf::from("/home/user/.finwatch/config.json");
        let event = make_event(
            EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Content)),
            vec![config.clone()],
        );
        match classify_event(&event, &config) {
            Some(WatchEvent::ConfigChanged) => {}
            other => panic!("Expected ConfigChanged, got {:?}", other.is_some()),
        }
    }

    #[test]
    fn classify_csv_create() {
        let config = PathBuf::from("/home/user/.finwatch/config.json");
        let csv = PathBuf::from("/home/user/data/trades.csv");
        let event = make_event(EventKind::Create(CreateKind::File), vec![csv.clone()]);
        match classify_event(&event, &config) {
            Some(WatchEvent::SourceFileChanged { path }) => assert_eq!(path, csv),
            other => panic!("Expected SourceFileChanged, got {:?}", other.is_some()),
        }
    }

    #[test]
    fn classify_ignores_delete() {
        let config = PathBuf::from("/home/user/.finwatch/config.json");
        let event = make_event(
            EventKind::Remove(notify::event::RemoveKind::File),
            vec![config.clone()],
        );
        assert!(classify_event(&event, &config).is_none());
    }

    #[test]
    fn classify_ignores_unrelated_file() {
        let config = PathBuf::from("/home/user/.finwatch/config.json");
        let txt = PathBuf::from("/tmp/notes.txt");
        let event = make_event(
            EventKind::Modify(ModifyKind::Data(notify::event::DataChange::Content)),
            vec![txt],
        );
        assert!(classify_event(&event, &config).is_none());
    }

    #[test]
    fn create_watcher_compiles() {
        let (tx, _rx) = mpsc::channel();
        let config = PathBuf::from("/tmp/test-config.json");
        // Just verify it compiles and returns Ok
        let result = create_watcher(tx, config);
        assert!(result.is_ok());
    }
}
```

**Step 3: Run tests — verify they PASS**

```bash
cargo test --manifest-path src-tauri/Cargo.toml watcher::tests
```

Add `pub mod watcher;` to lib.rs.

**Step 4: Commit**

```bash
git add src-tauri/
git commit -m "feat: add file system watcher for config hot-reload"
```

---

## Final Verification

**Step 1: Run ALL Rust tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: ALL PASS (8 original + new tests from all tasks).

**Step 2: Verify compilation**

```bash
cargo check --manifest-path src-tauri/Cargo.toml --all-targets
```

Expected: exits 0. Trust the Rust compiler.

**Step 3: Run clippy**

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

Expected: no warnings.

**Step 4: Final commit if needed, then signal completion**

Write `COMPLETION.md` in worktree root:

```bash
cat > /Users/jdsingh/Projects/AI/finwatch-rust-backend/COMPLETION.md << 'EOF'
# Agent: rust-backend
## Status: complete

### Completed
- [x] 1A.1 SQLite connection pool (r2d2 + rusqlite)
- [x] 1A.2 Database migrations system
- [x] 1A.3 IPC command handlers (config CRUD)
- [x] 1A.4 IPC command handlers (anomalies, sources)
- [x] 1A.5 Event emission system
- [x] 1A.6 Sidecar process supervisor
- [x] 1A.7 JSON-RPC bridge types
- [x] 1A.8 File system watcher

### New Dependencies
- rusqlite 0.31 (bundled SQLite)
- r2d2 0.8 + r2d2_sqlite 0.24
- dirs 5
- notify 6
- tempfile 3 (dev only)

### Notes
- Memory search command remains a stub (real implementation in Phase 2)
- Sidecar actual spawn requires integration test with running Tauri app
- JSON-RPC bridge types are compatible with agent/src/ipc/json-rpc.ts
EOF
git add -A
git commit -m "docs: add completion summary"
```
