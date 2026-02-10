use crate::db::DbPool;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct AlpacaCredentials {
    pub key_id: String,
    pub secret_key: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AlpacaCredentialsMasked {
    pub key_id: String,
    pub has_secret: bool,
}

/// Store credentials for a given mode ("paper" or "live").
pub fn credentials_set_db(
    pool: &DbPool,
    mode: &str,
    creds: &AlpacaCredentials,
) -> Result<(), String> {
    validate_mode(mode)?;
    let json = serde_json::to_string(creds).map_err(|e| e.to_string())?;
    let key = credential_key(mode);
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO config (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = datetime('now')",
        [&key, &json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Retrieve credentials for a given mode. Returns None if not set.
pub fn credentials_get_db(
    pool: &DbPool,
    mode: &str,
) -> Result<Option<AlpacaCredentials>, String> {
    validate_mode(mode)?;
    let key = credential_key(mode);
    let conn = pool.get().map_err(|e| e.to_string())?;
    let result: Option<String> = match conn.query_row(
        "SELECT value FROM config WHERE key = ?1",
        [&key],
        |row| row.get(0),
    ) {
        Ok(json) => Some(json),
        Err(rusqlite::Error::QueryReturnedNoRows) => None,
        Err(e) => return Err(e.to_string()),
    };
    match result {
        Some(json) => {
            let creds: AlpacaCredentials =
                serde_json::from_str(&json).map_err(|e| e.to_string())?;
            Ok(Some(creds))
        }
        None => Ok(None),
    }
}

/// Check whether credentials exist for a given mode.
pub fn credentials_exists_db(pool: &DbPool, mode: &str) -> Result<bool, String> {
    validate_mode(mode)?;
    let key = credential_key(mode);
    let conn = pool.get().map_err(|e| e.to_string())?;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM config WHERE key = ?1",
            [&key],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count > 0)
}

fn credential_key(mode: &str) -> String {
    format!("alpaca_credentials_{}", mode)
}

fn validate_mode(mode: &str) -> Result<(), String> {
    match mode {
        "paper" | "live" => Ok(()),
        _ => Err(format!("Invalid trading mode: '{}'. Must be 'paper' or 'live'", mode)),
    }
}

/// Get credentials, trying keychain first, then falling back to DB.
pub fn credentials_get_any(pool: &DbPool, mode: &str) -> Result<Option<AlpacaCredentials>, String> {
    // Try keychain first
    match crate::keychain::keychain_get(mode) {
        Ok(Some(creds)) => return Ok(Some(creds)),
        Ok(None) => {}
        Err(e) => {
            tracing::warn!(error = %e, mode, "Keychain read failed, falling back to DB");
        }
    }
    // Fall back to DB
    credentials_get_db(pool, mode)
}

// --- Tauri command wrappers ---

#[tauri::command]
pub fn credentials_set(
    pool: tauri::State<'_, DbPool>,
    mode: String,
    key_id: String,
    secret_key: String,
) -> Result<(), String> {
    let creds = AlpacaCredentials { key_id, secret_key };
    // Store in keychain primarily, DB as fallback
    match crate::keychain::keychain_set(&mode, &creds) {
        Ok(()) => Ok(()),
        Err(e) => {
            tracing::warn!(error = %e, "Keychain write failed, falling back to DB");
            credentials_set_db(&pool, &mode, &creds)
        }
    }
}

#[tauri::command]
pub fn credentials_get(
    pool: tauri::State<'_, DbPool>,
    mode: String,
) -> Result<Option<AlpacaCredentialsMasked>, String> {
    let creds = credentials_get_any(&pool, &mode)?;
    Ok(creds.map(|c| AlpacaCredentialsMasked {
        key_id: c.key_id,
        has_secret: !c.secret_key.is_empty(),
    }))
}

#[tauri::command]
pub fn credentials_exists(
    pool: tauri::State<'_, DbPool>,
    mode: String,
) -> Result<bool, String> {
    match crate::keychain::keychain_exists(&mode) {
        Ok(true) => return Ok(true),
        Ok(false) => {}
        Err(e) => {
            tracing::warn!(error = %e, "Keychain check failed, falling back to DB");
        }
    }
    credentials_exists_db(&pool, &mode)
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
    fn credentials_exists_returns_false_when_not_set() {
        let pool = test_pool();
        assert!(!credentials_exists_db(&pool, "paper").unwrap());
        assert!(!credentials_exists_db(&pool, "live").unwrap());
    }

    #[test]
    fn credentials_set_and_get() {
        let pool = test_pool();
        let creds = AlpacaCredentials {
            key_id: "PKTEST123".to_string(),
            secret_key: "secret456".to_string(),
        };
        credentials_set_db(&pool, "paper", &creds).unwrap();
        let result = credentials_get_db(&pool, "paper").unwrap();
        assert_eq!(result, Some(creds));
    }

    #[test]
    fn credentials_exists_returns_true_after_set() {
        let pool = test_pool();
        let creds = AlpacaCredentials {
            key_id: "KEY".to_string(),
            secret_key: "SECRET".to_string(),
        };
        credentials_set_db(&pool, "live", &creds).unwrap();
        assert!(credentials_exists_db(&pool, "live").unwrap());
    }

    #[test]
    fn paper_and_live_stored_separately() {
        let pool = test_pool();
        let paper = AlpacaCredentials {
            key_id: "PAPER_KEY".to_string(),
            secret_key: "PAPER_SECRET".to_string(),
        };
        let live = AlpacaCredentials {
            key_id: "LIVE_KEY".to_string(),
            secret_key: "LIVE_SECRET".to_string(),
        };
        credentials_set_db(&pool, "paper", &paper).unwrap();
        credentials_set_db(&pool, "live", &live).unwrap();

        let got_paper = credentials_get_db(&pool, "paper").unwrap().unwrap();
        let got_live = credentials_get_db(&pool, "live").unwrap().unwrap();
        assert_eq!(got_paper.key_id, "PAPER_KEY");
        assert_eq!(got_live.key_id, "LIVE_KEY");
    }

    #[test]
    fn credentials_set_overwrites_existing() {
        let pool = test_pool();
        let old = AlpacaCredentials {
            key_id: "OLD".to_string(),
            secret_key: "OLD_SECRET".to_string(),
        };
        credentials_set_db(&pool, "paper", &old).unwrap();

        let new = AlpacaCredentials {
            key_id: "NEW".to_string(),
            secret_key: "NEW_SECRET".to_string(),
        };
        credentials_set_db(&pool, "paper", &new).unwrap();

        let result = credentials_get_db(&pool, "paper").unwrap().unwrap();
        assert_eq!(result.key_id, "NEW");
        assert_eq!(result.secret_key, "NEW_SECRET");
    }

    #[test]
    fn credentials_get_returns_none_when_not_set() {
        let pool = test_pool();
        let result = credentials_get_db(&pool, "paper").unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn credentials_get_db_returns_full_credentials() {
        let pool = test_pool();
        let creds = AlpacaCredentials {
            key_id: "PKFULL123".to_string(),
            secret_key: "full_secret_456".to_string(),
        };
        credentials_set_db(&pool, "paper", &creds).unwrap();
        let result = credentials_get_db(&pool, "paper").unwrap().unwrap();
        assert_eq!(result.key_id, "PKFULL123");
        assert_eq!(result.secret_key, "full_secret_456");
    }

    #[test]
    fn invalid_mode_rejected() {
        let pool = test_pool();
        let creds = AlpacaCredentials {
            key_id: "KEY".to_string(),
            secret_key: "SECRET".to_string(),
        };
        assert!(credentials_set_db(&pool, "invalid", &creds).is_err());
        assert!(credentials_get_db(&pool, "invalid").is_err());
        assert!(credentials_exists_db(&pool, "invalid").is_err());
    }
}
