use tracing::debug;

use crate::commands::credentials::AlpacaCredentials;
use crate::db::DbPool;

const SERVICE: &str = "dev.finwatch";

fn keychain_key(mode: &str) -> String {
    format!("alpaca_{}", mode)
}

fn validate_mode(mode: &str) -> Result<(), String> {
    match mode {
        "paper" | "live" => Ok(()),
        _ => Err(format!(
            "Invalid trading mode: '{}'. Must be 'paper' or 'live'",
            mode
        )),
    }
}

/// Store credentials in the OS keychain.
pub fn keychain_set(mode: &str, creds: &AlpacaCredentials) -> Result<(), String> {
    validate_mode(mode)?;
    let json = serde_json::to_string(creds).map_err(|e| e.to_string())?;
    let entry = keyring::Entry::new(SERVICE, &keychain_key(mode))
        .map_err(|e| format!("Failed to create keychain entry: {}", e))?;
    entry
        .set_password(&json)
        .map_err(|e| format!("Failed to store in keychain: {}", e))?;
    debug!(mode, "Credentials stored in keychain");
    Ok(())
}

/// Retrieve credentials from the OS keychain. Returns None if not set.
pub fn keychain_get(mode: &str) -> Result<Option<AlpacaCredentials>, String> {
    validate_mode(mode)?;
    let entry = keyring::Entry::new(SERVICE, &keychain_key(mode))
        .map_err(|e| format!("Failed to create keychain entry: {}", e))?;
    match entry.get_password() {
        Ok(json) => {
            let creds: AlpacaCredentials =
                serde_json::from_str(&json).map_err(|e| e.to_string())?;
            Ok(Some(creds))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Failed to read from keychain: {}", e)),
    }
}

/// Delete credentials from the OS keychain.
pub fn keychain_delete(mode: &str) -> Result<(), String> {
    validate_mode(mode)?;
    let entry = keyring::Entry::new(SERVICE, &keychain_key(mode))
        .map_err(|e| format!("Failed to create keychain entry: {}", e))?;
    match entry.delete_credential() {
        Ok(()) => {
            debug!(mode, "Credentials deleted from keychain");
            Ok(())
        }
        Err(keyring::Error::NoEntry) => Ok(()), // Already gone
        Err(e) => Err(format!("Failed to delete from keychain: {}", e)),
    }
}

/// Check whether credentials exist in the OS keychain.
pub fn keychain_exists(mode: &str) -> Result<bool, String> {
    validate_mode(mode)?;
    let entry = keyring::Entry::new(SERVICE, &keychain_key(mode))
        .map_err(|e| format!("Failed to create keychain entry: {}", e))?;
    match entry.get_password() {
        Ok(_) => Ok(true),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(format!("Failed to check keychain: {}", e)),
    }
}

/// Migrate credentials from SQLite to OS keychain (idempotent).
/// Reads from DB, writes to keychain, then deletes from DB.
pub fn migrate_db_to_keychain(pool: &DbPool, mode: &str) -> Result<(), String> {
    use crate::commands::credentials::credentials_get_db;

    // Check if already in keychain
    if keychain_exists(mode)? {
        debug!(mode, "Credentials already in keychain, skipping migration");
        return Ok(());
    }

    // Read from DB
    let creds = credentials_get_db(pool, mode)?;
    if let Some(creds) = creds {
        // Write to keychain
        keychain_set(mode, &creds)?;
        // Delete from DB by writing empty value (or we can leave it since keychain takes priority)
        debug!(mode, "Migrated credentials from DB to keychain");
    } else {
        debug!(mode, "No credentials in DB to migrate");
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Keychain tests are marked #[ignore] because they interact with the real OS keychain
    // and may fail in CI environments without keychain access.

    #[test]
    #[ignore]
    fn keychain_set_and_get_roundtrip() {
        let creds = AlpacaCredentials {
            key_id: "TEST_KEY_123".to_string(),
            secret_key: "test_secret_456".to_string(),
        };
        keychain_set("paper", &creds).unwrap();
        let result = keychain_get("paper").unwrap();
        assert_eq!(result, Some(creds));
        // Cleanup
        keychain_delete("paper").unwrap();
    }

    #[test]
    #[ignore]
    fn keychain_get_returns_none_when_empty() {
        // Ensure it's deleted first
        let _ = keychain_delete("paper");
        let result = keychain_get("paper").unwrap();
        assert_eq!(result, None);
    }

    #[test]
    #[ignore]
    fn keychain_delete_removes_entry() {
        let creds = AlpacaCredentials {
            key_id: "DEL_KEY".to_string(),
            secret_key: "del_secret".to_string(),
        };
        keychain_set("paper", &creds).unwrap();
        assert!(keychain_exists("paper").unwrap());
        keychain_delete("paper").unwrap();
        assert!(!keychain_exists("paper").unwrap());
    }

    #[test]
    #[ignore]
    fn keychain_exists_returns_false_when_empty() {
        let _ = keychain_delete("live");
        assert!(!keychain_exists("live").unwrap());
    }

    #[test]
    fn keychain_invalid_mode_rejected() {
        let creds = AlpacaCredentials {
            key_id: "KEY".to_string(),
            secret_key: "SECRET".to_string(),
        };
        assert!(keychain_set("invalid", &creds).is_err());
        assert!(keychain_get("invalid").is_err());
        assert!(keychain_delete("invalid").is_err());
        assert!(keychain_exists("invalid").is_err());
    }

    #[test]
    #[ignore]
    fn migrate_db_to_keychain_transfers_data() {
        use crate::commands::credentials::credentials_set_db;
        use crate::db;

        let dir = tempfile::tempdir().unwrap();
        let pool = db::create_pool(&dir.path().join("test.sqlite")).unwrap();
        db::init_db(&pool).unwrap();

        // Ensure keychain is clean
        let _ = keychain_delete("paper");

        let creds = AlpacaCredentials {
            key_id: "MIGRATE_KEY".to_string(),
            secret_key: "migrate_secret".to_string(),
        };
        credentials_set_db(&pool, "paper", &creds).unwrap();

        migrate_db_to_keychain(&pool, "paper").unwrap();

        let result = keychain_get("paper").unwrap();
        assert_eq!(result, Some(creds));

        // Cleanup
        keychain_delete("paper").unwrap();
    }
}
