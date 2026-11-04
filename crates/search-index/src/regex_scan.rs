//! Bounded regular-expression compilation. Scanning itself runs inside the
//! shared job's blocking thread with a two-second first-page budget; this
//! module only fixes which patterns are accepted and how large they may grow.

use regex::{Regex, RegexBuilder};

use crate::limits::{MAX_REGEX_BYTES, REGEX_DFA_SIZE_LIMIT, REGEX_NEST_LIMIT, REGEX_SIZE_LIMIT};
use crate::SearchError;

/// Refuse constructs the bounded engine does not support, with the
/// translated `search.regex` answer instead of a generic parse error.
pub fn reject_unsupported(pattern: &str) -> Result<(), SearchError> {
    if pattern.is_empty() {
        return Err(SearchError::Regex);
    }
    // Backreferences (`\1`, `\k<name>`, `\g<1>`) and lookaround are not part
    // of the Rust regex language. Check them explicitly so the UI can say
    // "not supported" instead of "the search could not finish".
    if pattern.contains("(?=")
        || pattern.contains("(?!")
        || pattern.contains("(?<=")
        || pattern.contains("(?<!")
        || pattern.contains("(?>")
        || pattern.contains("\\k<")
        || pattern.contains("\\g<")
    {
        return Err(SearchError::Regex);
    }
    let bytes = pattern.as_bytes();
    let mut index = 0usize;
    while index + 1 < bytes.len() {
        if bytes[index] == b'\\' {
            if bytes[index + 1].is_ascii_digit() {
                return Err(SearchError::Regex);
            }
            index += 2;
        } else {
            index += 1;
        }
    }
    Ok(())
}

/// Compile one user pattern with every size and nesting bound.
pub fn compile(pattern: &str, match_case: bool) -> Result<Regex, SearchError> {
    if pattern.len() > MAX_REGEX_BYTES {
        return Err(SearchError::TooLarge);
    }
    reject_unsupported(pattern)?;
    RegexBuilder::new(pattern)
        .case_insensitive(!match_case)
        .size_limit(REGEX_SIZE_LIMIT)
        .dfa_size_limit(REGEX_DFA_SIZE_LIMIT)
        .nest_limit(REGEX_NEST_LIMIT)
        .build()
        .map_err(|_| SearchError::Regex)
}

pub fn matches(regex: &Regex, text: &str) -> bool {
    regex.is_match(text)
}

#[cfg(test)]
mod tests {
    use super::{compile, reject_unsupported};

    #[test]
    fn backreferences_and_lookaround_are_rejected() {
        assert!(reject_unsupported(r"(a)\1").is_err());
        assert!(reject_unsupported(r"a(?=b)").is_err());
        assert!(reject_unsupported(r"a(?!b)").is_err());
    }

    #[test]
    fn ordinary_patterns_compile_with_case_control() {
        assert!(compile("port", false).unwrap().is_match("REPORT"));
        assert!(!compile("port", true).unwrap().is_match("REPORT"));
    }
}
