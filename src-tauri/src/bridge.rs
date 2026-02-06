use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use serde_json::Value;
use tauri::{AppHandle, Runtime};

use crate::events::{emit_event, event_names};
use crate::jsonrpc::{JsonRpcRequest, JsonRpcResponse};
use crate::sidecar::{SidecarState, SidecarSupervisor};

/// Manages the Node.js agent sidecar process and JSON-RPC communication.
pub struct SidecarBridge {
    supervisor: SidecarSupervisor,
    child: Arc<Mutex<Option<Child>>>,
    stdin_writer: Arc<Mutex<Option<std::process::ChildStdin>>>,
}

impl SidecarBridge {
    pub fn new() -> Self {
        Self {
            supervisor: SidecarSupervisor::new(3),
            child: Arc::new(Mutex::new(None)),
            stdin_writer: Arc::new(Mutex::new(None)),
        }
    }

    pub fn is_running(&self) -> bool {
        self.supervisor.state() == SidecarState::Running
    }

    /// Spawn the Node.js agent sidecar and start reading its stdout.
    pub fn spawn<R: Runtime + 'static>(
        &self,
        app: AppHandle<R>,
        agent_script: &str,
    ) -> Result<(), String> {
        if self.is_running() {
            return Err("Sidecar already running".to_string());
        }

        self.supervisor.set_state(SidecarState::Starting);

        let manifest_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let project_root = manifest_dir.parent().unwrap_or(manifest_dir);

        let tsx_bin = project_root.join("node_modules/.bin/tsx");

        let mut child = Command::new(tsx_bin)
            .current_dir(project_root)
            .arg(agent_script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn agent: {}", e))?;

        let stdin = child.stdin.take().ok_or("Failed to get stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to get stdout")?;
        let stderr = child.stderr.take().ok_or("Failed to get stderr")?;

        *self.stdin_writer.lock().unwrap() = Some(stdin);
        *self.child.lock().unwrap() = Some(child);

        // Spawn stderr reader thread to capture agent logs
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                match line {
                    Ok(text) => eprintln!("[agent-stderr] {}", text),
                    Err(_) => break,
                }
            }
        });

        self.supervisor.record_started();

        // Spawn stdout reader thread
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            eprintln!("[bridge] Stdout reader thread started");
            for line in reader.lines() {
                match line {
                    Ok(text) => {
                        let text = text.trim().to_string();
                        if text.is_empty() {
                            continue;
                        }
                        eprintln!("[bridge] Raw stdout: {}", &text[..text.len().min(200)]);
                        // Try to parse as JSON
                        if let Ok(parsed) = serde_json::from_str::<Value>(&text) {
                            // Notifications have no "id" field
                            if parsed.get("id").is_none() {
                                if let Some(method) = parsed.get("method").and_then(|m| m.as_str())
                                {
                                    eprintln!("[bridge] Routing notification: {}", method);
                                    let params = parsed.get("params").cloned();
                                    route_notification(&app, method, params);
                                }
                            } else {
                                eprintln!("[bridge] Response (id={}): ignoring", parsed.get("id").unwrap());
                            }
                        } else {
                            eprintln!("[bridge] Non-JSON stdout: {}", &text[..text.len().min(100)]);
                        }
                    }
                    Err(e) => {
                        eprintln!("[bridge] Stdout read error: {}", e);
                        break;
                    }
                }
            }
            eprintln!("[bridge] Stdout reader thread exiting");
        });

        Ok(())
    }

    /// Send a JSON-RPC request to the agent and return the raw response line.
    pub fn send_request(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<JsonRpcResponse, String> {
        if !self.is_running() {
            return Err("Sidecar not running".to_string());
        }

        let request = JsonRpcRequest::new(method, params);
        let line = request.to_line().map_err(|e| e.to_string())?;

        let mut guard = self.stdin_writer.lock().unwrap();
        if let Some(ref mut stdin) = *guard {
            stdin
                .write_all(line.as_bytes())
                .map_err(|e| format!("Failed to write to stdin: {}", e))?;
            stdin
                .flush()
                .map_err(|e| format!("Failed to flush stdin: {}", e))?;
        } else {
            return Err("Stdin not available".to_string());
        }

        // For now, return a synthetic success response
        // Real implementation would wait for the response with matching id
        Ok(JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id: request.id,
            result: Some(serde_json::json!({"status": "sent"})),
            error: None,
        })
    }

    /// Kill the sidecar process.
    pub fn kill(&self) -> Result<(), String> {
        let mut guard = self.child.lock().unwrap();
        if let Some(ref mut child) = *guard {
            child.kill().map_err(|e| format!("Failed to kill: {}", e))?;
            child
                .wait()
                .map_err(|e| format!("Failed to wait: {}", e))?;
        }
        *guard = None;
        *self.stdin_writer.lock().unwrap() = None;
        self.supervisor.record_stopped();
        Ok(())
    }
}

/// Route a JSON-RPC notification to the appropriate Tauri event.
fn route_notification<R: Runtime>(app: &AppHandle<R>, method: &str, params: Option<Value>) {
    let payload = params.unwrap_or(Value::Null);
    let event = match method {
        "data:tick" => event_names::DATA_TICK,
        "anomaly:detected" => event_names::ANOMALY_DETECTED,
        "agent:activity" => event_names::AGENT_ACTIVITY,
        "source:health-change" => event_names::SOURCE_HEALTH_CHANGE,
        "memory:updated" => event_names::MEMORY_UPDATED,
        "backtest:progress" => event_names::BACKTEST_PROGRESS,
        "backtest:complete" => event_names::BACKTEST_COMPLETE,
        _ => {
            eprintln!("[bridge] Unknown notification method: {}", method);
            return;
        }
    };
    match emit_event(app, event, payload) {
        Ok(()) => eprintln!("[bridge] Emitted Tauri event: {}", event),
        Err(e) => eprintln!("[bridge] Failed to emit Tauri event {}: {}", event, e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_starts_in_idle_state() {
        let bridge = SidecarBridge::new();
        assert!(!bridge.is_running());
    }

    #[test]
    fn send_request_fails_when_not_running() {
        let bridge = SidecarBridge::new();
        let result = bridge.send_request("agent:status", None);
        assert!(result.is_err());
        assert_eq!(result.unwrap_err(), "Sidecar not running");
    }

    #[test]
    fn kill_on_idle_bridge_succeeds() {
        let bridge = SidecarBridge::new();
        let result = bridge.kill();
        assert!(result.is_ok());
    }
}
