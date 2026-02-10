pub mod bridge;
pub mod bridge_pending;
pub mod commands;
pub mod indicators;
pub mod keychain;
pub mod db;
pub mod events;
pub mod jsonrpc;
pub mod migrations;
pub mod sidecar;
pub mod types;
pub mod watcher;

use tracing_subscriber::EnvFilter;

/// Initialize structured logging with tracing.
/// Respects RUST_LOG env var; defaults to `info` level for finwatch crate.
pub fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("finwatch=info"));

    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .with_thread_ids(false)
        .with_file(false)
        .with_line_number(false)
        .init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    // Load .env from project root (parent of src-tauri/)
    let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let project_root = manifest_dir.parent().unwrap_or(manifest_dir);
    let env_path = project_root.join(".env");
    dotenvy::from_path(&env_path).ok();
    let data_dir = db::finwatch_data_dir();
    let db_path = data_dir.join("state").join("finwatch.sqlite");
    let pool = db::create_pool(&db_path).expect("Failed to create database pool");
    db::init_db(&pool).expect("Failed to initialize database");
    migrations::run_pending(&pool).expect("Failed to run migrations");

    // Migrate credentials from DB to OS keychain (idempotent, best-effort)
    keychain::migrate_db_to_keychain(&pool, "paper").ok();
    keychain::migrate_db_to_keychain(&pool, "live").ok();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .manage(pool)
        .manage(bridge::SidecarBridge::new())
        .invoke_handler(tauri::generate_handler![
            commands::assets::assets_fetch,
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
            commands::backtest::backtest_cancel,
            commands::backtest::backtest_update_status,
            indicators::indicators_compute,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
