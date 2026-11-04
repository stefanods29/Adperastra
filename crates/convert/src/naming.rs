//! File-name patterns and output-name parts (Step 08b D9, E5).
//!
//! A pattern is bounded data, never code or a regular expression: literal
//! characters that are valid in a Windows file name plus the braced tokens
//! `{stem}`, `{ext}`, `{index}` and `{date}`. The pattern is expanded exactly
//! once; no adapter appends an extension or a page/sheet suffix afterwards.
//!
//! The same rules are mirrored for instant previews in
//! `src/convert/naming.ts`. This module is authoritative.

use std::collections::HashSet;

use crate::error::ConvertError;
use crate::types::OutputNamePart;

/// Longest pattern, in Unicode scalar values (D9).
pub const MAX_PATTERN_CHARS: usize = 128;
/// Longest resulting file name, in UTF-16 units (D9 / Windows limit).
pub const MAX_RESULT_UTF16: usize = 255;
/// Longest preset name, in Unicode scalar values (D8).
pub const MAX_PRESET_NAME_CHARS: u32 = 60;
/// `{index}` is padded to at least this many decimal digits (D9).
pub const MIN_INDEX_DIGITS: usize = 3;

/// The characters Windows refuses in a file name, plus the two separators.
const INVALID_LITERAL: [char; 9] = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/// Render one output name from an already normalized effective stem.
///
/// `index` is the actual 1-based output index (the caller adds
/// `ConversionNaming.start_index` to the zero-based global output index).
/// `date_utc` is the confirmation date captured once per job.
pub fn render_conversion_name(
    pattern: &str,
    stem: &str,
    ext: &str,
    index: u32,
    date_utc: &str,
) -> Result<String, ConvertError> {
    if pattern.is_empty()
        || pattern.chars().count() > MAX_PATTERN_CHARS
        || stem.is_empty()
        || !is_canonical_extension(ext)
        || index == 0
        || !is_valid_utc_date(date_utc)
    {
        return Err(ConvertError::InvalidPattern);
    }

    let tokens = scan_pattern(pattern)?;
    if tokens.ext != 1 {
        return Err(ConvertError::InvalidPattern);
    }
    // `{ext}` may only appear as the final `.{ext}` suffix. The scanner
    // already ran to the end, so this is the same rule stated in D9.
    if !pattern.ends_with(".{ext}") {
        return Err(ConvertError::InvalidPattern);
    }

    let mut result = String::with_capacity(pattern.len() + stem.len() + 8);
    let mut chars = pattern.chars().peekable();
    while let Some(character) = chars.next() {
        if character == '{' {
            let mut token = String::new();
            for next in chars.by_ref() {
                if next == '}' {
                    break;
                }
                token.push(next);
            }
            match token.as_str() {
                "stem" => result.push_str(stem),
                "ext" => result.push_str(ext),
                "index" => result.push_str(&format_index(index)),
                "date" => result.push_str(date_utc),
                _ => return Err(ConvertError::InvalidPattern),
            }
        } else {
            result.push(character);
        }
    }

    validate_result(&result)
}

/// The effective stem after one adapter-provided output-name part.
///
/// Page outputs append `-page-` and at least three digits; worksheet outputs
/// append `-` and the normalized worksheet name. No extension is ever added
/// here: the pattern's `{ext}` is the only extension.
pub fn effective_stem(stem: &str, part: &OutputNamePart) -> String {
    match part {
        OutputNamePart::None => stem.to_string(),
        OutputNamePart::Page { page } => {
            let mut value = String::with_capacity(stem.len() + 10);
            value.push_str(stem);
            value.push_str("-page-");
            value.push_str(&format_page(*page));
            value
        }
        OutputNamePart::Sheet { sheet } => {
            let mut value = String::with_capacity(stem.len() + sheet.len() + 1);
            value.push_str(stem);
            value.push('-');
            value.push_str(&normalize_sheet_component(sheet));
            value
        }
    }
}

