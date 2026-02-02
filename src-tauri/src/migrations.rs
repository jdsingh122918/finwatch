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
