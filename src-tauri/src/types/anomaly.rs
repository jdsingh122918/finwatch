use std::collections::HashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Anomaly {
    pub id: String,
    pub severity: Severity,
    pub source: String,
    pub symbol: Option<String>,
    pub timestamp: u64,
    pub description: String,
    pub metrics: HashMap<String, f64>,
    pub pre_screen_score: f64,
    pub session_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FeedbackVerdict {
    Confirmed,
    FalsePositive,
    NeedsReview,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnomalyFeedback {
    pub anomaly_id: String,
    pub verdict: FeedbackVerdict,
    pub note: Option<String>,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnomalyFilter {
    pub severity: Option<Vec<Severity>>,
    pub source: Option<String>,
    pub symbol: Option<String>,
    pub since: Option<u64>,
    pub limit: Option<u32>,
}
