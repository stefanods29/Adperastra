#![allow(dead_code)] // Public producer API; consumed from later steps.
//! Recognition language priority (Step 07e plan D2).
//!
//! Windows owns the installed list; this module only applies the policy:
//! exact app language first, then another installed tag with the same
//! primary language, then the Windows user-profile OCR language when it
//! belongs to the same primary language. An unrelated language is never
//! chosen silently, and a missing language is an explicit error.
//!
//! The helper and the service both call this module, so the rule exists
//! once on the native side. `chooseOcrLanguage` in `src/services/ocr.ts`
//! mirrors it for the Settings preview; the native answer is authoritative.

use serde::{Deserialize, Serialize};

use crate::ocr_types::{
    is_valid_language_tag, OcrLanguage, ERR_BAD_REQUEST, ERR_LANGUAGE_MISSING, MAX_OCR_LANGUAGES,
    MAX_OCR_LANGUAGE_NAME,
};

/// What one `ocr_languages` answer carries. The user-profile tag is a hint
/// for `auto`, never a separate saved preference.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct OcrLanguagesReply {
    pub languages: Vec<OcrLanguage>,
    #[serde(default)]
    pub user_profile: Option<String>,
}

/// Why a language could not be chosen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LanguageError {
    BadRequest,
    Missing,
}

impl LanguageError {
    pub fn code(self) -> &'static str {
        match self {
            LanguageError::BadRequest => ERR_BAD_REQUEST,
            LanguageError::Missing => ERR_LANGUAGE_MISSING,
        }
    }
}

/// The part before the first hyphen, lower case. `es-419` -> `es`.
pub fn primary_language(tag: &str) -> Option<String> {
    if !is_valid_language_tag(tag) {
        return None;
    }
    tag.split('-')
        .next()
        .map(|primary| primary.to_ascii_lowercase())
}

/// Clean a Windows list before it reaches Settings or a cache key: bounded,
/// valid tags only, one entry per tag (case-insensitive), names bounded.
pub fn normalize_languages(languages: Vec<OcrLanguage>) -> Vec<OcrLanguage> {
    let mut result: Vec<OcrLanguage> = Vec::new();
    for mut language in languages {
        if result.len() >= MAX_OCR_LANGUAGES {
            break;
        }
        language.tag = language.tag.trim().to_string();
        language.name = language.name.trim().to_string();
        if !is_valid_language_tag(&language.tag) {
            continue;
        }
        if language.name.is_empty() {
            language.name = language.tag.clone();
        }
        if language.name.chars().count() > MAX_OCR_LANGUAGE_NAME {
            language.name = language.name.chars().take(MAX_OCR_LANGUAGE_NAME).collect();
        }
        if result
            .iter()
            .any(|existing| existing.tag.eq_ignore_ascii_case(&language.tag))
        {
            continue;
        }
        language.available = true;
        result.push(language);
    }
    result
}

fn installed_tag<'a>(installed: &'a [OcrLanguage], tag: &str) -> Option<&'a str> {
    installed
        .iter()
        .find(|language| language.available && language.tag.eq_ignore_ascii_case(tag))
        .map(|language| language.tag.as_str())
}

fn same_primary_tag<'a>(installed: &'a [OcrLanguage], primary: &str) -> Option<&'a str> {
    installed
        .iter()
        .find(|language| {
            language.available
                && primary_language(&language.tag).is_some_and(|candidate| candidate == primary)
        })
        .map(|language| language.tag.as_str())
}

