//! The custom-theme token whitelist (Step 10a).
//!
//! A custom theme may change only paths that exist in the generated
//! `themes/light.tokens.json` schema. Notes (`_note`, `_source`, `_derived`)
//! are not tokens. `font.family` is chosen through `ui_font`, and `shadow.*`
//! strings are excluded because they are raw CSS.
//!
//! Generation is the mirror of `scripts/build-tokens.mjs` and
//! `src/appearance/themeTokens.ts`: the same custom property names and the
//! same `px` suffix for font-size, radius and space numbers. Color values are
//! normalized in `theme_data`; every generated name or value comes from the
//! whitelist below, never from caller-provided CSS text.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenKind {
    Color,
    FontSize,
    Radius,
    Space,
}

pub const COLOR_PATHS: &[&str] = &[
    "color.surface.window",
    "color.surface.chrome",
    "color.surface.pane",
    "color.surface.sidebar",
    "color.surface.selected",
    "color.surface.tabInactive",
    "color.surface.header",
    "color.surface.segmentTrack",
    "color.surface.canvasDoc",
    "color.surface.canvasMedia",
    "color.surface.selectedRow",
    "color.text.primary",
    "color.text.secondary",
    "color.text.tertiary",
    "color.text.bodyMuted",
    "color.text.onAccent",
    "color.border.default",
    "color.border.subtle",
    "color.border.panel",
    "color.border.input",
    "color.border.chip",
    "color.accent.explorer",
    "color.accent.excel",
    "color.accent.word",
    "color.accent.pdf",
    "color.accent.image",
    "color.accent.powerpoint",
    "color.accent.group",
    "color.accentDark.excel",
    "color.accentDark.word",
    "color.accentLight.explorer",
    "color.accentLight.excel",
    "color.accentLight.word",
    "color.accentLight.image",
    "color.accentLight.group",
    "color.status.caution",
    "color.status.cautionBackground",
    "syntax.keyword",
    "syntax.string",
    "syntax.number",
    "syntax.comment",
    "syntax.function",
    "syntax.type",
    "syntax.tag",
    "syntax.attribute",
    "syntax.property",
    "syntax.invalid",
    "syntax.match",
    "syntax.matchSelected",
];

pub const FONT_SIZE_PATHS: &[&str] = &[
    "font.size.tiny",
    "font.size.caption",
    "font.size.small",
    "font.size.body",
    "font.size.command",
    "font.size.section",
    "font.size.gallerySample",
];

pub const RADIUS_PATHS: &[&str] = &[
    "radius.xs",
    "radius.sm",
    "radius.md",
    "radius.lg",
    "radius.xl",
    "radius.pill",
    "radius.round",
];

pub const SPACE_PATHS: &[&str] = &[
    "space.0", "space.1", "space.2", "space.3", "space.4", "space.5", "space.6", "space.7",
    "space.8", "space.9", "space.10",
];

/// The twelve syntax colours are also the editor-surface allowlist.
pub const THEME_EDITOR_TOKEN_PATHS: &[&str] = &[
    "syntax.keyword",
    "syntax.string",
    "syntax.number",
    "syntax.comment",
    "syntax.function",
    "syntax.type",
    "syntax.tag",
    "syntax.attribute",
    "syntax.property",
    "syntax.invalid",
    "syntax.match",
    "syntax.matchSelected",
];

pub fn token_kind(path: &str) -> Option<TokenKind> {
    if COLOR_PATHS.contains(&path) {
        return Some(TokenKind::Color);
    }
    if FONT_SIZE_PATHS.contains(&path) {
        return Some(TokenKind::FontSize);
    }
    if RADIUS_PATHS.contains(&path) {
        return Some(TokenKind::Radius);
    }
    if SPACE_PATHS.contains(&path) {
        return Some(TokenKind::Space);
    }
    None
}

pub fn is_theme_token(path: &str) -> bool {
    token_kind(path).is_some()
}

