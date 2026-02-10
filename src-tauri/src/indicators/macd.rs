use crate::indicators::MacdPoint;

/// Compute EMA over a slice of values.
/// Returns a Vec of the same length, with NaN for the first element
/// (uses first value as seed).
fn ema(values: &[f64], period: usize) -> Vec<f64> {
    let n = values.len();
    if n == 0 {
        return vec![];
    }

    let mut result = vec![f64::NAN; n];
    let multiplier = 2.0 / (period as f64 + 1.0);

    // Seed with SMA of first `period` values
    if n < period {
        return result;
    }

    let sma: f64 = values[..period].iter().sum::<f64>() / period as f64;
    result[period - 1] = sma;

    for i in period..n {
        result[i] = (values[i] - result[i - 1]) * multiplier + result[i - 1];
    }

    result
}

/// Compute MACD with given fast, slow, and signal periods.
/// Returns a Vec<MacdPoint> with one entry per input close price.
/// Values are NaN until enough data is available.
pub fn compute(closes: &[f64], fast: usize, slow: usize, signal: usize) -> Vec<MacdPoint> {
    let n = closes.len();
    let nan_point = || MacdPoint {
        line: f64::NAN,
        signal: f64::NAN,
        histogram: f64::NAN,
    };

    if n == 0 {
        return vec![];
    }

    let ema_fast = ema(closes, fast);
    let ema_slow = ema(closes, slow);

    // MACD line = EMA(fast) - EMA(slow)
    let mut macd_line = vec![f64::NAN; n];
    for i in 0..n {
        if !ema_fast[i].is_nan() && !ema_slow[i].is_nan() {
            macd_line[i] = ema_fast[i] - ema_slow[i];
        }
    }

    // Find where MACD line starts being valid (at index slow-1)
    let macd_start = slow - 1;

    // Signal line = EMA(signal) of the MACD line values starting from macd_start
    let valid_macd: Vec<f64> = macd_line[macd_start..].to_vec();
    let signal_ema = ema(&valid_macd, signal);

    // Build the result
    let mut result = Vec::with_capacity(n);
    for i in 0..n {
        if i < macd_start {
            result.push(nan_point());
        } else {
            let offset = i - macd_start;
            let line_val = macd_line[i];
            let signal_val = signal_ema[offset];
            let hist_val = if !line_val.is_nan() && !signal_val.is_nan() {
                line_val - signal_val
            } else {
                f64::NAN
            };
            result.push(MacdPoint {
                line: line_val,
                signal: signal_val,
                histogram: hist_val,
            });
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ema_basic() {
        let values = vec![10.0, 11.0, 12.0, 13.0, 14.0, 15.0];
        let result = ema(&values, 3);
        // First 2 values should be NaN, value at index 2 = SMA(10,11,12) = 11.0
        assert!(result[0].is_nan());
        assert!(result[1].is_nan());
        assert!((result[2] - 11.0).abs() < 0.001);
        // EMA(3) at index 3: (13 - 11) * 0.5 + 11 = 12.0
        assert!((result[3] - 12.0).abs() < 0.001);
    }

    #[test]
    fn macd_early_values_are_nan() {
        let closes: Vec<f64> = (1..=30).map(|x| 100.0 + x as f64).collect();
        let macd = compute(&closes, 12, 26, 9);
        // Before index 25 (slow-1), all should be NaN
        for i in 0..25 {
            assert!(macd[i].line.is_nan(), "MACD line[{}] should be NaN", i);
        }
        // At index 25, MACD line should be valid
        assert!(!macd[25].line.is_nan(), "MACD line[25] should be valid");
    }

    #[test]
    fn macd_signal_starts_after_slow_plus_signal() {
        let closes: Vec<f64> = (1..=40).map(|x| 100.0 + x as f64).collect();
        let macd = compute(&closes, 12, 26, 9);
        // Signal line needs slow-1 + signal-1 = 25 + 8 = 33 data points (index 33)
        assert!(macd[32].signal.is_nan(), "Signal[32] should be NaN");
        assert!(!macd[33].signal.is_nan(), "Signal[33] should be valid");
    }

    #[test]
    fn macd_histogram_is_line_minus_signal() {
        let closes: Vec<f64> = (1..=50).map(|x| 100.0 + (x as f64 * 0.3).sin() * 5.0).collect();
        let macd = compute(&closes, 12, 26, 9);
        for i in 34..50 {
            if !macd[i].line.is_nan() && !macd[i].signal.is_nan() {
                let expected_hist = macd[i].line - macd[i].signal;
                assert!(
                    (macd[i].histogram - expected_hist).abs() < 1e-10,
                    "Histogram[{}] mismatch: {} != {}",
                    i,
                    macd[i].histogram,
                    expected_hist
                );
            }
        }
    }

    #[test]
    fn macd_constant_prices_has_zero_line() {
        let closes = vec![100.0; 40];
        let macd = compute(&closes, 12, 26, 9);
        // Constant prices: EMA(fast) == EMA(slow), so MACD line = 0
        for i in 25..40 {
            assert!(
                (macd[i].line - 0.0).abs() < 1e-10,
                "MACD line[{}] should be 0 for constant prices, got {}",
                i,
                macd[i].line
            );
        }
    }

    #[test]
    fn macd_output_length_matches_input() {
        let closes: Vec<f64> = (1..=35).map(|x| x as f64).collect();
        let macd = compute(&closes, 12, 26, 9);
        assert_eq!(macd.len(), 35);
    }

    #[test]
    fn macd_crossover_detection() {
        // Flat period for warm-up, then strong rally, then sharp sell-off.
        // This ensures MACD histogram goes positive during rally and negative during sell-off.
        let mut closes = Vec::new();
        // 30 bars of flat (lets slow EMA stabilize)
        for _ in 0..30 {
            closes.push(100.0);
        }
        // 20 bars of strong rally (fast EMA > slow EMA => positive MACD)
        for i in 0..20 {
            closes.push(100.0 + i as f64 * 2.0);
        }
        // 30 bars of sharp sell-off (fast EMA < slow EMA => negative MACD)
        for i in 0..30 {
            closes.push(138.0 - i as f64 * 3.0);
        }
        let macd = compute(&closes, 12, 26, 9);

        let valid_hists: Vec<f64> = macd
            .iter()
            .filter(|p| !p.histogram.is_nan())
            .map(|p| p.histogram)
            .collect();

        let has_positive = valid_hists.iter().any(|h| *h > 0.001);
        let has_negative = valid_hists.iter().any(|h| *h < -0.001);
        assert!(
            has_positive && has_negative,
            "Expected MACD crossover (both positive and negative histogram values)"
        );
    }
}
