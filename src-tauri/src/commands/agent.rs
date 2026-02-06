use crate::bridge::SidecarBridge;
use crate::db::DbPool;
use crate::types::agent::{AgentState, AgentStatus};

/// Read a value from app config JSON, falling back to an environment variable.
pub(crate) fn config_or_env(app_config: &serde_json::Value, config_key: &str, env_var: &str) -> String {
    app_config
        .get(config_key)
        .and_then(|k| k.as_str())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| std::env::var(env_var).unwrap_or_default())
}

#[tauri::command]
pub async fn agent_start(
    app: tauri::AppHandle,
    pool: tauri::State<'_, DbPool>,
    bridge: tauri::State<'_, SidecarBridge>,
    config: serde_json::Value,
) -> Result<serde_json::Value, String> {
    // Get Alpaca credentials: DB first, then env vars
    let creds = crate::commands::credentials::credentials_get_db(&pool, "paper")?;
    let (alpaca_key, alpaca_secret) = match creds {
        Some(c) => (c.key_id, c.secret_key),
        None => {
            let key = std::env::var("ALPACA_KEY_ID")
                .map_err(|_| "Alpaca credentials not set. Configure in Settings or set ALPACA_KEY_ID/ALPACA_SECRET_KEY env vars.")?;
            let secret = std::env::var("ALPACA_SECRET_KEY")
                .map_err(|_| "ALPACA_SECRET_KEY env var not set.")?;
            (key, secret)
        }
    };

    // Get LLM keys from config DB, falling back to env vars
    let app_config = crate::commands::config::config_get_db(&pool)?;
    let app_config: serde_json::Value =
        serde_json::from_str(&app_config).unwrap_or(serde_json::json!({}));

    let anthropic_key = config_or_env(&app_config, "anthropicApiKey", "ANTHROPIC_API_KEY");
    let openrouter_key = config_or_env(&app_config, "openrouterApiKey", "OPENROUTER_API_KEY");

    let model = app_config
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("claude-3-5-haiku-20241022");

    // Build agent:start params merging stored config with provided overrides
    let symbols = config
        .get("symbols")
        .and_then(|s| s.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| vec!["NET".to_string()]);

    let feed = config
        .get("feed")
        .and_then(|f| f.as_str())
        .unwrap_or("iex");

    let agent_params = serde_json::json!({
        "alpaca": {
            "keyId": alpaca_key,
            "secretKey": alpaca_secret,
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

    eprintln!("[agent_start] Symbols: {:?}, Feed: {}", symbols, feed);

    // Spawn sidecar if not running
    if !bridge.is_running() {
        eprintln!("[agent_start] Spawning sidecar");
        bridge.spawn(app, "agent/src/index.ts")?;
        eprintln!("[agent_start] Sidecar spawned");
    } else {
        eprintln!("[agent_start] Sidecar already running");
    }

    // Send agent:start command
    eprintln!("[agent_start] Sending agent:start JSON-RPC request");
    let response = bridge.send_request("agent:start", Some(agent_params))?;
    eprintln!("[agent_start] Got response: {:?}", response.result);
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
