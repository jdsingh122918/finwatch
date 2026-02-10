/// Compute RSI using Wilder's smoothing method.
/// Returns a Vec<f64> with one value per input close price.
/// The first `period` values are NaN (insufficient data).
pub fn compute(closes: &[f64], period: usize) -> Vec<f64> {
    let n = closes.len();
    let mut result = vec![f64::NAN; n];

    if n <= period {
        return result;
    }

    // Calculate initial average gain and loss over the first `period` price changes
    let mut avg_gain = 0.0;
    let mut avg_loss = 0.0;

    for i in 1..=period {
        let change = closes[i] - closes[i - 1];
        if change > 0.0 {
            avg_gain += change;
        } else {
            avg_loss += -change;
        }
    }

    avg_gain /= period as f64;
    avg_loss /= period as f64;

    // First RSI value at index `period`
    if avg_loss == 0.0 {
        result[period] = 100.0;
    } else {
        let rs = avg_gain / avg_loss;
        result[period] = 100.0 - (100.0 / (1.0 + rs));
    }

    // Apply Wilder's smoothing for subsequent values
    let p = period as f64;
    for i in (period + 1)..n {
        let change = closes[i] - closes[i - 1];
        let (gain, loss) = if change > 0.0 {
            (change, 0.0)
        } else {
            (0.0, -change)
        };

        avg_gain = (avg_gain * (p - 1.0) + gain) / p;
        avg_loss = (avg_loss * (p - 1.0) + loss) / p;

        if avg_loss == 0.0 {
            result[i] = 100.0;
        } else {
            let rs = avg_gain / avg_loss;
            result[i] = 100.0 - (100.0 / (1.0 + rs));
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_period_values_are_nan() {
        let closes: Vec<f64> = (1..=20).map(|x| x as f64).collect();
        let rsi = compute(&closes, 14);
        for i in 0..14 {
            assert!(rsi[i].is_nan(), "RSI[{}] should be NaN", i);
        }
        assert!(!rsi[14].is_nan(), "RSI[14] should be a number");
    }

    #[test]
    fn rsi_of_constant_prices_is_nan_or_neutral() {
        // All same prices => no gains, no losses => avg_gain=0, avg_loss=0 => RSI=100 (division edge)
        // Actually: 0/0 case, avg_loss==0 so RSI=100
        let closes = vec![50.0; 20];
        let rsi = compute(&closes, 14);
        // After period, RSI should be 100 (no losses at all)
        assert_eq!(rsi[14], 100.0);
    }

    #[test]
    fn rsi_monotonically_rising_is_100() {
        // Strictly increasing prices: all gains, no losses => RSI = 100
        let closes: Vec<f64> = (1..=20).map(|x| x as f64).collect();
        let rsi = compute(&closes, 14);
        assert_eq!(rsi[14], 100.0);
        assert_eq!(rsi[19], 100.0);
    }

    #[test]
    fn rsi_monotonically_falling_is_0() {
        // Strictly decreasing prices: all losses, no gains => RSI = 0
        let closes: Vec<f64> = (1..=20).rev().map(|x| x as f64).collect();
        let rsi = compute(&closes, 14);
        assert!((rsi[14] - 0.0).abs() < 0.001, "RSI should be ~0, got {}", rsi[14]);
    }

    #[test]
    fn rsi_known_values() {
        // Known test vector: alternating up/down pattern
        // Prices: 44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84,
        //         46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41,
        //         46.22, 45.64
        // This is a classic RSI test vector from Wilder's book / online references.
        let closes = vec![
            44.0, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84,
            46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41,
            46.22, 45.64,
        ];
        let rsi = compute(&closes, 14);

        // RSI at index 14: the exact value depends on the initial SMA vs first-change seed.
        // With our implementation (SMA seed over first 14 changes), we get ~72.98.
        assert!(
            (rsi[14] - 72.98).abs() < 1.0,
            "RSI[14] expected ~72.98, got {}",
            rsi[14]
        );

        // RSI values should be in valid range
        for i in 14..closes.len() {
            assert!(rsi[i] >= 0.0 && rsi[i] <= 100.0, "RSI[{}] out of range: {}", i, rsi[i]);
        }
    }

    #[test]
    fn rsi_too_few_data_points() {
        let closes = vec![10.0; 10];
        let rsi = compute(&closes, 14);
        assert_eq!(rsi.len(), 10);
        for v in &rsi {
            assert!(v.is_nan());
        }
    }

    #[test]
    fn rsi_values_bounded_0_100() {
        let closes: Vec<f64> = (0..50)
            .map(|i| 100.0 + (i as f64 * 0.7).sin() * 10.0)
            .collect();
        let rsi = compute(&closes, 14);
        for i in 14..closes.len() {
            assert!(rsi[i] >= 0.0 && rsi[i] <= 100.0, "RSI[{}] = {} out of range", i, rsi[i]);
        }
    }
}
