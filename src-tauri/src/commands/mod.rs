pub mod agent;
pub mod config;
pub mod anomalies;
pub mod memory;
pub mod sources;

#[cfg(test)]
mod tests {
    use super::*;

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
        // Should be a valid JSON object (even if empty)
        assert!(json.starts_with('{'));
    }
}
