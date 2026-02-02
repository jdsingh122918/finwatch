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
    use super::*;

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
