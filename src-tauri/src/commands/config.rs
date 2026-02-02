#[tauri::command]
pub fn config_get() -> String {
    // Stub: returns empty config JSON
    "{}".to_string()
}

#[tauri::command]
pub fn config_update(patch: String) -> String {
    // Stub: echo back the patch
    patch
}
