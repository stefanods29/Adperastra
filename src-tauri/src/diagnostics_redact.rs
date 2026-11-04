//! Default masking for diagnostic text (Step 09h decision 10). Drive paths,
//! UNC paths, JSON-escaped paths and the user-name segment of a profile are
//! replaced by per-report stable tokens. Masking is best effort and the user
//! reviews every file before saving; this module never claims perfection.

use std::collections::HashMap;

#[derive(Default)]
pub struct Redactor {
    paths: HashMap<String, String>,
    users: HashMap<String, String>,
    private_values: Vec<(String, String)>,
}

impl Redactor {
    pub fn new() -> Self {
        Self::default()
    }

    /// Mask a known private value (the current user or computer name) even
    /// when it appears outside a path. Values shorter than three characters
    /// are ignored so ordinary words are not mangled.
    pub fn add_private_value(&mut self, value: &str, prefix: &str) {
        if value.chars().count() < 3 {
            return;
        }
        let next = self
            .private_values
            .iter()
            .filter(|(_, token)| token.starts_with(prefix))
            .count()
            + 1;
        self.private_values
            .push((value.to_string(), format!("{prefix}{next}>")));
    }

    /// Stable tokens within one report: the same path or user keeps its
    /// number, a different one gets the next free number.
    pub fn redact(&mut self, text: &str) -> String {
        let mut masked = text.to_string();
        for (value, token) in &self.private_values {
            masked = masked.replace(value, token);
        }
        let with_users = self.redact_users(&masked);
        self.redact_paths(&with_users)
    }

    fn redact_users(&mut self, text: &str) -> String {
        let mut output = String::with_capacity(text.len());
        let mut index = 0usize;
        while let Some(found) = text[index..].find("\\Users\\") {
            let start = index + found;
            let name_start = start + "\\Users\\".len();
            output.push_str(&text[index..name_start]);
            let rest = &text[name_start..];
            let end = rest
                .find(|character: char| character == '\\' || character == '"' || character.is_whitespace())
                .unwrap_or(rest.len());
            let name = &rest[..end];
            if name.is_empty() {
                index = name_start;
                continue;
            }
            let next = self.users.len() + 1;
            let token = self
                .users
                .entry(name.to_string())
                .or_insert_with(|| format!("<user-{next}>"))
                .clone();
            output.push_str(&token);
            index = name_start + end;
        }
        output.push_str(&text[index..]);
        output
    }

    fn redact_paths(&mut self, text: &str) -> String {
        let bytes = text.as_bytes();
        let mut output = String::with_capacity(text.len());
        let mut index = 0usize;
        while index < bytes.len() {
            let Some(start) = path_start(bytes, index) else {
                let Some(character) = text[index..].chars().next() else {
                    break;
                };
                output.push(character);
                index += character.len_utf8();
                continue;
            };
            if start > index {
                output.push_str(&text[index..start]);
            }
            let mut end = start;
            while end < bytes.len() && !is_path_end(bytes[end]) {
                end += 1;
            }
            let matched = &text[start..end];
            let next = self.paths.len() + 1;
            let token = self
                .paths
                .entry(matched.to_string())
                .or_insert_with(|| format!("<path-{next}>"))
                .clone();
            output.push_str(&token);
            index = end;
        }
        output
    }
}

/// A drive path (`C:\` or the JSON-escaped `C:\\`) or a UNC prefix.
fn path_start(bytes: &[u8], index: usize) -> Option<usize> {
    if index + 2 >= bytes.len() {
        return None;
    }
    let drive = bytes[index].is_ascii_alphabetic() && bytes[index + 1] == b':';
    if drive && (bytes[index + 2] == b'\\' || bytes[index + 2] == b'/') {
        return Some(index);
    }
    if bytes[index] == b'\\' && bytes[index + 1] == b'\\' {
        return Some(index);
    }
    None
}

/// Stop at a character that cannot be part of a path in ordinary log text.
/// The escaped JSON form uses double backslashes but no quote inside.
fn is_path_end(byte: u8) -> bool {
    matches!(
        byte,
        b'\n' | b'\r' | b'\t' | b' ' | b'"' | b'\'' | b'<' | b'>' | b'|' | b'*' | b'?' | b','
    )
}

#[cfg(test)]
mod tests {
    use super::Redactor;

    #[test]
    fn a_drive_path_and_its_user_are_masked() {
        let mut redactor = Redactor::new();
        let text = "opened C:\\Users\\alice\\Documents\\report.txt failed";
        let masked = redactor.redact(text);
        assert!(!masked.contains("alice"));
        assert!(!masked.contains("C:\\Users"));
        assert!(masked.contains("<user-1>") || masked.contains("<path-1>"));
    }

    #[test]
    fn unc_paths_are_masked() {
        let mut redactor = Redactor::new();
        let masked = redactor.redact("share \\\\server\\team\\report.txt is unavailable");
        assert!(!masked.contains("server"));
        assert!(masked.contains("<path-"));
    }

    #[test]
    fn escaped_json_paths_are_masked() {
        let mut redactor = Redactor::new();
        let text = r#"{"path":"C:\\Users\\alice\\secret.txt","other":1}"#;
        let masked = redactor.redact(text);
        assert!(!masked.contains("alice"));
        assert!(!masked.contains("secret.txt"));
        assert!(masked.contains("<user-1>") || masked.contains("<path-1>"));
    }

    #[test]
    fn tokens_are_stable_within_one_report() {
        let mut redactor = Redactor::new();
        let first = redactor.redact("C:\\Temp\\a.txt");
        let second = redactor.redact("C:\\Temp\\a.txt and C:\\Temp\\b.txt");
        assert_eq!(first, "<path-1>");
        assert!(second.starts_with("<path-1> and <path-2>"));
    }

    #[test]
    fn a_known_user_or_computer_name_is_masked_outside_a_path() {
        let mut redactor = Redactor::new();
        redactor.add_private_value("ALICE-PC", "<host-");
        redactor.add_private_value("alice", "<user-");
        let masked = redactor.redact("ALICE-PC started for alice");
        assert!(!masked.contains("ALICE-PC"));
        assert!(!masked.contains("alice"));
        assert!(masked.contains("<host-1>"));
        assert!(masked.contains("<user-1>"));
    }

    #[test]
    fn ordinary_words_are_kept() {
        let mut redactor = Redactor::new();
        assert_eq!(redactor.redact("no paths here"), "no paths here");
    }
}
