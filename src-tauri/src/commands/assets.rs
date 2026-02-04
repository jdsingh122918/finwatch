use crate::db::DbPool;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Asset {
    pub symbol: String,
    pub name: String,
    pub exchange: String,
    pub asset_class: String,
    pub status: String,
}

/// Insert or replace a batch of assets into the cache.
pub fn assets_cache_set(pool: &DbPool, assets: &[Asset]) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM assets", []).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "INSERT INTO assets (symbol, name, exchange, asset_class, status, fetched_at)
             VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))",
        )
        .map_err(|e| e.to_string())?;
    for asset in assets {
        stmt.execute(rusqlite::params![
            asset.symbol,
            asset.name,
            asset.exchange,
            asset.asset_class,
            asset.status,
        ])
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Get all cached assets. Returns empty vec if cache is empty.
pub fn assets_cache_get(pool: &DbPool) -> Result<Vec<Asset>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT symbol, name, exchange, asset_class, status FROM assets ORDER BY symbol")
        .map_err(|e| e.to_string())?;
    let assets = stmt
        .query_map([], |row| {
            Ok(Asset {
                symbol: row.get(0)?,
                name: row.get(1)?,
                exchange: row.get(2)?,
                asset_class: row.get(3)?,
                status: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(assets)
}

const ASSETS_TTL_SECS: i64 = 86400; // 24 hours

#[tauri::command]
pub async fn assets_fetch(
    pool: tauri::State<'_, DbPool>,
) -> Result<Vec<Asset>, String> {
    // Return cache if fresh
    if !assets_cache_is_stale(&pool, ASSETS_TTL_SECS)? {
        return assets_cache_get(&pool);
    }

    // Get Alpaca credentials
    let creds = crate::commands::credentials::credentials_get_db(&pool, "paper")?;
    let (key_id, secret_key) = match creds {
        Some(c) => (c.key_id, c.secret_key),
        None => {
            let key = std::env::var("ALPACA_KEY_ID")
                .map_err(|_| "Alpaca credentials not configured. Set them in Settings.".to_string())?;
            let secret = std::env::var("ALPACA_SECRET_KEY")
                .map_err(|_| "ALPACA_SECRET_KEY not set.".to_string())?;
            (key, secret)
        }
    };

    // Fetch from Alpaca API
    let client = reqwest::Client::new();
    let response = client
        .get("https://paper-api.alpaca.markets/v2/assets")
        .query(&[("status", "active")])
        .header("APCA-API-KEY-ID", &key_id)
        .header("APCA-API-SECRET-KEY", &secret_key)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch assets: {}", e))?;

    if !response.status().is_success() {
        // Try returning stale cache on API error
        let cached = assets_cache_get(&pool)?;
        if !cached.is_empty() {
            return Ok(cached);
        }
        return Err(format!("Alpaca API error: {}", response.status()));
    }

    #[derive(Deserialize)]
    struct AlpacaAsset {
        symbol: String,
        name: String,
        exchange: String,
        class: String,
        status: String,
        tradable: bool,
    }

    let alpaca_assets: Vec<AlpacaAsset> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse assets: {}", e))?;

    let assets: Vec<Asset> = alpaca_assets
        .into_iter()
        .filter(|a| a.tradable)
        .map(|a| Asset {
            symbol: a.symbol,
            name: a.name,
            exchange: a.exchange,
            asset_class: a.class,
            status: a.status,
        })
        .collect();

    assets_cache_set(&pool, &assets)?;
    Ok(assets)
}

/// Check whether the cache is stale (older than `max_age_secs`).
pub fn assets_cache_is_stale(pool: &DbPool, max_age_secs: i64) -> Result<bool, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM assets WHERE fetched_at > datetime('now', ?1)",
            [format!("-{} seconds", max_age_secs)],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count == 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn test_pool() -> DbPool {
        let dir = tempfile::tempdir().unwrap();
        let pool = db::create_pool(&dir.path().join("test.sqlite")).unwrap();
        db::init_db(&pool).unwrap();
        crate::migrations::run_pending(&pool).unwrap();
        pool
    }

    #[test]
    fn cache_get_returns_empty_when_no_data() {
        let pool = test_pool();
        let result = assets_cache_get(&pool).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn cache_set_and_get_roundtrip() {
        let pool = test_pool();
        let assets = vec![
            Asset {
                symbol: "AAPL".to_string(),
                name: "Apple Inc.".to_string(),
                exchange: "NASDAQ".to_string(),
                asset_class: "us_equity".to_string(),
                status: "active".to_string(),
            },
            Asset {
                symbol: "BTC/USD".to_string(),
                name: "Bitcoin".to_string(),
                exchange: "CRYPTO".to_string(),
                asset_class: "crypto".to_string(),
                status: "active".to_string(),
            },
        ];
        assets_cache_set(&pool, &assets).unwrap();
        let result = assets_cache_get(&pool).unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result[0].symbol, "AAPL");
    }

    #[test]
    fn cache_set_replaces_existing() {
        let pool = test_pool();
        let v1 = vec![Asset {
            symbol: "AAPL".to_string(),
            name: "Apple".to_string(),
            exchange: "NASDAQ".to_string(),
            asset_class: "us_equity".to_string(),
            status: "active".to_string(),
        }];
        assets_cache_set(&pool, &v1).unwrap();

        let v2 = vec![Asset {
            symbol: "AAPL".to_string(),
            name: "Apple Inc.".to_string(),
            exchange: "NASDAQ".to_string(),
            asset_class: "us_equity".to_string(),
            status: "active".to_string(),
        }];
        assets_cache_set(&pool, &v2).unwrap();

        let result = assets_cache_get(&pool).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].name, "Apple Inc.");
    }

    #[test]
    fn cache_is_stale_when_empty() {
        let pool = test_pool();
        assert!(assets_cache_is_stale(&pool, 86400).unwrap());
    }

    #[test]
    fn cache_is_not_stale_after_insert() {
        let pool = test_pool();
        let assets = vec![Asset {
            symbol: "AAPL".to_string(),
            name: "Apple".to_string(),
            exchange: "NASDAQ".to_string(),
            asset_class: "us_equity".to_string(),
            status: "active".to_string(),
        }];
        assets_cache_set(&pool, &assets).unwrap();
        // Just inserted, should not be stale with 24h TTL
        assert!(!assets_cache_is_stale(&pool, 86400).unwrap());
    }
}