pub fn is_editor_token(path: &str) -> bool {
    THEME_EDITOR_TOKEN_PATHS.contains(&path)
}

/// Inclusive pixel bounds for numeric tokens.
pub fn token_bounds(path: &str) -> Option<(f64, f64)> {
    match token_kind(path)? {
        TokenKind::Color => None,
        TokenKind::FontSize => Some((8.0, 48.0)),
        TokenKind::Radius => Some((0.0, 32.0)),
        TokenKind::Space => Some((0.0, 64.0)),
    }
}

/// Alpha is accepted only for surfaces, accent-light fills and the two
/// syntax match fills, exactly like `themeTokenAllowsAlpha` in the UI.
pub fn token_allows_alpha(path: &str) -> bool {
    path.starts_with("color.surface.")
        || path.starts_with("color.accentLight.")
        || path == "syntax.match"
        || path == "syntax.matchSelected"
}

/// The CSS value for one numeric token: finite, inside the token's inclusive
/// bounds, and written with the same `px` suffix as `scripts/build-tokens.mjs`
/// and `themeTokenCss`. Colors and unknown paths return `None`, so a generated
/// declaration can never carry arbitrary CSS.
pub fn numeric_token_css(path: &str, value: f64) -> Option<String> {
    if !value.is_finite() {
        return None;
    }
    let (min, max) = token_bounds(path)?;
    if value < min || value > max {
        return None;
    }
    Some(format!("{value}px"))
}

fn kebab(key: &str) -> String {
    let mut out = String::with_capacity(key.len() + 4);
    let chars: Vec<char> = key.chars().collect();
    for (index, character) in chars.iter().enumerate() {
        if character.is_ascii_uppercase() {
            let previous_is_lower = index > 0
                && (chars[index - 1].is_ascii_lowercase() || chars[index - 1].is_ascii_digit());
            let next_is_lower = index + 1 < chars.len() && chars[index + 1].is_ascii_lowercase();
            if previous_is_lower
                || (index > 0 && next_is_lower && chars[index - 1].is_ascii_uppercase())
            {
                out.push('-');
            }
            out.push(character.to_ascii_lowercase());
        } else {
            out.push(*character);
        }
    }
    out
}

