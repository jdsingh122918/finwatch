pub mod atr;
pub mod bollinger;
pub mod macd;
pub mod rsi;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TickInput {
    pub timestamp: i64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MacdPoint {
    pub line: f64,
    pub signal: f64,
    pub histogram: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct BollingerPoint {
    pub upper: f64,
    pub middle: f64,
    pub lower: f64,
    pub percent_b: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct IndicatorResult {
    pub symbol: String,
    pub rsi: Vec<f64>,
    pub macd: Vec<MacdPoint>,
    pub bollinger: Vec<BollingerPoint>,
    pub atr: Vec<f64>,
}

#[tauri::command]
pub fn indicators_compute(
    symbol: String,
    ticks: Vec<TickInput>,
) -> Result<IndicatorResult, String> {
    if ticks.is_empty() {
        return Err("No tick data provided".to_string());
    }

    let closes: Vec<f64> = ticks.iter().map(|t| t.close).collect();

    let rsi_values = rsi::compute(&closes, 14);
    let macd_values = macd::compute(&closes, 12, 26, 9);
    let bollinger_values = bollinger::compute(&closes, 20, 2.0);
    let atr_values = atr::compute(&ticks, 14);

    Ok(IndicatorResult {
        symbol,
        rsi: rsi_values,
        macd: macd_values,
        bollinger: bollinger_values,
        atr: atr_values,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_ticks(closes: &[f64]) -> Vec<TickInput> {
        closes
            .iter()
            .enumerate()
            .map(|(i, &c)| TickInput {
                timestamp: i as i64,
                open: c,
                high: c + 1.0,
                low: c - 1.0,
                close: c,
                volume: 1000.0,
            })
            .collect()
    }

    #[test]
    fn compute_returns_correct_symbol() {
        let ticks = sample_ticks(&[10.0; 30]);
        let result = indicators_compute("AAPL".to_string(), ticks).unwrap();
        assert_eq!(result.symbol, "AAPL");
    }

    #[test]
    fn compute_returns_matching_lengths() {
        let ticks = sample_ticks(&[10.0; 30]);
        let result = indicators_compute("SPY".to_string(), ticks.clone()).unwrap();
        assert_eq!(result.rsi.len(), ticks.len());
        assert_eq!(result.macd.len(), ticks.len());
        assert_eq!(result.bollinger.len(), ticks.len());
        assert_eq!(result.atr.len(), ticks.len());
    }

    #[test]
    fn compute_empty_ticks_is_err() {
        let result = indicators_compute("AAPL".to_string(), vec![]);
        assert!(result.is_err());
    }
}
