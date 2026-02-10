use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tracing::{debug, warn};

use crate::jsonrpc::JsonRpcResponse;

type ResponseSender = std::sync::mpsc::Sender<Result<JsonRpcResponse, String>>;
type ResponseReceiver = std::sync::mpsc::Receiver<Result<JsonRpcResponse, String>>;

struct PendingRequest {
    sender: ResponseSender,
    deadline: Instant,
}

/// Tracks in-flight JSON-RPC requests and matches them to responses by ID.
pub struct PendingRequestTracker {
    pending: Mutex<HashMap<u64, PendingRequest>>,
}

impl PendingRequestTracker {
    pub fn new() -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
        }
    }

    /// Register a new pending request. Returns a receiver that will get the response.
    pub fn register(&self, id: u64, timeout: Duration) -> ResponseReceiver {
        let (tx, rx) = std::sync::mpsc::channel();
        let entry = PendingRequest {
            sender: tx,
            deadline: Instant::now() + timeout,
        };
        let mut map = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        map.insert(id, entry);
        debug!(id, "Registered pending request");
        rx
    }

    /// Resolve a pending request with a response. Returns true if the request was found.
    pub fn resolve(&self, id: u64, response: JsonRpcResponse) -> bool {
        let mut map = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = map.remove(&id) {
            let _ = entry.sender.send(Ok(response));
            debug!(id, "Resolved pending request");
            true
        } else {
            warn!(id, "No pending request found for response");
            false
        }
    }

    /// Check for timed-out requests and fail them.
    pub fn check_timeouts(&self) {
        let now = Instant::now();
        let mut map = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        let expired: Vec<u64> = map
            .iter()
            .filter(|(_, req)| now >= req.deadline)
            .map(|(&id, _)| id)
            .collect();
        for id in expired {
            if let Some(entry) = map.remove(&id) {
                let _ = entry.sender.send(Err(format!(
                    "JSON-RPC request {} timed out",
                    id
                )));
                warn!(id, "Request timed out");
            }
        }
    }

    /// Fail all pending requests (used during shutdown).
    pub fn fail_all(&self, reason: &str) {
        let mut map = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        let ids: Vec<u64> = map.keys().copied().collect();
        for id in ids {
            if let Some(entry) = map.remove(&id) {
                let _ = entry.sender.send(Err(reason.to_string()));
            }
        }
        debug!(reason, "Failed all pending requests");
    }

    /// Returns the number of pending requests.
    pub fn len(&self) -> usize {
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::jsonrpc::JsonRpcResponse;
    use std::time::Duration;

    fn make_response(id: u64) -> JsonRpcResponse {
        JsonRpcResponse {
            jsonrpc: "2.0".to_string(),
            id,
            result: Some(serde_json::json!({"status": "ok"})),
            error: None,
        }
    }

    #[test]
    fn register_and_resolve_delivers_response() {
        let tracker = PendingRequestTracker::new();
        let rx = tracker.register(1, Duration::from_secs(30));
        assert_eq!(tracker.len(), 1);

        let response = make_response(1);
        assert!(tracker.resolve(1, response.clone()));
        assert_eq!(tracker.len(), 0);

        let received = rx.recv_timeout(Duration::from_millis(100)).unwrap();
        assert!(received.is_ok());
        assert_eq!(received.unwrap().id, 1);
    }

    #[test]
    fn resolve_unknown_id_returns_false() {
        let tracker = PendingRequestTracker::new();
        let response = make_response(999);
        assert!(!tracker.resolve(999, response));
    }

    #[test]
    fn timeout_fires_on_expired_request() {
        let tracker = PendingRequestTracker::new();
        // Register with a very short timeout
        let rx = tracker.register(42, Duration::from_millis(1));
        assert_eq!(tracker.len(), 1);

        // Wait for the deadline to pass
        std::thread::sleep(Duration::from_millis(10));

        tracker.check_timeouts();
        assert_eq!(tracker.len(), 0);

        let received = rx.recv_timeout(Duration::from_millis(100)).unwrap();
        assert!(received.is_err());
        assert!(received.unwrap_err().contains("timed out"));
    }

    #[test]
    fn non_expired_request_survives_timeout_check() {
        let tracker = PendingRequestTracker::new();
        let _rx = tracker.register(1, Duration::from_secs(60));

        tracker.check_timeouts();
        assert_eq!(tracker.len(), 1);
    }

    #[test]
    fn fail_all_fails_every_pending_request() {
        let tracker = PendingRequestTracker::new();
        let rx1 = tracker.register(1, Duration::from_secs(30));
        let rx2 = tracker.register(2, Duration::from_secs(30));
        assert_eq!(tracker.len(), 2);

        tracker.fail_all("sidecar killed");
        assert_eq!(tracker.len(), 0);

        let r1 = rx1.recv_timeout(Duration::from_millis(100)).unwrap();
        let r2 = rx2.recv_timeout(Duration::from_millis(100)).unwrap();
        assert!(r1.is_err());
        assert!(r2.is_err());
        assert!(r1.unwrap_err().contains("sidecar killed"));
        assert!(r2.unwrap_err().contains("sidecar killed"));
    }

    #[test]
    fn multiple_requests_tracked_independently() {
        let tracker = PendingRequestTracker::new();
        let rx1 = tracker.register(10, Duration::from_secs(30));
        let rx2 = tracker.register(20, Duration::from_secs(30));
        assert_eq!(tracker.len(), 2);

        // Resolve only the second one
        assert!(tracker.resolve(20, make_response(20)));
        assert_eq!(tracker.len(), 1);

        let r2 = rx2.recv_timeout(Duration::from_millis(100)).unwrap();
        assert!(r2.is_ok());
        assert_eq!(r2.unwrap().id, 20);

        // First is still pending
        assert!(rx1.try_recv().is_err());

        // Resolve the first one
        assert!(tracker.resolve(10, make_response(10)));
        assert_eq!(tracker.len(), 0);
        let r1 = rx1.recv_timeout(Duration::from_millis(100)).unwrap();
        assert!(r1.is_ok());
    }

    #[test]
    fn double_resolve_returns_false() {
        let tracker = PendingRequestTracker::new();
        let _rx = tracker.register(1, Duration::from_secs(30));

        assert!(tracker.resolve(1, make_response(1)));
        // Second resolve should return false — already consumed
        assert!(!tracker.resolve(1, make_response(1)));
    }
}
