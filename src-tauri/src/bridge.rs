use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::{AppHandle, Runtime};
use tracing::{debug, error, trace, warn};

use crate::bridge_pending::PendingRequestTracker;
use crate::events::{emit_event, event_names};
use crate::jsonrpc::{JsonRpcRequest, JsonRpcResponse};
use crate::sidecar::{SidecarState, SidecarSupervisor};

/// Default timeout for JSON-RPC requests (31 seconds).
const REQUEST_TIMEOUT: Duration = Duration::from_secs(31);
/// Interval for checking timed-out pending requests (5 seconds).
const TIMEOUT_CHECK_INTERVAL: Duration = Duration::from_secs(5);
/// Watchdog poll interval for checking child process status.
const WATCHDOG_POLL_INTERVAL: Duration = Duration::from_secs(10);
/// Health check ping interval.
const HEALTH_CHECK_INTERVAL: Duration = Duration::from_secs(30);
/// Maximum silence before considering the agent unhealthy (3 missed pongs).
const MAX_SILENCE: Duration = Duration::from_secs(90);

/// Spawn the child OS process for the agent sidecar.
/// Returns (child, stdin, stdout, stderr).
fn spawn_child_process(
    agent_script: &str,
) -> Result<
    (
        Child,
        std::process::ChildStdin,
        std::process::ChildStdout,
        std::process::ChildStderr,
    ),
    String,
> {
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

    Ok((child, stdin, stdout, stderr))
}

/// Spawn reader threads for agent stdout and stderr.
/// Returns nothing; threads run independently.
fn spawn_reader_threads<R: Runtime + 'static>(
    stdout: std::process::ChildStdout,
    stderr: std::process::ChildStderr,
    app: AppHandle<R>,
    pending: Arc<PendingRequestTracker>,
) {
    // Stderr reader
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(text) => debug!(target: "agent_stderr", "{}", text),
                Err(_) => break,
            }
        }
    });

    // Stdout reader
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        debug!("Stdout reader thread started");
        for line in reader.lines() {
            match line {
                Ok(text) => {
                    let text = text.trim().to_string();
                    if text.is_empty() {
                        continue;
                    }
                    trace!(raw = &text[..text.len().min(200)], "Agent stdout");
                    if let Ok(parsed) = serde_json::from_str::<Value>(&text) {
                        if let Some(id) = parsed.get("id").and_then(|v| v.as_u64()) {
                            match serde_json::from_value::<JsonRpcResponse>(parsed) {
                                Ok(response) => {
                                    if !pending.resolve(id, response) {
                                        warn!(id, "Received response for unknown request");
                                    }
                                }
                                Err(e) => {
                                    warn!(id, error = %e, "Failed to parse JSON-RPC response");
                                }
                            }
                        } else if let Some(method) =
                            parsed.get("method").and_then(|m| m.as_str())
                        {
                            debug!(method, "Routing notification");
                            let params = parsed.get("params").cloned();
                            route_notification(&app, method, params);
                        }
                    } else {
                        warn!(raw = &text[..text.len().min(100)], "Non-JSON stdout from agent");
                    }
                }
                Err(e) => {
                    error!(error = %e, "Stdout read error");
                    break;
                }
            }
        }
        debug!("Stdout reader thread exiting");
    });
}

/// Manages the Node.js agent sidecar process and JSON-RPC communication.
pub struct SidecarBridge {
    supervisor: SidecarSupervisor,
    child: Arc<Mutex<Option<Child>>>,
    stdin_writer: Arc<Mutex<Option<std::process::ChildStdin>>>,
    pending: Arc<PendingRequestTracker>,
    watchdog_shutdown: Mutex<Option<std::sync::mpsc::Sender<()>>>,
    last_pong: Arc<Mutex<Option<Instant>>>,
}

impl SidecarBridge {
    pub fn new() -> Self {
        Self {
            supervisor: SidecarSupervisor::new(3),
            child: Arc::new(Mutex::new(None)),
            stdin_writer: Arc::new(Mutex::new(None)),
            pending: Arc::new(PendingRequestTracker::new()),
            watchdog_shutdown: Mutex::new(None),
            last_pong: Arc::new(Mutex::new(None)),
        }
    }

