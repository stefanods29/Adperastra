//! Main-window IPC for the user deck-style catalog (Step 22b T3).
//!
//! Commands are main-only, validate every argument and never accept an
//! arbitrary path. The catalog lives under the app data folder.

use tauri::WebviewWindow;
use uuid::Uuid;

use crate::deck_style_catalog::{
    apply_remove, apply_save, catalog_path, load_catalog, lock_catalog, save_catalog,
};
use crate::deck_style_types::{
    invalid, DeckStyle, DeckStyleCatalog, MAX_SAFE_INTEGER,
};
use crate::{ensure_main, resolve_data_dir};

fn data_path() -> std::path::PathBuf {
    catalog_path(&resolve_data_dir())
}

fn checked_revision(expected_revision: u64) -> Result<u64, String> {
    if expected_revision > MAX_SAFE_INTEGER {
        return Err(invalid());
    }
    Ok(expected_revision)
}

#[tauri::command]
pub async fn deck_styles_list(window: WebviewWindow) -> Result<DeckStyleCatalog, String> {
    ensure_main(window.label())?;
    let path = data_path();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock_catalog()?;
        load_catalog(&path)
    })
    .await
    .map_err(|_| "deck_style.failed".to_string())?
}

#[tauri::command]
pub async fn deck_styles_save(
    window: WebviewWindow,
    style: DeckStyle,
    expected_revision: u64,
) -> Result<DeckStyleCatalog, String> {
    ensure_main(window.label())?;
    let expected_revision = checked_revision(expected_revision)?;
    if style.builtin {
        return Err(invalid());
    }
    let path = data_path();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock_catalog()?;
        let current = load_catalog(&path)?;
        let next = apply_save(&current, &style, expected_revision)?;
        save_catalog(&path, &next)?;
        Ok::<DeckStyleCatalog, String>(next)
    })
    .await
    .map_err(|_| "deck_style.failed".to_string())?
}

#[tauri::command]
pub async fn deck_styles_remove(
    window: WebviewWindow,
    id: String,
    expected_revision: u64,
) -> Result<DeckStyleCatalog, String> {
    ensure_main(window.label())?;
    let id = Uuid::parse_str(&id).map_err(|_| invalid())?;
    let expected_revision = checked_revision(expected_revision)?;
    let path = data_path();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock_catalog()?;
        let current = load_catalog(&path)?;
        let next = apply_remove(&current, id, expected_revision)?;
        save_catalog(&path, &next)?;
        Ok::<DeckStyleCatalog, String>(next)
    })
    .await
    .map_err(|_| "deck_style.failed".to_string())?
}
