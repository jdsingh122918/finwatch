use crate::types::memory::SearchResult;

#[tauri::command]
pub fn memory_search(query: String) -> Vec<SearchResult> {
    let _ = query;
    Vec::new()
}
