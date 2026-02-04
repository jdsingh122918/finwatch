use crate::bridge::SidecarBridge;
use crate::db::DbPool;
use crate::types::agent::{AgentState, AgentStatus};

#[tauri::command]
pub async fn agent_start(
    app: tauri::AppHandle,
    pool: tauri::State<'_, DbPool>,
    bridge: tauri::State<'_, SidecarBridge>,
    config: serde_json::Value,
) -> Result<serde_json::Value, String> {
    // Get credentials from DB
    let creds = crate::commands::credentials::credentials_get_db(&pool, "paper")?;
    let creds = creds.ok_or("Alpaca credentials not set. Go to Settings to configure.")?;

    // Get LLM keys from config
    let app_config = crate::commands::config::config_get_db(&pool)?;
    let app_config: serde_json::Value =
        serde_json::from_str(&app_config).unwrap_or(serde_json::json!({}));

    // Build agent:start params merging stored config with provided overrides
    let symbols = config
        .get("symbols")
        .and_then(|s| s.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| vec!["AAPL".to_string()]);

    let feed = config
        .get("feed")
        .and_then(|f| f.as_str())
        .unwrap_or("iex");

    let anthropic_key = app_config
        .get("anthropicApiKey")
        .and_then(|k| k.as_str())
        .unwrap_or("");

    let openrouter_key = app_config
        .get("openrouterApiKey")
        .and_then(|k| k.as_str())
        .unwrap_or("");

    let model = app_config
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("claude-3-5-haiku-20241022");

    let agent_params = serde_json::json!({
        "alpaca": {
            "keyId": creds.key_id,
            "secretKey": creds.secret_key,
            "symbols": symbols,
            "feed": feed,
        },
        "llm": {
            "anthropicApiKey": anthropic_key,
            "openrouterApiKey": openrouter_key,
            "model": model,
            "maxTokens": 4096,
            "temperature": 0.3,
        },
    });

    // Spawn sidecar if not running
    if !bridge.is_running() {
        bridge.spawn(app, "agent/src/index.ts")?;
    }

    // Send agent:start command
    let response = bridge.send_request("agent:start", Some(agent_params))?;
    Ok(response.result.unwrap_or(serde_json::json!({"status": "started"})))
}

#[tauri::command]
pub async fn agent_stop(
    bridge: tauri::State<'_, SidecarBridge>,
) -> Result<serde_json::Value, String> {
    if bridge.is_running() {
        let _ = bridge.send_request("agent:stop", None);
        bridge.kill()?;
    }
    Ok(serde_json::json!({"status": "stopped"}))
}

#[tauri::command]
pub fn agent_status(
    bridge: tauri::State<'_, SidecarBridge>,
) -> AgentStatus {
    if bridge.is_running() {
        // In a full implementation, we'd query the agent via JSON-RPC
        // For now return running status when bridge is active
        AgentStatus {
            state: AgentState::Running,
            current_session_id: None,
            current_cycle_id: None,
            total_cycles: 0,
            total_anomalies: 0,
            uptime: 0,
            last_error: None,
        }
    } else {
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
}
