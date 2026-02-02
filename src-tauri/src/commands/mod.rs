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
            source: None,
            symbol: None,
            since: None,
            limit: None,
        };
        let list = anomalies::anomalies_list_db(&pool, &Some(filter)).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, "anom-high");
    }

    #[test]
    fn feedback_insert_and_query() {
        let pool = test_pool();
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
}
