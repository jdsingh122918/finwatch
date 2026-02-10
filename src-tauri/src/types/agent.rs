use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentState {
    Idle,
    Running,
    Paused,
    Error,
    Unhealthy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    pub state: AgentState,
    pub current_session_id: Option<String>,
    pub current_cycle_id: Option<String>,
    pub total_cycles: u64,
    pub total_anomalies: u64,
    pub uptime: u64,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentActivityType {
    CycleStart,
    CycleEnd,
    AnomalyDetected,
    MemoryFlush,
    Compaction,
    SubagentSpawn,
    FeedbackProcessed,
    RuleEvolved,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentActivity {
    #[serde(rename = "type")]
    pub activity_type: AgentActivityType,
    pub message: String,
    pub timestamp: u64,
    pub data: Option<std::collections::HashMap<String, serde_json::Value>>,
}
