//! Theme part adapter for setup Apply (Step 10e T6, D9-D10).
//!
//! The part is an owned `CustomTheme`. A referenced background PNG from the
//! setup archive is republished as a fresh owned asset, the theme is written
//! through the existing atomic theme store, and the matching day/night slot
//! is activated through the shared settings session. Rollback restores the
//! previous theme bytes and activation, and never touches a file that changed
//! outside this transaction.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use crate::custom_theme_store;
use crate::custom_theme_types::{
    validate_custom_theme, CustomTheme, ThemeError, ThemeRef, MAX_THEMES,
};
use crate::setup_adapters::{invalid, SettingsSession, UNSUPPORTED};
use crate::setup_archive::sha256_hex;
use crate::setup_transaction::SetupPartAdapter;
use crate::setup_types::{SetupPart, MAX_SETUP_PART_BYTES};
use crate::Settings;

fn map_theme_error(error: ThemeError) -> String {
    match error {
        ThemeError::Limit => "setup.too_large".to_string(),
        ThemeError::Io | ThemeError::Unavailable => "setup.io".to_string(),
        _ => invalid(),
    }
}

fn parse<T: serde::de::DeserializeOwned>(bytes: &[u8]) -> Result<T, String> {
    serde_json::from_slice(bytes).map_err(|_| invalid())
}

fn activation_settings(working: &Settings, theme: &CustomTheme) -> Result<Settings, String> {
    let mut next = working.clone();
    let reference = ThemeRef::custom(&theme.id);
    if theme.scheme == "dark" {
        next.theme_custom.night = reference;
    } else {
        next.theme_custom.day = reference;
    }
    next.theme_custom.mode = "manual".to_string();
    next.theme_custom.manual_scheme = theme.scheme.clone();
    crate::validate(&next).map_err(|_| invalid())?;
    Ok(next)
}

fn remove_asset(data_dir: &Path, asset_id: &str) {
    if let Some(path) = crate::theme_assets::asset_path(data_dir, asset_id) {
        let _ = std::fs::remove_file(path);
    }
}

fn theme_count(data_dir: &Path) -> usize {
    let Ok(entries) = std::fs::read_dir(custom_theme_store::themes_root(data_dir)) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".adptheme"))
        .count()
}

fn restore_theme(data_dir: &Path, id: &str, bytes: &[u8]) -> Result<(), String> {
    let path = custom_theme_store::theme_path(data_dir, id).ok_or_else(invalid)?;
    fs_service::atomic_write(&path, bytes).map_err(|_| "setup.io".to_string())?;
    let theme: CustomTheme = parse(bytes).map_err(|_| "setup.changed".to_string())?;
    custom_theme_store::save(data_dir, theme).map_err(map_theme_error)?;
    Ok(())
}

struct ThemeStage {
    theme: CustomTheme,
    previous_bytes: Option<Vec<u8>>,
    png: Option<Vec<u8>>,
    activation: Settings,
}

struct ThemeSaved {
    id: String,
    previous_bytes: Option<Vec<u8>>,
    new_bytes: Vec<u8>,
    stored_asset: Option<String>,
}

pub(crate) struct ThemeAdapter {
    data_dir: PathBuf,
    session: Rc<RefCell<SettingsSession>>,
    assets: Rc<BTreeMap<String, Vec<u8>>>,
    staged: Option<ThemeStage>,
    saved: Option<ThemeSaved>,
}

impl ThemeAdapter {
    pub(crate) fn new(
        data_dir: PathBuf,
        session: Rc<RefCell<SettingsSession>>,
        assets: Rc<BTreeMap<String, Vec<u8>>>,
    ) -> Self {
        Self {
            data_dir,
            session,
            assets,
            staged: None,
            saved: None,
        }
    }

    fn parse(&self, bytes: &[u8]) -> Result<CustomTheme, String> {
        if bytes.len() as u64 > MAX_SETUP_PART_BYTES {
            return Err("setup.too_large".to_string());
        }
        let theme: CustomTheme = parse(bytes)?;
        validate_custom_theme(&theme).map_err(map_theme_error)?;
        Ok(theme)
    }

    fn background_png(&self, theme: &CustomTheme) -> Result<Option<Vec<u8>>, String> {
        let Some(asset_id) = theme
            .background
            .as_ref()
            .and_then(|background| background.asset_id.as_ref())
        else {
            return Ok(None);
        };
        let name = format!("assets/{asset_id}.png");
        let png = self.assets.get(&name).ok_or_else(invalid)?;
        crate::theme_assets::validate_png(png).map_err(map_theme_error)?;
        Ok(Some(png.clone()))
    }

