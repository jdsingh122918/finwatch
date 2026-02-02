use crate::types::agent::{AgentState, AgentStatus};

#[tauri::command]
pub fn agent_start() {
    // Stub: will be implemented by sidecar bridge
}

#[tauri::command]
pub fn agent_stop() {
    // Stub: will be implemented by sidecar bridge
}

#[tauri::command]
pub fn agent_status() -> AgentStatus {
    AgentStatus {
        state: AgentState::Idle,
        current_session_id: None,
        current_cycle_id: None,
        total_cycles: 0,
        total_anomalies: 0,
        uptime: 0,
        last_error: None,
    }
}
