use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

/// Event names as constants — matches shared/src/ipc.ts IpcEvents
pub mod event_names {
    pub const AGENT_ACTIVITY: &str = "agent:activity";
    pub const DATA_TICK: &str = "data:tick";
    pub const ANOMALY_DETECTED: &str = "anomaly:detected";
    pub const SOURCE_HEALTH_CHANGE: &str = "source:health-change";
    pub const MEMORY_UPDATED: &str = "memory:updated";
}

pub fn emit_event<R: Runtime, T: Serialize + Clone>(
    app: &AppHandle<R>,
    event: &str,
    payload: T,
) -> Result<(), String> {
    app.emit(event, payload).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::event_names::*;

    #[test]
    fn event_names_match_ipc_contract() {
        assert_eq!(AGENT_ACTIVITY, "agent:activity");
        assert_eq!(DATA_TICK, "data:tick");
        assert_eq!(ANOMALY_DETECTED, "anomaly:detected");
        assert_eq!(SOURCE_HEALTH_CHANGE, "source:health-change");
        assert_eq!(MEMORY_UPDATED, "memory:updated");
    }

    #[test]
    fn emit_event_compiles_with_typed_payloads() {
        // This test verifies the function signature compiles with our types.
        // Actual emission requires a running Tauri app, tested in integration.
        use crate::types::agent::{AgentActivity, AgentActivityType};
        let _activity = AgentActivity {
            activity_type: AgentActivityType::CycleStart,
            message: "test".to_string(),
            timestamp: 1000,
            data: None,
        };
        // If this compiles, the types are compatible with Serialize + Clone
        fn _assert_serialize_clone<T: serde::Serialize + Clone>(_: &T) {}
        _assert_serialize_clone(&_activity);
    }
}
