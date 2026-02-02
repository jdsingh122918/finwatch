use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};

static REQUEST_ID: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcRequest {
    pub jsonrpc: String,
    pub id: u64,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcResponse {
    pub jsonrpc: String,
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
    pub data: Option<serde_json::Value>,
}

impl JsonRpcRequest {
    pub fn new(method: &str, params: Option<serde_json::Value>) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            id: REQUEST_ID.fetch_add(1, Ordering::SeqCst),
            method: method.to_string(),
            params,
        }
    }

    pub fn to_line(&self) -> Result<String, serde_json::Error> {
        let mut s = serde_json::to_string(self)?;
        s.push('\n');
        Ok(s)
    }
}

impl JsonRpcResponse {
    pub fn is_success(&self) -> bool {
        self.error.is_none()
    }

    pub fn from_line(line: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(line.trim())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_serializes_to_valid_json() {
        let req = JsonRpcRequest::new("ping", None);
        let line = req.to_line().unwrap();
        assert!(line.ends_with('\n'));
        let parsed: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(parsed["jsonrpc"], "2.0");
        assert_eq!(parsed["method"], "ping");
    }

    #[test]
    fn request_with_params() {
        let params = serde_json::json!({"query": "test"});
        let req = JsonRpcRequest::new("memory:search", Some(params));
        let line = req.to_line().unwrap();
        let parsed: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(parsed["params"]["query"], "test");
    }

    #[test]
    fn request_ids_auto_increment() {
        let r1 = JsonRpcRequest::new("a", None);
        let r2 = JsonRpcRequest::new("b", None);
        assert!(r2.id > r1.id);
    }

    #[test]
    fn response_parses_success() {
        let json = r#"{"jsonrpc":"2.0","id":1,"result":{"status":"ok"}}"#;
        let resp = JsonRpcResponse::from_line(json).unwrap();
        assert!(resp.is_success());
        assert_eq!(resp.result.unwrap()["status"], "ok");
    }

    #[test]
    fn response_parses_error() {
        let json = r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found"}}"#;
        let resp = JsonRpcResponse::from_line(json).unwrap();
        assert!(!resp.is_success());
        assert_eq!(resp.error.unwrap().code, -32601);
    }

    #[test]
    fn roundtrip_request_matches_node_format() {
        // This must match what agent/src/ipc/json-rpc.ts expects
        let req = JsonRpcRequest::new("ping", Some(serde_json::json!({})));
        let line = req.to_line().unwrap();
        let parsed: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert!(parsed.get("jsonrpc").is_some());
        assert!(parsed.get("id").is_some());
        assert!(parsed.get("method").is_some());
    }
}
