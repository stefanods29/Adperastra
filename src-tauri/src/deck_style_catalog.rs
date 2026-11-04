//! Bounded, atomic user-style catalog (Step 22b T3).
//!
//! `<data>/styles/deck/catalog.json` holds user styles only. Writes use the
//! crash-safe `atomic_write`; a stale expected revision or a built-in ID never
//! changes the file. A failed write leaves the previous catalog in place.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

use uuid::Uuid;

use crate::deck_style_types::{
    changed, invalid, too_large, validate_catalog, validate_deck_style, DeckStyle,
    DeckStyleCatalog, DECK_STYLE_SCHEMA_VERSION, MAX_DECK_STYLE_CATALOG_BYTES,
    MAX_SAFE_INTEGER, MAX_USER_DECK_STYLES,
};

pub const BUILTIN_STYLE_IDS: [&str; 8] = [
    "220b0001-0000-4000-8000-000000000000",
    "220b0002-0000-4000-8000-000000000000",
    "220b0003-0000-4000-8000-000000000000",
    "220b0004-0000-4000-8000-000000000000",
    "220b0005-0000-4000-8000-000000000000",
    "220b0006-0000-4000-8000-000000000000",
    "220b0007-0000-4000-8000-000000000000",
    "220b0008-0000-4000-8000-000000000000",
];

fn catalog_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// Serializes load-modify-write across editor windows in this process.
pub fn lock_catalog() -> Result<MutexGuard<'static, ()>, String> {
    catalog_lock()
        .lock()
        .map_err(|_| "deck_style.failed".to_string())
}

pub fn is_builtin_style_id(id: Uuid) -> bool {
    let text = id.to_string();
    BUILTIN_STYLE_IDS.contains(&text.as_str())
}

pub fn catalog_path(data_dir: &Path) -> PathBuf {
    data_dir.join("styles").join("deck").join("catalog.json")
}

pub fn empty_catalog() -> DeckStyleCatalog {
    DeckStyleCatalog {
        schema_version: DECK_STYLE_SCHEMA_VERSION,
        styles: Vec::new(),
        revision: 0,
    }
}

/// Read and validate the stored catalog. A missing file is an empty catalog;
/// a corrupt or newer file is refused, never reset.
pub fn load_catalog(path: &Path) -> Result<DeckStyleCatalog, String> {
    if !path.try_exists().map_err(|_| "deck_style.failed".to_string())? {
        return Ok(empty_catalog());
    }
    let metadata = std::fs::metadata(path).map_err(|_| "deck_style.failed".to_string())?;
    if metadata.len() > MAX_DECK_STYLE_CATALOG_BYTES as u64 {
        return Err(too_large());
    }
    let bytes = std::fs::read(path).map_err(|_| "deck_style.failed".to_string())?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
    let schema = value
        .get("schema_version")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(invalid)?;
    if schema > u64::from(DECK_STYLE_SCHEMA_VERSION) {
        return Err("deck_style.schema_newer".to_string());
    }
    if schema != u64::from(DECK_STYLE_SCHEMA_VERSION) {
        return Err(invalid());
    }
    let catalog: DeckStyleCatalog = serde_json::from_value(value).map_err(|_| invalid())?;
    validate_catalog(&catalog)?;
    Ok(catalog)
}

/// Write a validated catalog atomically. The caller holds `lock_catalog`.
pub fn save_catalog(path: &Path, catalog: &DeckStyleCatalog) -> Result<(), String> {
    validate_catalog(catalog)?;
    let bytes = serde_json::to_vec(catalog).map_err(|_| invalid())?;
    if bytes.len() > MAX_DECK_STYLE_CATALOG_BYTES {
        return Err(too_large());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|_| "deck_style.failed".to_string())?;
    }
    crate::atomic_write(path, &bytes).map_err(|_| "deck_style.failed".to_string())
}

fn next_revision(catalog: &DeckStyleCatalog) -> Result<u64, String> {
    catalog
        .revision
        .checked_add(1)
        .filter(|value| *value <= MAX_SAFE_INTEGER)
        .ok_or_else(too_large)
}

/// One atomic save. The returned catalog is the new file content; on any
/// failure the caller keeps the previous catalog.
pub fn apply_save(
    current: &DeckStyleCatalog,
    style: &DeckStyle,
    expected_revision: u64,
) -> Result<DeckStyleCatalog, String> {
    if expected_revision != current.revision {
        return Err(changed());
    }
    if style.builtin || is_builtin_style_id(style.id) {
        return Err(invalid());
    }
    validate_deck_style(style)?;
    let folded = style.name.as_deref().unwrap_or("").to_lowercase();
    if current.styles.iter().any(|existing| {
        existing.id != style.id && existing.name.as_deref().unwrap_or("").to_lowercase() == folded
    }) {
        return Err(invalid());
    }
    let mut next = current.clone();
    if let Some(position) = next.styles.iter().position(|existing| existing.id == style.id) {
        // Saving an existing user style edits that one entry in place; the
        // revision still advances and every entry keeps a unique name and ID.
        next.styles[position] = style.clone();
    } else {
        if current.styles.len() >= MAX_USER_DECK_STYLES {
            return Err(too_large());
        }
        next.styles.push(style.clone());
    }
    next.revision = next_revision(current)?;
    validate_catalog(&next)?;
    Ok(next)
}

/// One atomic remove. Built-in IDs are never present in the catalog, but the
/// explicit check keeps a forged request from creating a pseudo-builtin.
pub fn apply_remove(
    current: &DeckStyleCatalog,
    id: Uuid,
    expected_revision: u64,
) -> Result<DeckStyleCatalog, String> {
    if expected_revision != current.revision {
        return Err(changed());
    }
    if is_builtin_style_id(id) {
        return Err(invalid());
    }
    if !current.styles.iter().any(|style| style.id == id) {
        return Err(invalid());
    }
    let mut next = current.clone();
    next.styles.retain(|style| style.id != id);
    next.revision = next_revision(current)?;
    validate_catalog(&next)?;
    Ok(next)
}