/// A worksheet name as it may appear inside a file name (D6).
///
/// Invalid Windows filename characters and control characters become `_`,
/// trailing dots and spaces are removed, and an empty result becomes
/// `sheet`. The original worksheet name remains the output's `name_part`
/// so the report can say exactly which sheet produced the file.
pub fn normalize_sheet_component(sheet: &str) -> String {
    let mut value = String::with_capacity(sheet.len());
    for character in sheet.chars() {
        if character.is_control() || INVALID_LITERAL.contains(&character) {
            value.push('_');
        } else {
            value.push(character);
        }
    }
    while value.ends_with(' ') || value.ends_with('.') {
        value.pop();
    }
    if value.is_empty() {
        "sheet".to_string()
    } else {
        value
    }
}

/// At least three digits; larger indices keep all their digits.
pub fn format_index(index: u32) -> String {
    if index == 0 {
        return "000".to_string();
    }
    format!("{index:03}")
}

/// Page numbers in the effective stem use the same minimum width.
pub fn format_page(page: u32) -> String {
    format_index(page.max(1))
}

/// A canonical target extension: lower-case ASCII letters and digits,
/// without a leading dot (D9).
pub fn is_canonical_extension(ext: &str) -> bool {
    !ext.is_empty()
        && ext.len() <= 16
        && ext
            .chars()
            .all(|character| character.is_ascii_lowercase() || character.is_ascii_digit())
}

/// Strict `YYYY-MM-DD` in UTC, including leap years (E5).
pub fn is_valid_utc_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return false;
    }
    let year = parse_digits(&bytes[0..4]);
    let month = parse_digits(&bytes[5..7]);
    let day = parse_digits(&bytes[8..10]);
    let (Some(year), Some(month), Some(day)) = (year, month, day) else {
        return false;
    };
    if year == 0 || !(1..=12).contains(&month) {
        return false;
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=days).contains(&day)
}

fn parse_digits(bytes: &[u8]) -> Option<u32> {
    let mut value = 0u32;
    for byte in bytes {
        if !byte.is_ascii_digit() {
            return None;
        }
        value = value * 10 + u32::from(byte - b'0');
    }
    Some(value)
}

#[derive(Default)]
struct TokenCounts {
    stem: u8,
    ext: u8,
    index: u8,
    date: u8,
}

fn scan_pattern(pattern: &str) -> Result<TokenCounts, ConvertError> {
    let mut counts = TokenCounts::default();
    let mut seen = HashSet::new();
    let mut chars = pattern.chars().peekable();
    while let Some(character) = chars.next() {
        match character {
            '{' => {
                let mut token = String::new();
                let mut closed = false;
                for next in chars.by_ref() {
                    if next == '}' {
                        closed = true;
                        break;
                    }
                    if next == '{' {
                        return Err(ConvertError::InvalidPattern);
                    }
                    token.push(next);
                }
                if !closed {
                    return Err(ConvertError::InvalidPattern);
                }
                match token.as_str() {
                    "stem" => counts.stem = counts.stem.saturating_add(1),
                    "ext" => counts.ext = counts.ext.saturating_add(1),
                    "index" => counts.index = counts.index.saturating_add(1),
                    "date" => counts.date = counts.date.saturating_add(1),
                    _ => return Err(ConvertError::InvalidPattern),
                }
                if !seen.insert(token) {
                    // Each named token may occur at most once (D9).
                    return Err(ConvertError::InvalidPattern);
                }
            }
            '}' => return Err(ConvertError::InvalidPattern),
            other if is_valid_literal(other) => {}
            _ => return Err(ConvertError::InvalidPattern),
        }
    }
    Ok(counts)
}

fn is_valid_literal(character: char) -> bool {
    !character.is_control() && !INVALID_LITERAL.contains(&character)
}

