pub mod bridge;
pub mod commands;
pub mod db;
pub mod events;
pub mod jsonrpc;
pub mod migrations;
pub mod sidecar;
pub mod types;
pub mod watcher;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let data_dir = db::finwatch_data_dir();
    let db_path = data_dir.join("state").join("finwatch.sqlite");
    let pool = db::create_pool(&db_path).expect("Failed to create database pool");
    db::init_db(&pool).expect("Failed to initialize database");
    migrations::run_pending(&pool).expect("Failed to run migrations");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .manage(pool)
        .manage(bridge::SidecarBridge::new())
        .invoke_handler(tauri::generate_handler![
            commands::agent::agent_start,
            commands::agent::agent_stop,
            commands::agent::agent_status,
            commands::config::config_get,
            commands::config::config_update,
            commands::anomalies::anomalies_list,
            commands::anomalies::anomalies_feedback,
            commands::memory::memory_search,
            commands::sources::sources_health,
            commands::credentials::credentials_set,
            commands::credentials::credentials_get,
            commands::credentials::credentials_exists,
            commands::backtest::backtest_start,
            commands::backtest::backtest_list,
            commands::backtest::backtest_get,
            commands::backtest::backtest_get_trades,
            commands::backtest::backtest_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
