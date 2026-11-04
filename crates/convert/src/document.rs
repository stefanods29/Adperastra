//! Pure document layout constants and wrapping (Step 08b D4).
//!
//! The actual PDF drawing happens with pdf-lib and embedded Inter fonts in
//! the trusted helper. This module is the native preflight mirror: it fixes
//! page sizes, margins, font sizes, line height and the measured-word rule so
//! the native side can explain `layout_loss` before a helper starts.

/// Millimetres to PDF points.
pub const MM_TO_PT: f64 = 72.0 / 25.4;
pub const A4_WIDTH_PT: f64 = 595.28;
pub const A4_HEIGHT_PT: f64 = 841.89;
pub const LETTER_WIDTH_PT: f64 = 612.0;
pub const LETTER_HEIGHT_PT: f64 = 792.0;
pub const DEFAULT_MARGIN_MM: u16 = 20;
pub const BODY_SIZE_PT: f64 = 11.0;
pub const LINE_HEIGHT: f64 = 1.4;
pub const TABLE_CELL_PADDING_PT: f64 = 8.0;

/// Heading sizes 1 to 6 (D4).
pub const HEADING_SIZES_PT: [f64; 6] = [16.0, 14.0, 13.0, 12.0, 11.0, 11.0];

/// One page's usable width and height in points.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PageBox {
    pub width_pt: f64,
    pub height_pt: f64,
    pub margin_pt: f64,
    pub available_width_pt: f64,
    pub available_height_pt: f64,
}

/// The exact page box. A4 at 20 mm leaves 481.89417... pt.
pub fn page_box(page_size: &str, margin_mm: u16) -> Result<PageBox, crate::error::ConvertError> {
    if margin_mm > 50 {
        return Err(crate::error::ConvertError::BadRequest);
    }
    let margin = f64::from(margin_mm) * MM_TO_PT;
    let (width, height) = match page_size {
        "a4" | "source" => (A4_WIDTH_PT, A4_HEIGHT_PT),
        "letter" => (LETTER_WIDTH_PT, LETTER_HEIGHT_PT),
        _ => return Err(crate::error::ConvertError::BadRequest),
    };
    let available_width = width - 2.0 * margin;
    let available_height = height - 2.0 * margin;
    if available_width <= 0.0 || available_height <= 0.0 {
        return Err(crate::error::ConvertError::BadRequest);
    }
    Ok(PageBox {
        width_pt: width,
        height_pt: height,
        margin_pt: margin,
        available_width_pt: available_width,
        available_height_pt: available_height,
    })
}

/// One wrapped line, measured with an injected font.
#[derive(Debug, Clone, PartialEq)]
pub struct LayoutLine {
    pub text: String,
    pub width_pt: f64,
    pub split: bool,
}

/// Wrap words at a measured width. A word wider than the line is split at a
/// Unicode code-point boundary, never inside a surrogate pair.
pub fn wrap_paragraph<F>(text: &str, size_pt: f64, max_width_pt: f64, measure: F) -> Vec<LayoutLine>
where
    F: Fn(&str, f64) -> f64,
{
    if !max_width_pt.is_finite() || max_width_pt <= 0.0 || size_pt <= 0.0 {
        return Vec::new();
    }
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.is_empty() {
        return Vec::new();
    }
    let mut lines = Vec::new();
    let mut current = String::new();
    let mut current_width = 0.0;
    let mut current_split = false;
    for word in words {
        let space = if current.is_empty() {
            0.0
        } else {
            measure(" ", size_pt)
        };
        let word_width = measure(word, size_pt);
        if !current.is_empty() && current_width + space + word_width <= max_width_pt {
            current.push(' ');
            current.push_str(word);
            current_width += space + word_width;
            continue;
        }
        if !current.is_empty() {
            lines.push(LayoutLine {
                text: std::mem::take(&mut current),
                width_pt: current_width,
                split: current_split,
            });
            current_split = false;
        }
        if word_width <= max_width_pt {
            current.push_str(word);
            current_width = word_width;
            continue;
        }
        let mut part = String::new();
        let mut part_width = 0.0;
        let mut split = false;
        for character in word.chars() {
            let mut buffer = [0u8; 4];
            let text = character.encode_utf8(&mut buffer);
            let width = measure(text, size_pt);
            if !part.is_empty() && part_width + width > max_width_pt {
                lines.push(LayoutLine {
                    text: std::mem::take(&mut part),
                    width_pt: part_width,
                    split,
                });
                part_width = 0.0;
                split = true;
            }
            part.push(character);
            part_width += width;
        }
        current = part;
        current_width = part_width;
        current_split = split;
    }
    if !current.is_empty() {
        lines.push(LayoutLine {
            text: current,
            width_pt: current_width,
            split: current_split,
        });
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a4_available_width_matches_the_guide_oracle() {
        let page = page_box("a4", 20).unwrap();
        let expected = 595.28 - 2.0 * (20.0 * 72.0 / 25.4);
        assert!((page.available_width_pt - expected).abs() < 1e-9);
        assert!((page.available_width_pt - 481.894_17).abs() < 1e-4);
    }

    #[test]
    fn wrapping_uses_the_measured_width() {
        let lines = wrap_paragraph("one two three four", 11.0, 50.0, |text, _| {
            text.len() as f64 * 6.0
        });
        assert_eq!(lines[0].text, "one two");
        assert_eq!(lines[1].text, "three");
        assert_eq!(lines[2].text, "four");
    }

    #[test]
    fn long_words_split_at_code_point_boundaries() {
        let lines = wrap_paragraph("abcdefghij", 10.0, 18.0, |text, _| {
            text.chars().count() as f64 * 6.0
        });
        assert!(lines.len() >= 2);
        assert!(lines.iter().all(|line| line.text.chars().count() <= 3));
    }

    #[test]
    fn invalid_margins_are_refused() {
        assert!(page_box("a4", 51).is_err());
        assert!(page_box("a4", 20).is_ok());
    }
}