    fn undo_store(
        &self,
        saved: &ThemeSaved,
    ) -> Result<(), String> {
        let restored = match &saved.previous_bytes {
            Some(bytes) => restore_theme(&self.data_dir, &saved.id, bytes),
            None => {
                custom_theme_store::remove(&self.data_dir, &saved.id).map_err(map_theme_error)
            }
        };
        if restored.is_ok() {
            if let Some(asset_id) = &saved.stored_asset {
                remove_asset(&self.data_dir, asset_id);
            }
        }
        restored
    }
}

impl SetupPartAdapter for ThemeAdapter {
    fn part(&self) -> SetupPart {
        SetupPart::Theme
    }

    fn read(&self) -> Result<Vec<u8>, String> {
        // The target id is only known after stage; theme rollback keeps its
        // own byte snapshot, so the journal old hash is informational.
        Ok(Vec::new())
    }

    fn validate(&self, bytes: &[u8]) -> Result<(), String> {
        let theme = self.parse(bytes)?;
        // A font that is not installed on this PC cannot be applied here.
        crate::theme_fonts::ensure_font_allowed(&theme.ui_font)
            .map_err(|_| UNSUPPORTED.to_string())?;
        self.background_png(&theme)?;
        if let Some(path) = custom_theme_store::theme_path(&self.data_dir, &theme.id) {
            if path.exists() && custom_theme_store::read(&self.data_dir, &theme.id).is_err() {
                return Err("setup.changed".to_string());
            }
            if !path.exists() && theme_count(&self.data_dir) >= MAX_THEMES {
                return Err(UNSUPPORTED.to_string());
            }
        }
        Ok(())
    }

    fn stage(&mut self, _transaction_id: &str, bytes: &[u8]) -> Result<(), String> {
        self.validate(bytes)?;
        let theme = self.parse(bytes)?;
        let previous_bytes = custom_theme_store::theme_path(&self.data_dir, &theme.id)
            .and_then(|path| std::fs::read(path).ok());
        let png = self.background_png(&theme)?;
        let activation = {
            let session = self.session.borrow();
            activation_settings(&session.working, &theme)?
        };
        self.staged = Some(ThemeStage {
            theme,
            previous_bytes,
            png,
            activation,
        });
        Ok(())
    }

    fn commit(&mut self, _transaction_id: &str) -> Result<(), String> {
        let stage = self.staged.take().ok_or_else(invalid)?;
        let mut theme = stage.theme;
        let mut stored_asset = None;
        if let Some(png) = stage.png {
            let (asset_id, _, _, _) =
                crate::theme_assets::store_owned_png(&self.data_dir, &png)
                    .map_err(map_theme_error)?;
            if let Some(background) = theme.background.as_mut() {
                background.asset_id = Some(asset_id.clone());
            }
            stored_asset = Some(asset_id);
        }
        let saved = match custom_theme_store::save(&self.data_dir, theme) {
            Ok(saved) => saved,
            Err(error) => {
                if let Some(asset_id) = &stored_asset {
                    remove_asset(&self.data_dir, asset_id);
                }
                return Err(map_theme_error(error));
            }
        };
        let new_bytes = custom_theme_store::theme_path(&self.data_dir, &saved.id)
            .and_then(|path| std::fs::read(path).ok())
            .ok_or_else(|| "setup.io".to_string())?;
        if let Err(error) = self
            .session
            .borrow_mut()
            .commit(SetupPart::Theme, stage.activation)
        {
            // The theme file is already written; put the store back before
            // reporting, so the transaction never leaves a half-applied part.
            let partial = ThemeSaved {
                id: saved.id,
                previous_bytes: stage.previous_bytes,
                new_bytes,
                stored_asset,
            };
            if self.undo_store(&partial).is_err() {
                return Err("setup.recovery_required".to_string());
            }
            return Err(error);
        }
        self.saved = Some(ThemeSaved {
            id: saved.id,
            previous_bytes: stage.previous_bytes,
            new_bytes,
            stored_asset,
        });
        Ok(())
    }

    fn rollback(&mut self, _transaction_id: &str) -> Result<(), String> {
        let Some(saved) = self.saved.take() else {
            return Ok(());
        };
        // Prove ownership of the theme file before touching either store, so
        // an external change leaves both the theme and the settings as they are.
        let path = custom_theme_store::theme_path(&self.data_dir, &saved.id)
            .ok_or_else(invalid)?;
        let current = std::fs::read(&path).map_err(|_| "setup.changed".to_string())?;
        if sha256_hex(&current) != sha256_hex(&saved.new_bytes) {
            self.saved = Some(saved);
            return Err("setup.changed".to_string());
        }
        if let Err(error) = self.session.borrow_mut().rollback(SetupPart::Theme) {
            self.saved = Some(saved);
            return Err(error);
        }
        let restored = self.undo_store(&saved);
        if restored.is_err() {
            self.saved = Some(saved);
        }
        restored
    }
}