/// Resolve `auto` or an explicit tag to the exact installed tag.
///
/// `app_language` is the app setting (`en`, `es`, `pseudo`); `user_profile`
/// is the language `OcrEngine.TryCreateFromUserProfileLanguages` uses, when
/// Windows reports one.
pub fn select_language(
    preference: &str,
    app_language: &str,
    installed: &[OcrLanguage],
    user_profile: Option<&str>,
) -> Result<String, LanguageError> {
    if preference != "auto" {
        if !is_valid_language_tag(preference) {
            return Err(LanguageError::BadRequest);
        }
        return installed_tag(installed, preference)
            .map(str::to_string)
            .ok_or(LanguageError::Missing);
    }

    // A pseudo-locale has no Windows recogniser; do not guess.
    if app_language == "pseudo" {
        return Err(LanguageError::Missing);
    }
    let Some(app_primary) = primary_language(app_language) else {
        return Err(LanguageError::Missing);
    };

    // 1. The app's own language, in any installed region.
    if let Some(tag) = same_primary_tag(installed, &app_primary) {
        return Ok(tag.to_string());
    }

    // 2. The Windows profile language, but only inside the same primary
    //    language. This is what keeps "app en, only es installed" missing
    //    instead of silently recognising Spanish.
    if let Some(profile) = user_profile {
        if primary_language(profile).as_deref() == Some(app_primary.as_str()) {
            if let Some(tag) = installed_tag(installed, profile) {
                return Ok(tag.to_string());
            }
        }
    }

    Err(LanguageError::Missing)
}

#[cfg(test)]
mod tests {
    use super::{normalize_languages, select_language, LanguageError};
    use crate::ocr_types::OcrLanguage;

    fn language(tag: &str, name: &str) -> OcrLanguage {
        OcrLanguage {
            tag: tag.to_string(),
            name: name.to_string(),
            available: true,
        }
    }

    #[test]
    fn auto_uses_the_app_language() {
        let installed = [
            language("en-US", "English (United States)"),
            language("es-ES", "Spanish (Spain)"),
        ];
        assert_eq!(
            select_language("auto", "es", &installed, None),
            Ok("es-ES".to_string())
        );
        assert_eq!(
            select_language("auto", "en", &installed, None),
            Ok("en-US".to_string())
        );
    }

    #[test]
    fn auto_never_switches_to_an_unrelated_language() {
        let installed = [language("es-ES", "Spanish (Spain)")];
        assert_eq!(
            select_language("auto", "en", &installed, None),
            Err(LanguageError::Missing)
        );
        assert_eq!(
            select_language("auto", "en", &installed, Some("es-ES")),
            Err(LanguageError::Missing)
        );
    }

    #[test]
    fn auto_accepts_a_profile_region_of_the_same_language() {
        let installed = [
            language("en-GB", "English (United Kingdom)"),
            language("es-ES", "Spanish (Spain)"),
        ];
        assert_eq!(
            select_language("auto", "en", &installed, Some("en-US")),
            Ok("en-GB".to_string())
        );
    }

    #[test]
    fn explicit_tags_must_be_installed_and_valid() {
        let installed = [language("en-US", "English (United States)")];
        assert_eq!(
            select_language("en-us", "en", &installed, None),
            Ok("en-US".to_string())
        );
        assert_eq!(
            select_language("fr-FR", "en", &installed, None),
            Err(LanguageError::Missing)
        );
        assert_eq!(
            select_language("not a tag!", "en", &installed, None),
            Err(LanguageError::BadRequest)
        );
    }

    #[test]
    fn lists_are_bounded_and_deduplicated() {
        let mut input = vec![
            language(" en-US ", "English"),
            language("EN-us", "duplicate"),
            language("bad tag", "bad"),
        ];
        for index in 0..200 {
            // Letters only: a primary language subtag can never contain digits.
            let first = (b'a' + (index % 26) as u8) as char;
            let second = (b'a' + (index / 26) as u8) as char;
            input.push(language(&format!("l{first}{second}"), "x"));
        }
        let cleaned = normalize_languages(input);
        assert!(cleaned.len() <= 128);
        assert_eq!(
            cleaned
                .iter()
                .filter(|entry| entry.tag.eq_ignore_ascii_case("en-US"))
                .count(),
            1
        );
        assert!(!cleaned.iter().any(|entry| entry.tag == "bad tag"));
    }
}
