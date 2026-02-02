use crate::types::anomaly::{Anomaly, AnomalyFeedback};

#[tauri::command]
pub fn anomalies_list() -> Vec<Anomaly> {
    Vec::new()
}

#[tauri::command]
pub fn anomalies_feedback(id: String, feedback: AnomalyFeedback) {
    let _ = (id, feedback);
    // Stub: will persist to SQLite
}
