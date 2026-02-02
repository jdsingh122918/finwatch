pub mod agent;
pub mod config;
pub mod anomalies;
pub mod memory;
pub mod sources;

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

    #[test]
    fn agent_status_returns_valid_json() {
        let status = agent::agent_status();
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains("\"state\""));
    }
}
