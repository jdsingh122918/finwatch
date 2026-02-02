use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderHealthStatus {
    Healthy,
    Degraded,
    Offline,
    RateLimited,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHealth {
    pub provider_id: String,
    pub status: ProviderHealthStatus,
    pub latency_ms: u64,
    pub last_success: Option<u64>,
    pub last_error: Option<String>,
    pub cooldown_until: Option<u64>,
}
