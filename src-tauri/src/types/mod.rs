pub mod data;
pub mod anomaly;
pub mod memory;
pub mod agent;
pub mod provider;
pub mod config;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    #[test]
    fn data_tick_roundtrip() {
        let json = r#"{
            "sourceId": "yahoo-finance",
            "timestamp": 1706800000,
            "symbol": "AAPL",
            "metrics": {"price": 150.25, "volume": 1200000.0},
            "metadata": {}
        }"#;
        let tick: data::DataTick = serde_json::from_str(json).unwrap();
        assert_eq!(tick.source_id, "yahoo-finance");
        assert_eq!(tick.symbol, Some("AAPL".to_string()));
        let re_json = serde_json::to_string(&tick).unwrap();
        let tick2: data::DataTick = serde_json::from_str(&re_json).unwrap();
        assert_eq!(tick.source_id, tick2.source_id);
    }

    #[test]
    fn source_health_roundtrip() {
        let json = r#"{
            "sourceId": "yahoo",
            "status": "healthy",
            "lastSuccess": 1706800000,
            "failCount": 0,
            "latencyMs": 50
        }"#;
        let health: data::SourceHealth = serde_json::from_str(json).unwrap();
        assert_eq!(health.status, data::SourceHealthStatus::Healthy);
        let re_json = serde_json::to_string(&health).unwrap();
        assert!(re_json.contains("\"healthy\""));
    }

    #[test]
    fn anomaly_roundtrip() {
        let json = r#"{
            "id": "anom-001",
            "severity": "high",
            "source": "yahoo-finance",
            "timestamp": 1706800000,
            "description": "Volume spike detected",
            "metrics": {"volume": 5000000.0},
            "preScreenScore": 0.85,
            "sessionId": "cycle-001"
        }"#;
        let anomaly: anomaly::Anomaly = serde_json::from_str(json).unwrap();
        assert_eq!(anomaly.severity, anomaly::Severity::High);
        let re_json = serde_json::to_string(&anomaly).unwrap();
        let anomaly2: anomaly::Anomaly = serde_json::from_str(&re_json).unwrap();
        assert_eq!(anomaly.id, anomaly2.id);
    }

    #[test]
    fn anomaly_feedback_roundtrip() {
        let json = r#"{
            "anomalyId": "anom-001",
            "verdict": "confirmed",
            "timestamp": 1706800000
        }"#;
        let fb: anomaly::AnomalyFeedback = serde_json::from_str(json).unwrap();
        assert_eq!(fb.verdict, anomaly::FeedbackVerdict::Confirmed);
    }

    #[test]
    fn agent_status_roundtrip() {
        let json = r#"{
            "state": "running",
            "currentSessionId": "cycle-001",
            "totalCycles": 42,
            "totalAnomalies": 7,
            "uptime": 3600
        }"#;
        let status: agent::AgentStatus = serde_json::from_str(json).unwrap();
        assert_eq!(status.state, agent::AgentState::Running);
        assert_eq!(status.total_cycles, 42);
    }

    #[test]
    fn provider_health_roundtrip() {
        let json = r#"{
            "providerId": "anthropic",
            "status": "rate_limited",
            "latencyMs": 200,
            "lastError": "429 Too Many Requests"
        }"#;
        let health: provider::ProviderHealth = serde_json::from_str(json).unwrap();
        assert_eq!(health.status, provider::ProviderHealthStatus::RateLimited);
    }
}