/// The CSS custom property name, exactly like `scripts/build-tokens.mjs`.
pub fn theme_variable_name(path: &str) -> Option<String> {
    if !is_theme_token(path) {
        return None;
    }
    let parts: Vec<&str> = path.split('.').collect();
    let name = match parts.as_slice() {
        ["color", "accent", name] => format!("--adp-accent-{}", kebab(name)),
        ["color", "accentDark", name] => format!("--adp-accent-dark-{}", kebab(name)),
        ["color", "accentLight", name] => format!("--adp-accent-light-{}", kebab(name)),
        ["font", "size", name] => format!("--adp-font-{}", kebab(name)),
        ["space", index] => format!("--adp-space-{index}"),
        _ => format!(
            "--adp-{}",
            parts
                .iter()
                .map(|part| kebab(part))
                .collect::<Vec<_>>()
                .join("-")
        ),
    };
    Some(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    fn json_leaf_paths(
        value: &serde_json::Value,
        prefix: &mut Vec<String>,
        out: &mut BTreeSet<String>,
    ) {
        match value {
            serde_json::Value::Object(map) => {
                for (key, child) in map {
                    if key.starts_with('_') {
                        continue;
                    }
                    prefix.push(key.clone());
                    json_leaf_paths(child, prefix, out);
                    prefix.pop();
                }
            }
            serde_json::Value::Array(items) => {
                for (index, child) in items.iter().enumerate() {
                    prefix.push(index.to_string());
                    json_leaf_paths(child, prefix, out);
                    prefix.pop();
                }
            }
            _ => {
                out.insert(prefix.join("."));
            }
        }
    }

    #[test]
    fn whitelist_covers_the_light_token_schema_without_notes() {
        let raw = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../themes/light.tokens.json"
        ));
        let json: serde_json::Value = serde_json::from_str(raw).unwrap();
        let mut leaves = BTreeSet::new();
        json_leaf_paths(&json, &mut Vec::new(), &mut leaves);
        for path in &leaves {
            if path == "font.family" || path.starts_with("shadow.") {
                continue;
            }
            assert!(is_theme_token(path), "missing token whitelist entry {path}");
        }
    }

    #[test]
    fn variable_names_match_the_generator() {
        assert_eq!(
            theme_variable_name("color.accent.explorer").as_deref(),
            Some("--adp-accent-explorer")
        );
        assert_eq!(
            theme_variable_name("color.surface.selectedRow").as_deref(),
            Some("--adp-color-surface-selected-row")
        );
        assert_eq!(
            theme_variable_name("color.status.cautionBackground").as_deref(),
            Some("--adp-color-status-caution-background")
        );
        assert_eq!(
            theme_variable_name("font.size.gallerySample").as_deref(),
            Some("--adp-font-gallery-sample")
        );
        assert_eq!(
            theme_variable_name("radius.pill").as_deref(),
            Some("--adp-radius-pill")
        );
        assert_eq!(
            theme_variable_name("space.3").as_deref(),
            Some("--adp-space-3")
        );
        assert_eq!(
            theme_variable_name("syntax.keyword").as_deref(),
            Some("--adp-syntax-keyword")
        );
        assert_eq!(theme_variable_name("font.family"), None);
        assert_eq!(theme_variable_name("shadow.page"), None);
        assert_eq!(theme_variable_name("color.nope"), None);
    }

    #[test]
    fn whitelist_entries_exist_in_the_light_schema() {
        let raw = include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../themes/light.tokens.json"
        ));
        let json: serde_json::Value = serde_json::from_str(raw).unwrap();
        let mut leaves = BTreeSet::new();
        json_leaf_paths(&json, &mut Vec::new(), &mut leaves);
        let mut names = BTreeSet::new();
        for path in COLOR_PATHS
            .iter()
            .chain(FONT_SIZE_PATHS)
            .chain(RADIUS_PATHS)
            .chain(SPACE_PATHS)
        {
            assert!(
                leaves.contains(*path),
                "whitelisted path is not in the schema: {path}"
            );
            let name = theme_variable_name(path).expect("whitelisted token has a variable name");
            assert!(name.starts_with("--adp-"));
            assert!(names.insert(name), "duplicate variable name for {path}");
        }
        assert_eq!(
            names.len(),
            COLOR_PATHS.len() + FONT_SIZE_PATHS.len() + RADIUS_PATHS.len() + SPACE_PATHS.len()
        );
    }

    #[test]
    fn numeric_token_css_matches_the_generator() {
        assert_eq!(
            numeric_token_css("font.size.body", 12.0).as_deref(),
            Some("12px")
        );
        assert_eq!(
            numeric_token_css("radius.round", 16.0).as_deref(),
            Some("16px")
        );
        assert_eq!(numeric_token_css("space.0", 0.0).as_deref(), Some("0px"));
        assert_eq!(numeric_token_css("space.10", 25.0).as_deref(), Some("25px"));
        assert_eq!(numeric_token_css("font.size.body", 7.9), None);
        assert_eq!(numeric_token_css("font.size.body", 48.1), None);
        assert_eq!(numeric_token_css("space.0", -1.0), None);
        assert_eq!(numeric_token_css("color.surface.window", 1.0), None);
        assert_eq!(numeric_token_css("color.nope", 1.0), None);
        assert_eq!(numeric_token_css("font.size.body", f64::NAN), None);
        assert_eq!(numeric_token_css("font.size.body", f64::INFINITY), None);
    }

    #[test]
    fn notes_are_not_tokens() {
        assert_eq!(token_kind("_note"), None);
        assert_eq!(token_kind("color.surface._note"), None);
    }
}