    pub fn is_running(&self) -> bool {
        self.supervisor.state() == SidecarState::Running
    }

    /// Record a successful pong response.
    pub fn record_pong(&self) {
        *self.last_pong.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
    }

    /// Check if the agent has responded within the given silence window.
    pub fn is_healthy(&self, max_silence: Duration) -> bool {
        if !self.is_running() {
            return false;
        }
        match *self.last_pong.lock().unwrap_or_else(|e| e.into_inner()) {
            Some(last) => last.elapsed() < max_silence,
            None => true, // No pong yet; give it benefit of the doubt
        }
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

        let (child, stdin, stdout, stderr) = spawn_child_process(agent_script)?;

        *self
            .stdin_writer
            .lock()
            .map_err(|e| format!("Failed to acquire stdin lock: {}", e))? = Some(stdin);
        *self
            .child
            .lock()
            .map_err(|e| format!("Failed to acquire child lock: {}", e))? = Some(child);

        self.supervisor.record_started();

        spawn_reader_threads(stdout, stderr, app.clone(), Arc::clone(&self.pending));

        // Spawn timeout checker thread
        let pending_for_timeout = Arc::clone(&self.pending);
        let supervisor_for_timeout = self.supervisor.state_arc();
        thread::spawn(move || {
            debug!("Timeout checker thread started");
            loop {
                thread::sleep(TIMEOUT_CHECK_INTERVAL);
                let state = supervisor_for_timeout
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                if state != SidecarState::Running {
                    debug!("Timeout checker exiting (sidecar not running)");
                    break;
                }
                pending_for_timeout.check_timeouts();
            }
        });

        // Spawn watchdog thread
        let (shutdown_tx, shutdown_rx) = std::sync::mpsc::channel::<()>();
        *self
            .watchdog_shutdown
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = Some(shutdown_tx);

        let child_arc = Arc::clone(&self.child);
        let stdin_arc = Arc::clone(&self.stdin_writer);
        let pending_arc = Arc::clone(&self.pending);
        let supervisor_arc = self.supervisor.state_arc();
        let max_restarts = self.supervisor.max_restarts();
        let script = agent_script.to_string();

        thread::spawn(move || {
            debug!("Watchdog thread started");
            loop {
                // Check for shutdown signal (non-blocking)
                if shutdown_rx.try_recv().is_ok() {
                    debug!("Watchdog received shutdown signal");
                    break;
                }

                thread::sleep(WATCHDOG_POLL_INTERVAL);

                // Check if child has exited
                let exited = {
                    let mut guard = child_arc.lock().unwrap_or_else(|e| e.into_inner());
                    if let Some(ref mut child) = *guard {
                        match child.try_wait() {
                            Ok(Some(status)) => {
                                warn!(code = ?status.code(), "Sidecar process exited");
                                *guard = None;
                                true
                            }
                            Ok(None) => false, // Still running
                            Err(e) => {
                                error!(error = %e, "Failed to check child status");
                                false
                            }
                        }
                    } else {
                        // No child, but we may be in a restart cycle
                        false
                    }
                };

                if !exited {
                    continue;
                }

                // Child exited unexpectedly
                pending_arc.fail_all("Sidecar process crashed");
                *stdin_arc.lock().unwrap_or_else(|e| e.into_inner()) = None;

                // Use a temporary supervisor to compute backoff/should_restart
                let sup = SidecarSupervisor::from_arc(Arc::clone(&supervisor_arc), max_restarts);
                sup.record_crash();

                if !sup.should_restart() {
                    error!("Max restart attempts reached, watchdog exiting");
                    break;
                }

                let backoff = sup.backoff_duration();
                debug!(
                    restart_count = sup.restart_count(),
                    backoff_secs = backoff.as_secs(),
                    "Attempting restart after backoff"
                );
                thread::sleep(backoff);

                // Check shutdown again after backoff
                if shutdown_rx.try_recv().is_ok() {
                    debug!("Watchdog received shutdown signal during backoff");
                    break;
                }

                // Attempt respawn
                sup.set_state(SidecarState::Starting);
                match spawn_child_process(&script) {
                    Ok((new_child, new_stdin, new_stdout, new_stderr)) => {
                        *stdin_arc.lock().unwrap_or_else(|e| e.into_inner()) = Some(new_stdin);
                        *child_arc.lock().unwrap_or_else(|e| e.into_inner()) = Some(new_child);
                        sup.record_started();
                        spawn_reader_threads(
                            new_stdout,
                            new_stderr,
                            app.clone(),
                            Arc::clone(&pending_arc),
                        );
                        debug!("Sidecar restarted successfully");
                    }
                    Err(e) => {
                        error!(error = %e, "Failed to restart sidecar");
                        // Will retry on next loop iteration if under max restarts
                    }
                }
            }
            debug!("Watchdog thread exiting");
        });

        // Spawn health checker thread
        let pending_for_health = Arc::clone(&self.pending);
        let stdin_for_health = Arc::clone(&self.stdin_writer);
        let last_pong_for_health = Arc::clone(&self.last_pong);
        let supervisor_for_health = self.supervisor.state_arc();
        thread::spawn(move || {
            debug!("Health checker thread started");
            // Set initial pong timestamp so the agent has time to start
            *last_pong_for_health
                .lock()
                .unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
            loop {
                thread::sleep(HEALTH_CHECK_INTERVAL);
                let state = supervisor_for_health
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone();
                if state != SidecarState::Running {
                    debug!("Health checker exiting (sidecar not running)");
                    break;
                }

                // Send a ping request
                let ping_req = JsonRpcRequest::new("ping", None);
                let ping_id = ping_req.id;
                let rx = pending_for_health.register(ping_id, Duration::from_secs(10));

                let send_ok = {
                    let mut guard = stdin_for_health
                        .lock()
                        .unwrap_or_else(|e| e.into_inner());
                    if let Some(ref mut stdin) = *guard {
                        if let Ok(line) = ping_req.to_line() {
                            stdin.write_all(line.as_bytes()).is_ok()
                                && stdin.flush().is_ok()
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                };

                if send_ok {
                    match rx.recv_timeout(Duration::from_secs(10)) {
                        Ok(Ok(_)) => {
                            *last_pong_for_health
                                .lock()
                                .unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
                            trace!("Pong received");
                        }
                        Ok(Err(e)) => {
                            warn!(error = %e, "Ping returned error");
                        }
                        Err(_) => {
                            warn!("Ping timed out");
                        }
                    }
                }

                // Check if we've exceeded max silence
                let elapsed = last_pong_for_health
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .map(|t| t.elapsed())
                    .unwrap_or(Duration::ZERO);
                if elapsed > MAX_SILENCE {
                    error!(
                        silence_secs = elapsed.as_secs(),
                        "Agent unresponsive, marking unhealthy"
                    );
                    // Don't break -- let the watchdog handle crash detection
                }
            }
            debug!("Health checker thread exiting");
        });

        Ok(())
    }

    /// Send a JSON-RPC request to the agent and wait for the response.
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
        let id = request.id;

        // Register pending request before writing to avoid race conditions
        let rx = self.pending.register(id, REQUEST_TIMEOUT);

        // Write request to stdin
        {
            let mut guard = self
                .stdin_writer
                .lock()
                .map_err(|e| format!("Failed to acquire stdin lock: {}", e))?;
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
        } // Drop lock before waiting

        debug!(id, method = request.method, "Sent JSON-RPC request, waiting for response");

        // Wait for the response from the stdout reader thread
        rx.recv_timeout(REQUEST_TIMEOUT)
            .map_err(|e| format!("Request {} recv failed: {}", id, e))?
    }

    /// Send a JSON-RPC request without waiting for a response (fire-and-forget).
    pub fn send_notification(
        &self,
        method: &str,
        params: Option<Value>,
    ) -> Result<(), String> {
        if !self.is_running() {
            return Err("Sidecar not running".to_string());
        }

        let request = JsonRpcRequest::new(method, params);
        let line = request.to_line().map_err(|e| e.to_string())?;

        let mut guard = self
            .stdin_writer
            .lock()
            .map_err(|e| format!("Failed to acquire stdin lock: {}", e))?;
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

        debug!(method = request.method, "Sent JSON-RPC notification (fire-and-forget)");
        Ok(())
    }

    /// Kill the sidecar process.
    pub fn kill(&self) -> Result<(), String> {
        // Signal watchdog to stop before killing the child
        if let Some(tx) = self
            .watchdog_shutdown
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            let _ = tx.send(());
        }

        // Fail all pending requests before killing
        self.pending.fail_all("Sidecar process killed");

        let mut guard = self
            .child
            .lock()
            .map_err(|e| format!("Failed to acquire child lock: {}", e))?;
        if let Some(ref mut child) = *guard {
            child.kill().map_err(|e| format!("Failed to kill: {}", e))?;
            child
                .wait()
                .map_err(|e| format!("Failed to wait: {}", e))?;
        }
        *guard = None;
        *self
            .stdin_writer
            .lock()
            .map_err(|e| format!("Failed to acquire stdin lock: {}", e))? = None;
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
            warn!(method, "Unknown notification method");
            return;
        }
    };
    match emit_event(app, event, payload) {
        Ok(()) => debug!(event, "Emitted Tauri event"),
        Err(e) => error!(event, error = %e, "Failed to emit Tauri event"),
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

    #[test]
    fn send_request_returns_error_on_poisoned_stdin_mutex() {
        let bridge = SidecarBridge::new();
        // Poison the stdin_writer mutex by panicking inside a lock
        let stdin_clone = Arc::clone(&bridge.stdin_writer);
        let _ = std::thread::spawn(move || {
            let _guard = stdin_clone.lock().unwrap();
            panic!("intentional poison");
        })
        .join();
        // The mutex is now poisoned; send_request should not panic
        // It will hit "Sidecar not running" first since supervisor is not running,
        // but we can force the state to Running and test the poisoned path
        bridge.supervisor.record_started();
        let result = bridge.send_request("test:method", None);
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("lock"),
            "Error should mention lock poisoning"
        );
    }

    #[test]
    fn kill_returns_error_on_poisoned_child_mutex() {
        let bridge = SidecarBridge::new();
        // Poison the child mutex
        let child_clone = Arc::clone(&bridge.child);
        let _ = std::thread::spawn(move || {
            let _guard = child_clone.lock().unwrap();
            panic!("intentional poison");
        })
        .join();
        let result = bridge.kill();
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("lock"),
            "Error should mention lock poisoning"
        );
    }

    #[test]
    fn is_healthy_false_when_not_running() {
        let bridge = SidecarBridge::new();
        assert!(!bridge.is_healthy(Duration::from_secs(90)));
    }

    #[test]
    fn is_healthy_true_after_recent_pong() {
        let bridge = SidecarBridge::new();
        bridge.supervisor.record_started();
        bridge.record_pong();
        assert!(bridge.is_healthy(Duration::from_secs(90)));
    }

    #[test]
    fn is_healthy_false_after_silence_exceeds_max() {
        let bridge = SidecarBridge::new();
        bridge.supervisor.record_started();
        // Set last_pong to 100 seconds ago
        *bridge.last_pong.lock().unwrap() =
            Some(Instant::now() - Duration::from_secs(100));
        assert!(!bridge.is_healthy(Duration::from_secs(90)));
    }

    #[test]
    fn is_healthy_true_when_no_pong_yet() {
        let bridge = SidecarBridge::new();
        bridge.supervisor.record_started();
        // No pong set at all — benefit of the doubt
        assert!(bridge.is_healthy(Duration::from_secs(90)));
    }

    #[test]
    fn record_pong_updates_timestamp() {
        let bridge = SidecarBridge::new();
        bridge.supervisor.record_started();
        // Set stale pong
        *bridge.last_pong.lock().unwrap() =
            Some(Instant::now() - Duration::from_secs(200));
        assert!(!bridge.is_healthy(Duration::from_secs(90)));

        // Record fresh pong
        bridge.record_pong();
        assert!(bridge.is_healthy(Duration::from_secs(90)));
    }
}
