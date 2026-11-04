//! Keyboard map data mirrors (Step 10b, keyboard-map-1). Strokes are data:
//! modifier booleans, a key/code match mode and a key string. No command
//! code, paths or shell strings are deserialized.

use serde::{Deserialize, Serialize};

pub const MAX_CUSTOM_MAPS: usize = 20;
pub const MAX_BINDINGS_PER_MAP: usize = 500;
pub const MAX_MAP_NAME_CHARS: usize = 60;
pub const MAX_COMMAND_ID_CHARS: usize = 128;
pub const MAX_STROKE_KEY_CHARS: usize = 32;

pub const SCOPES: [&str; 9] = [
    "global", "explorer", "search", "text", "image", "pdf", "media", "office", "dialog",
];

pub const BUILTIN_MAP_IDS: [&str; 4] = [
    "builtin:windows",
    "builtin:finder",
    "builtin:commander",
    "builtin:vim",
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShortcutStroke {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub meta: bool,
    pub mode: String,
    pub key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ShortcutBinding {
    pub id: String,
    pub command_id: String,
    pub scope: String,
    pub strokes: Vec<ShortcutStroke>,
    pub enabled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeyboardMap {
    pub id: String,
    pub name: String,
    pub bindings: Vec<ShortcutBinding>,
    pub version: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeyboardCustomSettings {
    #[serde(default = "default_active_map")]
    pub active_map: String,
    #[serde(default)]
    pub custom_maps: Vec<KeyboardMap>,
    #[serde(default)]
    pub allow_bare_navigation: bool,
}

fn default_active_map() -> String {
    "builtin:windows".to_string()
}

impl Default for KeyboardCustomSettings {
    fn default() -> Self {
        Self {
            active_map: default_active_map(),
            custom_maps: Vec::new(),
            allow_bare_navigation: false,
        }
    }
}

fn char_count(text: &str) -> usize {
    text.chars().count()
}

/// The stored form of a key name, matching the TypeScript normalizer:
/// long names for Space, Escape, Delete and the arrows, lower-case single
/// letters. Other names are kept as they are.
fn normalize_key_name(raw: &str) -> String {
    let aliased = match raw {
        " " | "Spacebar" => "Space",
        "Esc" => "Escape",
        "Left" => "ArrowLeft",
        "Right" => "ArrowRight",
        "Up" => "ArrowUp",
        "Down" => "ArrowDown",
        "Del" => "Delete",
        other => other,
    };
    if aliased.len() == 1 && aliased.as_bytes()[0].is_ascii_alphabetic() {
        aliased.to_ascii_lowercase()
    } else {
        aliased.to_string()
    }
}

fn is_uuid(text: &str) -> bool {
    let parts: Vec<&str> = text.split('-').collect();
    if parts.len() != 5 {
        return false;
    }
    let lengths = [8usize, 4, 4, 4, 12];
    parts
        .iter()
        .zip(lengths.iter())
        .all(|(part, len)| part.len() == *len && part.chars().all(|c| c.is_ascii_hexdigit()))
}

fn scopes_overlap(a: &str, b: &str) -> bool {
    a == b || a == "global" || b == "global"
}

fn is_reserved(stroke: &ShortcutStroke, scope: &str) -> bool {
    if stroke.meta {
        return true;
    }
    if stroke.alt && stroke.key == "Tab" {
        return true;
    }
    if stroke.alt && stroke.key == "F4" {
        return true;
    }
    if stroke.ctrl && stroke.alt && stroke.key == "Delete" {
        return true;
    }
    if scope == "global" && stroke.ctrl && !stroke.alt {
        let letters = ["z", "y", "c", "x", "v", "a"];
        let codes = ["KeyZ", "KeyY", "KeyC", "KeyX", "KeyV", "KeyA"];
        if stroke.mode == "key" && letters.contains(&stroke.key.as_str()) {
            return true;
        }
        if stroke.mode == "code" && codes.contains(&stroke.key.as_str()) {
            return true;
        }
    }
    false
}

/// Validate one map. Errors are the stable codes keyboard.invalid,
/// keyboard.conflict and keyboard.limit. Unknown command ids are
/// accepted: they stay disabled and are never executed.
pub fn validate_keyboard_map(map: &KeyboardMap) -> Result<(), String> {
    if !BUILTIN_MAP_IDS.contains(&map.id.as_str()) && !is_uuid(&map.id) {
        return Err("keyboard.invalid".to_string());
    }
    if map.name.is_empty() || char_count(&map.name) > MAX_MAP_NAME_CHARS {
        return Err("keyboard.invalid".to_string());
    }
    if map.version != 1 {
        return Err("keyboard.invalid".to_string());
    }
    if map.bindings.len() > MAX_BINDINGS_PER_MAP {
        return Err("keyboard.limit".to_string());
    }
    let mut binding_ids: Vec<&str> = Vec::with_capacity(map.bindings.len());
    for binding in &map.bindings {
        if binding_ids.contains(&binding.id.as_str()) {
            return Err("keyboard.invalid".to_string());
        }
        binding_ids.push(binding.id.as_str());
        if !is_uuid(&binding.id) {
            return Err("keyboard.invalid".to_string());
        }
        if binding.command_id.is_empty() || char_count(&binding.command_id) > MAX_COMMAND_ID_CHARS {
            return Err("keyboard.invalid".to_string());
        }
        if !SCOPES.contains(&binding.scope.as_str()) {
            return Err("keyboard.invalid".to_string());
        }
        if binding.strokes.len() != 1 && binding.strokes.len() != 2 {
            return Err("keyboard.invalid".to_string());
        }
        for stroke in &binding.strokes {
            if stroke.mode != "key" && stroke.mode != "code" {
                return Err("keyboard.invalid".to_string());
            }
            if stroke.key.is_empty() || char_count(&stroke.key) > MAX_STROKE_KEY_CHARS {
                return Err("keyboard.invalid".to_string());
            }
            if is_reserved(stroke, &binding.scope) {
                return Err("keyboard.conflict".to_string());
            }
        }
    }
    for (index, binding) in map.bindings.iter().enumerate() {
        if !binding.enabled {
            continue;
        }
        for other in map.bindings.iter().skip(index + 1) {
            if !other.enabled || !scopes_overlap(&binding.scope, &other.scope) {
                continue;
            }
            let same = binding.strokes.len() == other.strokes.len()
                && binding
                    .strokes
                    .iter()
                    .zip(other.strokes.iter())
                    .all(|(a, b)| {
                        a.ctrl == b.ctrl
                            && a.alt == b.alt
                            && a.shift == b.shift
                            && a.meta == b.meta
                            && a.mode == b.mode
                            && a.key == b.key
                    });
            let prefix = binding.strokes.len() != other.strokes.len()
                && binding
                    .strokes
                    .iter()
                    .zip(other.strokes.iter())
                    .all(|(a, b)| {
                        a.ctrl == b.ctrl
                            && a.alt == b.alt
                            && a.shift == b.shift
                            && a.meta == b.meta
                            && a.mode == b.mode
                            && a.key == b.key
                    });
            if same || prefix {
                return Err("keyboard.conflict".to_string());
            }
        }
    }
    Ok(())
}

/// Validate the whole keyboard section; a 21st custom map is refused.
pub fn validate_keyboard_custom_settings(
    settings: &KeyboardCustomSettings,
) -> Result<(), String> {
    if settings.custom_maps.len() > MAX_CUSTOM_MAPS {
        return Err("keyboard.limit".to_string());
    }
    for map in &settings.custom_maps {
        validate_keyboard_map(map)?;
    }
    Ok(())
}

/// A copy with every stroke key in its stored form (see `normalize_key_name`),
/// matching the TypeScript `normalizeStroke`.
pub fn normalize_keyboard_map(map: &KeyboardMap) -> KeyboardMap {
    let mut normalized = map.clone();
    for binding in &mut normalized.bindings {
        for stroke in &mut binding.strokes {
            stroke.key = normalize_key_name(&stroke.key);
        }
    }
    normalized
}

/// Normalize then validate one map; the caller stores the returned value.
pub fn normalize_and_validate_keyboard_map(map: &KeyboardMap) -> Result<KeyboardMap, String> {
    let normalized = normalize_keyboard_map(map);
    validate_keyboard_map(&normalized)?;
    Ok(normalized)
}

/// Apply one map to the keyboard section and return its stored, normalized
/// form. A custom map (UUID) replaces the map with the same id or is appended
/// up to MAX_CUSTOM_MAPS, and becomes active. A builtin preset is never copied
/// into custom_maps: choosing one only moves active_map, so preset activation
/// stays on the ordinary settings path. The section is unchanged on error.
pub fn apply_keyboard_map(
    settings: &mut KeyboardCustomSettings,
    map: &KeyboardMap,
) -> Result<KeyboardMap, String> {
    let normalized = normalize_and_validate_keyboard_map(map)?;
    let mut next = settings.clone();
    next.active_map = normalized.id.clone();
    if !BUILTIN_MAP_IDS.contains(&normalized.id.as_str()) {
        match next
            .custom_maps
            .iter()
            .position(|existing| existing.id == normalized.id)
        {
            Some(index) => next.custom_maps[index] = normalized.clone(),
            None => {
                if next.custom_maps.len() >= MAX_CUSTOM_MAPS {
                    return Err("keyboard.limit".to_string());
                }
                next.custom_maps.push(normalized.clone());
            }
        }
    }
    validate_keyboard_custom_settings(&next)?;
    *settings = next;
    Ok(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding(id: &str, command_id: &str, key: &str) -> ShortcutBinding {
        ShortcutBinding {
            id: id.to_string(),
            command_id: command_id.to_string(),
            scope: "explorer".to_string(),
            strokes: vec![ShortcutStroke {
                ctrl: false,
                alt: false,
                shift: false,
                meta: false,
                mode: "key".to_string(),
                key: key.to_string(),
            }],
            enabled: true,
        }
    }

    fn map_with(bindings: Vec<ShortcutBinding>) -> KeyboardMap {
        KeyboardMap {
            id: "builtin:windows".to_string(),
            name: "Windows".to_string(),
            bindings,
            version: 1,
        }
    }

    #[test]
    fn twenty_first_map_refused() {
        let settings = KeyboardCustomSettings {
            active_map: "builtin:windows".to_string(),
            custom_maps: (0..21).map(|_| map_with(vec![])).collect(),
            allow_bare_navigation: false,
        };
        assert_eq!(
            validate_keyboard_custom_settings(&settings),
            Err("keyboard.limit".to_string())
        );
        let ok = KeyboardCustomSettings {
            custom_maps: (0..20).map(|_| map_with(vec![])).collect(),
            ..settings
        };
        assert!(validate_keyboard_custom_settings(&ok).is_ok());
    }

    #[test]
    fn reserved_and_prefix_conflicts_refused() {
        let reserved = map_with(vec![binding(
            "123e4567-e89b-42d3-a456-426614174000",
            "app.close",
            "Tab",
        )]);
        let mut reserved = reserved;
        reserved.bindings[0].strokes[0].alt = true;
        assert_eq!(
            validate_keyboard_map(&reserved),
            Err("keyboard.conflict".to_string())
        );

        let prefix = map_with(vec![
            binding("123e4567-e89b-42d3-a456-426614174001", "a.one", "g"),
            ShortcutBinding {
                strokes: vec![
                    ShortcutStroke {
                        ctrl: false,
                        alt: false,
                        shift: false,
                        meta: false,
                        mode: "key".to_string(),
                        key: "g".to_string(),
                    },
                    ShortcutStroke {
                        ctrl: false,
                        alt: false,
                        shift: false,
                        meta: false,
                        mode: "key".to_string(),
                        key: "g".to_string(),
                    },
                ],
                ..binding("123e4567-e89b-42d3-a456-426614174002", "a.two", "g")
            },
        ]);
        assert_eq!(
            validate_keyboard_map(&prefix),
            Err("keyboard.conflict".to_string())
        );
    }
}
