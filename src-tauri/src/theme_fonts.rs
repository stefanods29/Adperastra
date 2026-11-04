//! Installed font family names for custom themes (Step 10a).
//!
//! Only names are enumerated; no font file, byte or license is copied into a
//! theme. The callback copies bounded UTF-16 names before returning, because
//! the pointer Windows passes is valid only for the synchronous call.

use tauri::WebviewWindow;

use crate::ensure_main;

pub const MAX_FONT_FAMILIES: usize = 1000;
pub const MAX_FAMILY_CHARS: usize = 128;

pub fn is_builtin_font(name: &str) -> bool {
    name == "Inter" || name == "system-ui"
}

fn clean_family(name: &str) -> Option<String> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed.starts_with('@') {
        return None;
    }
    if trimmed.chars().count() > MAX_FAMILY_CHARS {
        return None;
    }
    if trimmed.chars().any(|character| {
        character.is_control() || matches!(character, ';' | '{' | '}' | '<' | '>' | '"' | '\\')
    }) {
        return None;
    }
    Some(trimmed.to_string())
}

/// Unique family names in ordinal (UTF-16) order. This is a small, bounded
/// list; the UI shows at most 1000 entries.
pub fn normalize_families(names: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::BTreeSet::new();
    let mut result = Vec::new();
    for name in names {
        let Some(clean) = clean_family(&name) else {
            continue;
        };
        if !seen.insert(clean.to_lowercase()) {
            continue;
        }
        result.push(clean);
        if result.len() >= MAX_FONT_FAMILIES {
            break;
        }
    }
    result.sort_by(|left, right| left.encode_utf16().cmp(right.encode_utf16()));
    result
}

#[cfg(windows)]
unsafe extern "system" fn collect_family(
    logfont: *const windows::Win32::Graphics::Gdi::LOGFONTW,
    _metric: *const windows::Win32::Graphics::Gdi::TEXTMETRICW,
    _font_type: u32,
    lparam: windows::Win32::Foundation::LPARAM,
) -> i32 {
    let list = &mut *(lparam.0 as *mut Vec<String>);
    if list.len() >= MAX_FONT_FAMILIES {
        return 0;
    }
    if logfont.is_null() {
        return 1;
    }
    // SAFETY: the callback contract gives a valid LOGFONTW for this call.
    let face = unsafe { &(*logfont).lfFaceName };
    let length = face.iter().position(|unit| *unit == 0).unwrap_or(face.len());
    if length == 0 {
        return 1;
    }
    if let Some(name) = clean_family(&String::from_utf16_lossy(&face[..length])) {
        list.push(name);
    }
    1
}

#[cfg(windows)]
#[allow(clippy::field_reassign_with_default)]
pub fn system_font_families() -> Vec<String> {
    use windows::Win32::Foundation::LPARAM;
    use windows::Win32::Graphics::Gdi::{
        EnumFontFamiliesExW, GetDC, ReleaseDC, DEFAULT_CHARSET, LOGFONTW,
    };
    let mut names: Vec<String> = Vec::new();
    // SAFETY: EnumFontFamiliesExW is synchronous; the DC and the callback's
    // output list outlive it, and the callback copies each name immediately.
    unsafe {
        let hdc = GetDC(None);
        if hdc.0.is_null() {
            return Vec::new();
        }
        let mut logfont = LOGFONTW::default();
        logfont.lfCharSet = DEFAULT_CHARSET;
        let _ = EnumFontFamiliesExW(
            hdc,
            &logfont,
            Some(collect_family),
            LPARAM((&mut names as *mut Vec<String>) as isize),
            0,
        );
        let _ = ReleaseDC(None, hdc);
    }
    normalize_families(names)
}

#[cfg(not(windows))]
pub fn system_font_families() -> Vec<String> {
    Vec::new()
}

/// A theme may reference a builtin or an installed family only.
pub fn ensure_font_allowed(name: &str) -> Result<(), String> {
    if is_builtin_font(name) {
        return Ok(());
    }
    if system_font_families()
        .iter()
        .any(|installed| installed.eq_ignore_ascii_case(name))
    {
        return Ok(());
    }
    Err("theme.invalid".to_string())
}

#[tauri::command]
pub async fn theme_system_fonts(window: WebviewWindow) -> Result<Vec<String>, String> {
    ensure_main(window.label())?;
    tauri::async_runtime::spawn_blocking(system_font_families)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_fonts_are_allowed_without_enumeration() {
        assert!(is_builtin_font("Inter"));
        assert!(is_builtin_font("system-ui"));
        assert!(!is_builtin_font("Segoe UI"));
    }

    #[test]
    fn families_are_unique_clean_and_bounded() {
        let names = vec![
            " Segoe UI ".to_string(),
            "segoe ui".to_string(),
            "@Malgun Gothic".to_string(),
            ";bad".to_string(),
            "Arial".to_string(),
        ];
        assert_eq!(normalize_families(names), vec!["Arial".to_string(), "Segoe UI".to_string()]);
    }

    #[test]
    fn long_and_control_names_are_refused() {
        assert!(clean_family(&"x".repeat(MAX_FAMILY_CHARS + 1)).is_none());
        assert!(clean_family("bad\u{0007}name").is_none());
    }
}
