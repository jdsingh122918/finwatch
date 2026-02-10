use crate::indicators::BollingerPoint;

/// Compute Bollinger Bands with given period and standard deviation multiplier.
/// Returns a Vec<BollingerPoint> with one entry per input close price.
/// Values are NaN until enough data is available (first `period-1` entries).
pub fn compute(closes: &[f64], period: usize, std_dev_mult: f64) -> Vec<BollingerPoint> {
    let n = closes.len();
    let nan_point = || BollingerPoint {
        upper: f64::NAN,
        middle: f64::NAN,
        lower: f64::NAN,
        percent_b: f64::NAN,
    };

    if n == 0 {
        return vec![];
    }

    let mut result = Vec::with_capacity(n);

    for i in 0..n {
        if i < period - 1 {
            result.push(nan_point());
            continue;
        }

        let window = &closes[(i + 1 - period)..=i];
        let sma: f64 = window.iter().sum::<f64>() / period as f64;

        let variance: f64 = window.iter().map(|x| (x - sma).powi(2)).sum::<f64>() / period as f64;
        let std_dev = variance.sqrt();

        let upper = sma + std_dev_mult * std_dev;
        let lower = sma - std_dev_mult * std_dev;
        let band_width = upper - lower;

        let percent_b = if band_width > 0.0 {
            (closes[i] - lower) / band_width
        } else {
            0.5 // Price is on the middle band when bands are flat
        };

        result.push(BollingerPoint {
            upper,
            middle: sma,
            lower,
            percent_b,
        });
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn early_values_are_nan() {
        let closes: Vec<f64> = (1..=25).map(|x| x as f64).collect();
        let bb = compute(&closes, 20, 2.0);
        for i in 0..19 {
            assert!(bb[i].middle.is_nan(), "BB[{}].middle should be NaN", i);
        }
        assert!(!bb[19].middle.is_nan(), "BB[19].middle should be valid");
    }

    #[test]
    fn middle_band_is_sma() {
        let closes = vec![10.0, 12.0, 14.0, 16.0, 18.0];
        let bb = compute(&closes, 5, 2.0);
        // SMA(5) at index 4 = (10+12+14+16+18)/5 = 14.0
        assert!((bb[4].middle - 14.0).abs() < 0.001);
    }

    #[test]
    fn bands_symmetric_around_middle() {
        let closes: Vec<f64> = (1..=25).map(|x| 100.0 + x as f64).collect();
        let bb = compute(&closes, 20, 2.0);
        for i in 19..25 {
            let mid = bb[i].middle;
            let upper_dist = bb[i].upper - mid;
            let lower_dist = mid - bb[i].lower;
            assert!(
                (upper_dist - lower_dist).abs() < 1e-10,
                "Bands not symmetric at {}: upper_dist={}, lower_dist={}",
                i,
                upper_dist,
                lower_dist
            );
        }
    }

    #[test]
    fn constant_prices_collapse_bands() {
        let closes = vec![50.0; 25];
        let bb = compute(&closes, 20, 2.0);
        // Constant prices: std dev = 0, so upper == middle == lower
        assert!((bb[19].upper - 50.0).abs() < 1e-10);
        assert!((bb[19].middle - 50.0).abs() < 1e-10);
        assert!((bb[19].lower - 50.0).abs() < 1e-10);
        // percent_b should be 0.5 (midpoint)
        assert!((bb[19].percent_b - 0.5).abs() < 1e-10);
    }

    #[test]
    fn percent_b_at_upper_band_is_1() {
        // If close == upper, percent_b should be 1.0
        // If close == lower, percent_b should be 0.0
        // If close == middle, percent_b should be 0.5
        let closes = vec![
            10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0, 17.0, 18.0, 19.0,
            20.0, 21.0, 22.0, 23.0, 24.0, 25.0, 26.0, 27.0, 28.0, 29.0,
        ];
        let bb = compute(&closes, 20, 2.0);
        // percent_b should be between 0 and 1 for prices within bands
        let pb = bb[19].percent_b;
        assert!(pb >= 0.0 && pb <= 1.5, "percent_b out of reasonable range: {}", pb);
    }

    #[test]
    fn upper_always_gte_lower() {
        let closes: Vec<f64> = (0..30)
            .map(|i| 100.0 + (i as f64 * 0.5).sin() * 10.0)
            .collect();
        let bb = compute(&closes, 20, 2.0);
        for i in 19..30 {
            assert!(
                bb[i].upper >= bb[i].lower,
                "Upper < Lower at index {}: {} < {}",
                i,
                bb[i].upper,
                bb[i].lower
            );
        }
    }

    #[test]
    fn output_length_matches_input() {
        let closes = vec![10.0; 25];
        let bb = compute(&closes, 20, 2.0);
        assert_eq!(bb.len(), 25);
    }

    #[test]
    fn known_values_simple() {
        // 5-period BB for easy manual verification
        let closes = vec![22.0, 22.5, 23.0, 22.5, 22.0, 21.5, 22.0, 22.5, 23.0, 23.5];
        let bb = compute(&closes, 5, 2.0);

        // At index 4: SMA(22,22.5,23,22.5,22) = 22.4
        let expected_sma = (22.0 + 22.5 + 23.0 + 22.5 + 22.0) / 5.0;
        assert!(
            (bb[4].middle - expected_sma).abs() < 0.001,
            "Middle band at index 4: expected {}, got {}",
            expected_sma,
            bb[4].middle
        );

        // Verify std dev calculation
        let window = [22.0, 22.5, 23.0, 22.5, 22.0];
        let var: f64 = window.iter().map(|x| (x - expected_sma).powi(2)).sum::<f64>() / 5.0;
        let std = var.sqrt();
        let expected_upper = expected_sma + 2.0 * std;
        let expected_lower = expected_sma - 2.0 * std;
        assert!((bb[4].upper - expected_upper).abs() < 0.001);
        assert!((bb[4].lower - expected_lower).abs() < 0.001);
    }
}
