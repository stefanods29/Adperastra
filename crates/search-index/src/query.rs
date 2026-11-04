//! Pure query normalization and snippet building. No SQL and no FTS
//! operator from user text ever reaches SQLite: names are always quoted and
//! joined with an explicit AND.

use crate::limits::MAX_SNIPPET_SCALARS;

/// One prepared name query.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NameQuery {
    /// Tokens exactly as typed, for snippets.
    pub raw: Vec<String>,
    /// Lower-case, diacritic-free tokens used for matching.
    pub normalized: Vec<String>,
    /// One- and two-character queries match name prefixes.
    pub prefix: bool,
}

impl NameQuery {
    pub fn is_empty(&self) -> bool {
        self.raw.is_empty() || self.normalized.is_empty()
    }
}

/// Lower-case and remove the diacritics Windows search treats as equal.
pub fn normalize_text(input: &str) -> String {
    input
        .chars()
        .map(normalize_char)
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_char(character: char) -> char {
    let lower = character.to_lowercase().next().unwrap_or(character);
    match lower {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => 'a',
        'ç' | 'ć' | 'č' => 'c',
        'ď' | 'đ' => 'd',
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ė' | 'ę' | 'ě' => 'e',
        'ğ' => 'g',
        'ì' | 'í' | 'î' | 'ï' | 'ī' | 'į' => 'i',
        'ł' => 'l',
        'ñ' | 'ń' | 'ň' => 'n',
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ő' => 'o',
        'ř' => 'r',
        'ś' | 'š' | 'ş' => 's',
        'ť' => 't',
        'ù' | 'ú' | 'û' | 'ü' | 'ū' | 'ů' | 'ű' | 'ų' => 'u',
        'ý' | 'ÿ' => 'y',
        'ž' | 'ź' | 'ż' => 'z',
        _ => lower,
    }
}

/// Split one query into tokens once, then normalize every token.
pub fn prepare_name_query(text: &str) -> NameQuery {
    let raw: Vec<String> = text.split_whitespace().map(str::to_string).collect();
    let normalized: Vec<String> = raw
        .iter()
        .map(|token| normalize_text(token))
        .filter(|token| !token.is_empty())
        .collect();
    let prefix = text.trim().chars().count() <= 2 && !raw.is_empty() && !normalized.is_empty();
    NameQuery {
        raw,
        normalized,
        prefix,
    }
}

/// A safe FTS5 phrase for one token. Quoting makes OR/NEAR/wildcards and
/// punctuation literal input, never syntax.
pub fn fts_phrase(token: &str) -> String {
    format!("\"{}\"", token.replace('"', "\"\""))
}

/// `"tok1" AND "tok2"` for every token. The content index (unicode61) can
/// match short words too; the name index filters to trigram-sized tokens
/// before calling this helper.
pub fn fts_and_expression(tokens: &[String]) -> String {
    tokens
        .iter()
        .map(|token| fts_phrase(token))
        .collect::<Vec<_>>()
        .join(" AND ")
}

/// Index range covering every name that starts with `prefix`.
pub fn prefix_range(prefix: &str) -> (String, String) {
    let lower = prefix.to_string();
    let upper = format!("{prefix}\u{10FFFF}");
    (lower, upper)
}

/// A plain-text snippet of at most 256 scalar values around the first match.
pub fn snippet(text: &str, tokens: &[String], match_case: bool) -> String {
    let original: Vec<char> = text.chars().collect();
    if original.is_empty() {
        return String::new();
    }
    let normalized: Vec<char> = if match_case {
        original.clone()
    } else {
        original
            .iter()
            .copied()
            .map(normalize_char)
            .collect::<Vec<_>>()
    };
    let mut first_match = None;
    for token in tokens {
        let needle: Vec<char> = if match_case {
            token.chars().collect()
        } else {
            token.chars().map(normalize_char).collect()
        };
        if needle.is_empty() {
            continue;
        }
        if let Some(index) = find_chars(&normalized, &needle) {
            first_match = Some(first_match.map_or(index, |current: usize| current.min(index)));
        }
    }
    let start = first_match.unwrap_or(0).saturating_sub(64);
    let mut end = (start + MAX_SNIPPET_SCALARS).min(original.len());
    let needs_start = start > 0;
    let needs_end = end < original.len();
    if needs_start {
        end = end.saturating_sub(1);
    }
    if needs_end {
        end = end.saturating_sub(1);
    }
    let mut out = String::new();
    if needs_start {
        out.push('…');
    }
    let mut previous_space = false;
    for character in &original[start..end] {
        let clean = if character.is_control() && *character != '\n' && *character != '\t' {
            ' '
        } else {
            *character
        };
        if clean.is_whitespace() {
            if !previous_space {
                out.push(' ');
            }
            previous_space = true;
        } else {
            out.push(clean);
            previous_space = false;
        }
    }
    if needs_end {
        out.push('…');
    }
    out.trim().to_string()
}

fn find_chars(haystack: &[char], needle: &[char]) -> Option<usize> {
    if needle.len() > haystack.len() {
        return None;
    }
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// Escape a plain-text value so a UI that renders HTML shows it literally.
pub fn escape_plain(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(test)]
mod tests {
    use super::{fts_and_expression, normalize_text, prepare_name_query, snippet};

    #[test]
    fn diacritics_and_case_normalize_together() {
        assert_eq!(normalize_text("Alpha Café"), "alpha cafe");
        assert_eq!(normalize_text("NIÑO"), "nino");
    }

    #[test]
    fn short_queries_are_prefixes() {
        let query = prepare_name_query("re");
        assert!(query.prefix);
        assert_eq!(query.normalized, vec!["re"]);
        assert!(!prepare_name_query("rep").prefix);
    }

    #[test]
    fn fts_operators_are_quoted() {
        assert_eq!(
            fts_and_expression(&["report".into(), "OR".into(), "secret".into()]),
            "\"report\" AND \"OR\" AND \"secret\""
        );
    }

    #[test]
    fn snippets_are_bounded_and_plain() {
        let text = "a".repeat(1000) + " port " + &"b".repeat(1000);
        let snippet = snippet(&text, &["port".into()], false);
        assert!(snippet.chars().count() <= 256);
        assert!(snippet.contains("port"));
        assert!(!snippet.contains('\0'));
    }
}
