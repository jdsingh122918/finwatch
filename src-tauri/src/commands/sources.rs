use crate::types::data::SourceHealth;
use std::collections::HashMap;

#[tauri::command]
pub fn sources_health() -> HashMap<String, SourceHealth> {
    HashMap::new()
}