fn validate_result(result: &str) -> Result<String, ConvertError> {
    if result.is_empty()
        || result.encode_utf16().count() > MAX_RESULT_UTF16
        || result.ends_with(' ')
        || result.ends_with('.')
        || result.contains('/')
        || result.contains('\\')
        || result.chars().any(char::is_control)
        || fs_service::validate_new_name(result).is_err()
    {
        return Err(ConvertError::InvalidPattern);
    }
    Ok(result.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_the_exact_naming_oracle() {
        assert_eq!(
            render_conversion_name("{stem}-{index}.{ext}", "photo", "jpg", 2, "2026-11-01")
                .unwrap(),
            "photo-002.jpg"
        );
    }

    #[test]
    fn page_part_then_pattern_matches_the_guide_oracle() {
        let stem = effective_stem("photo", &OutputNamePart::Page { page: 2 });
        assert_eq!(stem, "photo-page-002");
        assert_eq!(
            render_conversion_name("{stem}-{index}.{ext}", &stem, "png", 1, "2026-11-01").unwrap(),
            "photo-page-002-001.png"
        );
    }

    #[test]
    fn sheet_part_is_normalized_before_the_pattern() {
        let stem = effective_stem(
            "book",
            &OutputNamePart::Sheet {
                sheet: "A/B".to_string(),
            },
        );
        assert_eq!(stem, "book-A_B");
        assert_eq!(
            render_conversion_name("{stem}.{ext}", &stem, "csv", 1, "2026-11-01").unwrap(),
            "book-A_B.csv"
        );
    }

    #[test]
    fn sheet_names_are_trimmed_and_never_empty() {
        assert_eq!(normalize_sheet_component("Budget2026"), "Budget2026");
        assert_eq!(normalize_sheet_component("A/B"), "A_B");
        assert_eq!(normalize_sheet_component("Name... "), "Name");
        assert_eq!(normalize_sheet_component("   "), "sheet");
    }

    #[test]
    fn unknown_token_is_refused() {
        assert!(matches!(
            render_conversion_name("{stem}-{unknown}.{ext}", "photo", "jpg", 1, "2026-11-01"),
            Err(ConvertError::InvalidPattern)
        ));
    }

    #[test]
    fn ext_must_be_the_final_dot_suffix_and_exactly_once() {
        for pattern in [
            "{stem}.{ext}.{ext}",
            "{stem}-{ext}",
            "{stem}.{ext}-x",
            "{ext}.{ext}",
        ] {
            assert!(
                matches!(
                    render_conversion_name(pattern, "photo", "jpg", 1, "2026-11-01"),
                    Err(ConvertError::InvalidPattern)
                ),
                "{pattern}"
            );
        }
    }

    #[test]
    fn duplicate_stem_is_refused_and_a_stem_less_pattern_is_still_data() {
        assert!(matches!(
            render_conversion_name("{stem}-{stem}.{ext}", "photo", "jpg", 1, "2026-11-01"),
            Err(ConvertError::InvalidPattern)
        ));
        // D9 says `{stem}` may occur once, not that it must occur.
        assert_eq!(
            render_conversion_name(".{ext}", "photo", "jpg", 1, "2026-11-01").unwrap(),
            ".jpg"
        );
        assert_eq!(
            render_conversion_name("{index}.{ext}", "photo", "jpg", 1, "2026-11-01").unwrap(),
            "001.jpg"
        );
    }

    #[test]
    fn invalid_literals_and_unmatched_braces_are_refused() {
        for pattern in [
            "a:b.{ext}",
            "a?.{ext}",
            "{stem.{ext}",
            "stem}.{ext}",
            "a/{b}.{ext}",
        ] {
            assert!(
                matches!(
                    render_conversion_name(pattern, "photo", "jpg", 1, "2026-11-01"),
                    Err(ConvertError::InvalidPattern)
                ),
                "{pattern}"
            );
        }
    }

    #[test]
    fn dates_are_strict_utc_days() {
        assert!(is_valid_utc_date("2024-02-29"));
        assert!(!is_valid_utc_date("2023-02-29"));
        assert!(!is_valid_utc_date("2026-13-01"));
        assert!(!is_valid_utc_date("2026-00-10"));
        assert!(!is_valid_utc_date("2026-11-1"));
        assert!(!is_valid_utc_date("2026-11-01T00:00:00Z"));
    }

    #[test]
    fn result_is_bounded_in_utf16_units() {
        let stem = "😀".repeat(200);
        assert!(matches!(
            render_conversion_name("{stem}.{ext}", &stem, "jpg", 1, "2026-11-01"),
            Err(ConvertError::InvalidPattern)
        ));
    }

    #[test]
    fn index_keeps_at_least_three_digits_and_grows() {
        assert_eq!(format_index(1), "001");
        assert_eq!(format_index(999), "999");
        assert_eq!(format_index(1000), "1000");
    }
}
