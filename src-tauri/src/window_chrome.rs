//! Physical client-area geometry for native caption dragging.
pub fn valid_caption_rect(rect: Option<[f64; 4]>) -> bool {
    rect.is_none_or(|r| {
        r.iter()
            .all(|value| value.is_finite() && *value <= 1_000_000.0)
            && r[0] >= 0.0
            && r[1] >= 0.0
            && r[2] > 0.0
            && r[3] > 0.0
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caption_geometry_accepts_clear_and_positive_physical_rectangles() {
        assert!(valid_caption_rect(None));
        assert!(valid_caption_rect(Some([150.0, 4.0, 800.0, 32.0])));
    }

    #[test]
    fn caption_geometry_rejects_nonfinite_negative_and_empty_regions() {
        for rect in [
            [f64::NAN, 0.0, 1.0, 1.0],
            [0.0, 0.0, f64::INFINITY, 1.0],
            [-1.0, 0.0, 1.0, 1.0],
            [0.0, -1.0, 1.0, 1.0],
            [0.0, 0.0, 0.0, 1.0],
            [0.0, 0.0, 1.0, -1.0],
            [0.0, 0.0, 1_000_001.0, 1.0],
        ] {
            assert!(!valid_caption_rect(Some(rect)));
        }
    }
}
