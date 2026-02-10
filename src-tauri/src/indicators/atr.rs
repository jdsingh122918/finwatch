use crate::indicators::TickInput;

/// Compute Average True Range using Wilder's smoothing.
/// Returns a Vec<f64> with one value per tick.
/// The first `period` values are NaN (insufficient data).
pub fn compute(ticks: &[TickInput], period: usize) -> Vec<f64> {
    let n = ticks.len();
    let mut result = vec![f64::NAN; n];

    if n <= period {
        return result;
    }

    // Calculate True Range for each bar (first bar has no previous close)
    let mut true_ranges = vec![0.0; n];
    true_ranges[0] = ticks[0].high - ticks[0].low; // No previous close for first bar

    for i in 1..n {
        let high = ticks[i].high;
        let low = ticks[i].low;
        let prev_close = ticks[i - 1].close;

        let hl = high - low;
        let hpc = (high - prev_close).abs();
        let lpc = (low - prev_close).abs();

        true_ranges[i] = hl.max(hpc).max(lpc);
    }

    // Initial ATR = simple average of first `period` true ranges (using indices 1..=period)
    let initial_atr: f64 = true_ranges[1..=period].iter().sum::<f64>() / period as f64;
    result[period] = initial_atr;

    // Wilder's smoothing for subsequent values
    let p = period as f64;
    for i in (period + 1)..n {
        result[i] = (result[i - 1] * (p - 1.0) + true_ranges[i]) / p;
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_ticks(data: &[(f64, f64, f64, f64)]) -> Vec<TickInput> {
        data.iter()
            .enumerate()
            .map(|(i, &(open, high, low, close))| TickInput {
                timestamp: i as i64,
                open,
                high,
                low,
                close,
                volume: 1000.0,
            })
            .collect()
    }

    #[test]
    fn first_period_values_are_nan() {
        let ticks = make_ticks(&vec![(10.0, 12.0, 9.0, 11.0); 20]);
        let atr = compute(&ticks, 14);
        for i in 0..14 {
            assert!(atr[i].is_nan(), "ATR[{}] should be NaN", i);
        }
        assert!(!atr[14].is_nan(), "ATR[14] should be valid");
    }

    #[test]
    fn true_range_with_gap_up() {
        // Gap up: previous close=10, current high=15, low=12
        // TR = max(15-12, |15-10|, |12-10|) = max(3, 5, 2) = 5
        let ticks = make_ticks(&[
            (10.0, 11.0, 9.0, 10.0),
            (12.0, 15.0, 12.0, 14.0),
        ]);
        // We can verify via a period-1 ATR (just one value)
        let atr = compute(&ticks, 1);
        assert!((atr[1] - 5.0).abs() < 0.001, "ATR with gap up: expected 5.0, got {}", atr[1]);
    }

    #[test]
    fn true_range_with_gap_down() {
        // Gap down: previous close=20, current high=16, low=13
        // TR = max(16-13, |16-20|, |13-20|) = max(3, 4, 7) = 7
        let ticks = make_ticks(&[
            (20.0, 21.0, 19.0, 20.0),
            (15.0, 16.0, 13.0, 14.0),
        ]);
        let atr = compute(&ticks, 1);
        assert!((atr[1] - 7.0).abs() < 0.001, "ATR with gap down: expected 7.0, got {}", atr[1]);
    }

    #[test]
    fn atr_constant_range() {
        // All bars have same range: high-low = 2, no gaps
        let data: Vec<(f64, f64, f64, f64)> = (0..20)
            .map(|i| {
                let base = 100.0 + i as f64;
                (base, base + 1.0, base - 1.0, base)
            })
            .collect();
        let ticks = make_ticks(&data);
        let atr = compute(&ticks, 14);

        // With constant range of 2.0 and no gaps, ATR should converge to 2.0
        assert!(
            (atr[14] - 2.0).abs() < 0.1,
            "ATR should be ~2.0, got {}",
            atr[14]
        );
    }

    #[test]
    fn atr_output_length_matches_input() {
        let ticks = make_ticks(&vec![(10.0, 12.0, 9.0, 11.0); 20]);
        let atr = compute(&ticks, 14);
        assert_eq!(atr.len(), 20);
    }

    #[test]
    fn atr_too_few_data_points() {
        let ticks = make_ticks(&vec![(10.0, 12.0, 9.0, 11.0); 10]);
        let atr = compute(&ticks, 14);
        assert_eq!(atr.len(), 10);
        for v in &atr {
            assert!(v.is_nan());
        }
    }

    #[test]
    fn atr_is_always_positive() {
        let data: Vec<(f64, f64, f64, f64)> = (0..30)
            .map(|i| {
                let base = 100.0 + (i as f64 * 0.5).sin() * 10.0;
                (base, base + 2.0, base - 1.5, base + 0.5)
            })
            .collect();
        let ticks = make_ticks(&data);
        let atr = compute(&ticks, 14);
        for i in 14..30 {
            assert!(atr[i] > 0.0, "ATR[{}] should be positive, got {}", i, atr[i]);
        }
    }

    #[test]
    fn atr_known_values() {
        // A well-known ATR test: bars with increasing volatility
        let data: Vec<(f64, f64, f64, f64)> = (0..20)
            .map(|i| {
                let base = 50.0;
                let range = 1.0 + i as f64 * 0.5; // Increasing range
                (base, base + range, base - range, base)
            })
            .collect();
        let ticks = make_ticks(&data);
        let atr = compute(&ticks, 14);

        // ATR should be increasing since volatility is increasing
        assert!(atr[15] > atr[14], "ATR should increase with volatility");
        assert!(atr[19] > atr[15], "ATR should continue increasing");
    }
}
