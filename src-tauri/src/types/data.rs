use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataTick {
    pub source_id: String,
    pub timestamp: u64,
    pub symbol: Option<String>,
    pub metrics: HashMap<String, f64>,
    pub metadata: HashMap<String, serde_json::Value>,
    pub raw: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceHealthStatus {
    Healthy,
    Degraded,
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceHealth {
    pub source_id: String,
    pub status: SourceHealthStatus,
    pub last_success: u64,
    pub last_failure: Option<u64>,
    pub fail_count: u32,
    pub latency_ms: u64,
    pub message: Option<String>,
}
