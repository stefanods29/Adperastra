//! Embedded setup-window strings (en + es). All user-visible text lives
//! in `locales/*.json`; `{name}`/`{space}` placeholders stay literal here.

use std::collections::BTreeMap;
use std::sync::OnceLock;

static EN_JSON: &str = include_str!("../locales/en.json");
static ES_JSON: &str = include_str!("../locales/es.json");

fn en_map() -> &'static BTreeMap<String, String> {
    static MAP: OnceLock<BTreeMap<String, String>> = OnceLock::new();
    MAP.get_or_init(|| parse(EN_JSON))
}

fn es_map() -> &'static BTreeMap<String, String> {
    static MAP: OnceLock<BTreeMap<String, String>> = OnceLock::new();
    MAP.get_or_init(|| parse(ES_JSON))
}

fn parse(text: &str) -> BTreeMap<String, String> {
    serde_json::from_str(text).unwrap_or_default()
}

fn map_for(lang: &str) -> &'static BTreeMap<String, String> {
    if lang == "es" {
        es_map()
    } else {
        en_map()
    }
}

/// Translates `key` for `lang` ("es" -> Spanish, anything else -> English).
/// Missing keys fall back to English, then to the key itself.
pub fn t(lang: &str, key: &str) -> String {
    if let Some(v) = map_for(lang).get(key) {
        return v.clone();
    }
    if let Some(v) = en_map().get(key) {
        return v.clone();
    }
    key.to_string()
}

/// Sorted keys available for `lang` ("es" -> Spanish, else English).
pub fn keys_for(lang: &str) -> Vec<String> {
    map_for(lang).keys().cloned().collect()
}

/// Sorted English keys (the canonical key set).
pub fn available_keys() -> Vec<String> {
    keys_for("en")
}
