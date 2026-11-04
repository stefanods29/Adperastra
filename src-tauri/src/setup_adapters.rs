//! Concrete setup part adapters (Step 10e T6, D9-D10).
//!
//! Every adapter owns exactly one part. Settings-backed parts share one
//! `SettingsSession`, which writes `settings.json` through the existing
//! atomic store and compares the current settings before every commit and
//! rollback, so an externally changed configuration is reported instead of
//! overwritten. The theme part has its own module. `setup_transaction`
//! orders, journals and rolls these adapters back.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use serde::de::DeserializeOwned;
use tauri::{AppHandle, Manager};

use crate::command_layout_types::ToolbarCustomSettings;
use crate::keyboard_map_types::{apply_keyboard_map, KeyboardMap};
use crate::setup_archive::sha256_hex;
use crate::setup_theme_adapter::ThemeAdapter;
use crate::setup_transaction::{SetupPartAdapter, SetupPlanPart, SETUP_APPLY_ORDER};
use crate::setup_types::SetupPart;
use crate::setup_validation::validate_part;
use crate::shell_custom_types::{
    HomeCustomization, MenuCustomization, NavigationCustomization, StatusCustomization,
};
use crate::{AppState, LayoutSettings, Settings};

/// Stable code for a part that cannot be applied on this machine. The
/// per-part warning code is `setup.unsupported.<part-id>`.
pub const UNSUPPORTED: &str = "setup.unsupported";

pub fn unsupported_warning(part: SetupPart) -> String {
    format!("{UNSUPPORTED}.{}", part.id())
}

pub(crate) fn invalid() -> String {
    "setup.invalid".to_string()
}

fn parse<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, String> {
    serde_json::from_slice(bytes).map_err(|_| invalid())
}

enum PartValue {
    Layout(LayoutSettings),
    Menus(Vec<MenuCustomization>),
    Toolbars(ToolbarCustomSettings),
    Navigation(NavigationCustomization),
    Home(HomeCustomization),
    Status(StatusCustomization),
    Keyboard(KeyboardMap),
}

fn parse_part(part: SetupPart, bytes: &[u8]) -> Result<PartValue, String> {
    validate_part(part, bytes)?;
    match part {
        SetupPart::Layout => parse(bytes).map(PartValue::Layout),
        SetupPart::Menus => parse(bytes).map(PartValue::Menus),
        SetupPart::Toolbars => parse(bytes).map(PartValue::Toolbars),
        SetupPart::Navigation => parse(bytes).map(PartValue::Navigation),
        SetupPart::Home => parse(bytes).map(PartValue::Home),
        SetupPart::Status => parse(bytes).map(PartValue::Status),
        SetupPart::Keyboard => parse(bytes).map(PartValue::Keyboard),
        SetupPart::Theme => Err(invalid()),
    }
}

fn apply_value(settings: &mut Settings, value: &PartValue) -> Result<(), String> {
    match value {
        PartValue::Layout(layout) => settings.layout = layout.clone(),
        PartValue::Menus(menus) => settings.shell_custom.menus = menus.clone(),
        PartValue::Toolbars(toolbars) => settings.toolbar_custom = toolbars.clone(),
        PartValue::Navigation(navigation) => settings.shell_custom.navigation = navigation.clone(),
        PartValue::Home(home) => settings.shell_custom.home = home.clone(),
        PartValue::Status(status) => settings.shell_custom.status = status.clone(),
        PartValue::Keyboard(map) => {
            apply_keyboard_map(&mut settings.keyboard_custom, map).map_err(|code| {
                if code == "keyboard.limit" {
                    UNSUPPORTED.to_string()
                } else {
                    invalid()
                }
            })?;
        }
    }
    Ok(())
}

struct SettingsCommit {
    part: SetupPart,
    previous_bytes: Vec<u8>,
    new_bytes: Vec<u8>,
}

/// One guarded settings.json writer shared by every settings-backed part and
/// by the theme activation. Each commit replaces the whole file atomically but
/// only after the current values still equal this session's working copy.
pub(crate) struct SettingsSession {
    app: Option<AppHandle>,
    data_dir: PathBuf,
    pub(crate) working: Settings,
    committed: Vec<SettingsCommit>,
}

impl SettingsSession {
    fn new(app: Option<AppHandle>, data_dir: PathBuf) -> Result<Self, String> {
        let working = match &app {
            Some(app) => app
                .state::<AppState>()
                .settings
                .lock()
                .map_err(|_| "setup.io".to_string())?
                .clone(),
            None => crate::load_settings(&data_dir),
        };
        Ok(Self {
            app,
            data_dir,
            working,
            committed: Vec::new(),
        })
    }

    fn read_part(&self, part: SetupPart) -> Result<Vec<u8>, String> {
        let bytes = match part {
            SetupPart::Layout => serde_json::to_vec(&self.working.layout),
            SetupPart::Menus => serde_json::to_vec(&self.working.shell_custom.menus),
            SetupPart::Toolbars => serde_json::to_vec(&self.working.toolbar_custom),
            SetupPart::Navigation => serde_json::to_vec(&self.working.shell_custom.navigation),
            SetupPart::Home => serde_json::to_vec(&self.working.shell_custom.home),
            SetupPart::Status => serde_json::to_vec(&self.working.shell_custom.status),
            SetupPart::Keyboard => {
                let active = self
                    .working
                    .keyboard_custom
                    .custom_maps
                    .iter()
                    .find(|map| map.id == self.working.keyboard_custom.active_map);
                match active {
                    Some(map) => serde_json::to_vec(map),
                    None => return Ok(Vec::new()),
                }
            }
            SetupPart::Theme => return Ok(Vec::new()),
        }
        .map_err(|_| invalid())?;
        Ok(bytes)
    }

    fn prepare(&self, part: SetupPart, bytes: &[u8]) -> Result<Settings, String> {
        let value = parse_part(part, bytes)?;
        let mut candidate = self.working.clone();
        apply_value(&mut candidate, &value)?;
        crate::validate(&candidate).map_err(|_| invalid())?;
        Ok(candidate)
    }

    pub(crate) fn commit(&mut self, part: SetupPart, candidate: Settings) -> Result<(), String> {
        crate::validate(&candidate).map_err(|_| invalid())?;
        let app = self.app.clone();
        let state = app.as_ref().map(|app| app.state::<AppState>());
        let mut cache = match &state {
            Some(state) => Some(state.settings.lock().map_err(|_| "setup.io".to_string())?),
            None => None,
        };
        if let Some(cache) = cache.as_deref() {
            if *cache != self.working {
                return Err("setup.changed".to_string());
            }
        }
        if crate::load_settings(&self.data_dir) != self.working {
            return Err("setup.changed".to_string());
        }
        let path = crate::settings_path(&self.data_dir);
        let previous_bytes = std::fs::read(&path)
            .unwrap_or_else(|_| serde_json::to_vec_pretty(&self.working).unwrap_or_default());
        crate::save_settings_to_dir(&self.data_dir, &candidate)
            .map_err(|_| "setup.io".to_string())?;
        let new_bytes = std::fs::read(&path).map_err(|_| "setup.io".to_string())?;
        if let Some(cache) = cache.as_deref_mut() {
            *cache = candidate.clone();
        }
        self.working = candidate;
        self.committed.push(SettingsCommit {
            part,
            previous_bytes,
            new_bytes,
        });
        Ok(())
    }

    /// Restore the file only when it still holds exactly the bytes this
    /// session wrote. A part that never committed is a no-op.
    pub(crate) fn rollback(&mut self, part: SetupPart) -> Result<(), String> {
        if self.committed.last().map(|commit| commit.part) != Some(part) {
            return Ok(());
        }
        let commit = self.committed.pop().ok_or_else(invalid)?;
        let app = self.app.clone();
        let state = app.as_ref().map(|app| app.state::<AppState>());
        let mut cache = match &state {
            Some(state) => Some(state.settings.lock().map_err(|_| "setup.io".to_string())?),
            None => None,
        };
        if let Some(cache) = cache.as_deref() {
            if *cache != self.working {
                self.committed.push(commit);
                return Err("setup.changed".to_string());
            }
        }
        let path = crate::settings_path(&self.data_dir);
        let current = std::fs::read(&path).map_err(|_| "setup.io".to_string())?;
        if sha256_hex(&current) != sha256_hex(&commit.new_bytes) {
            self.committed.push(commit);
            return Err("setup.changed".to_string());
        }
        fs_service::atomic_write(&path, &commit.previous_bytes)
            .map_err(|_| "setup.io".to_string())?;
        let restored: Settings = parse(&commit.previous_bytes)?;
        if let Some(cache) = cache.as_deref_mut() {
            *cache = restored.clone();
        }
        self.working = restored;
        Ok(())
    }
}

struct SettingsPartAdapter {
    part: SetupPart,
    session: Rc<RefCell<SettingsSession>>,
    staged: Option<Settings>,
}

impl SettingsPartAdapter {
    fn new(part: SetupPart, session: Rc<RefCell<SettingsSession>>) -> Self {
        Self {
            part,
            session,
            staged: None,
        }
    }
}

impl SetupPartAdapter for SettingsPartAdapter {
    fn part(&self) -> SetupPart {
        self.part
    }

    fn read(&self) -> Result<Vec<u8>, String> {
        self.session.borrow().read_part(self.part)
    }

    fn validate(&self, bytes: &[u8]) -> Result<(), String> {
        self.session.borrow().prepare(self.part, bytes).map(|_| ())
    }

    fn stage(&mut self, _transaction_id: &str, bytes: &[u8]) -> Result<(), String> {
        self.staged = Some(self.session.borrow().prepare(self.part, bytes)?);
        Ok(())
    }

    fn commit(&mut self, _transaction_id: &str) -> Result<(), String> {
        let candidate = self.staged.take().ok_or_else(invalid)?;
        self.session.borrow_mut().commit(self.part, candidate)
    }

    fn rollback(&mut self, _transaction_id: &str) -> Result<(), String> {
        self.staged = None;
        self.session.borrow_mut().rollback(self.part)
    }
}

/// The concrete registry: one static adapter per supported part, built from
/// the canonical stores. A selected part that has no safe adapter can be
/// reported per part instead of blocking every other selection.
pub struct SetupAdapterRegistry {
    adapters: Vec<Box<dyn SetupPartAdapter>>,
    unsupported: Vec<SetupPart>,
}

impl SetupAdapterRegistry {
    pub fn for_selection(
        app: AppHandle,
        data_dir: &Path,
        assets: Rc<BTreeMap<String, Vec<u8>>>,
        selected: &[SetupPart],
    ) -> Result<Self, String> {
        let session = Rc::new(RefCell::new(SettingsSession::new(
            Some(app),
            data_dir.to_path_buf(),
        )?));
        let mut adapters: Vec<Box<dyn SetupPartAdapter>> = Vec::new();
        for part in SETUP_APPLY_ORDER {
            if !selected.contains(&part) {
                continue;
            }
            if adapters.iter().any(|adapter| adapter.part() == part) {
                return Err(invalid());
            }
            let adapter: Box<dyn SetupPartAdapter> = match part {
                SetupPart::Theme => Box::new(ThemeAdapter::new(
                    data_dir.to_path_buf(),
                    Rc::clone(&session),
                    Rc::clone(&assets),
                )),
                _ => Box::new(SettingsPartAdapter::new(part, Rc::clone(&session))),
            };
            adapters.push(adapter);
        }
        Ok(Self {
            adapters,
            unsupported: Vec::new(),
        })
    }

    /// Validate the selected parts before any journal write. Returns the
    /// supported plan and the parts that this build cannot apply safely.
    pub fn supported_plan(
        &mut self,
        data: Vec<SetupPlanPart>,
    ) -> Result<(Vec<SetupPlanPart>, Vec<SetupPart>), String> {
        let mut plan = Vec::new();
        for entry in data {
            let Some(adapter) = self.adapters.iter().find(|adapter| adapter.part() == entry.part) else {
                self.unsupported.push(entry.part);
                continue;
            };
            match adapter.validate(&entry.bytes) {
                Ok(()) => plan.push(entry),
                Err(code) if code == UNSUPPORTED => self.unsupported.push(entry.part),
                Err(code) => return Err(code),
            }
        }
        Ok((plan, self.unsupported.clone()))
    }

    pub fn adapters_mut(&mut self) -> &mut [Box<dyn SetupPartAdapter>] {
        &mut self.adapters
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::setup_transaction::SetupPartAdapter;

    fn session(dir: &Path) -> Rc<RefCell<SettingsSession>> {
        Rc::new(RefCell::new(
            SettingsSession::new(None, dir.to_path_buf()).unwrap(),
        ))
    }

    #[test]
    #[allow(clippy::field_reassign_with_default)]
    fn settings_commit_and_rollback_restore_the_file() {
        let dir = tempfile::tempdir().unwrap();
        crate::save_settings_to_dir(dir.path(), &Settings::default()).unwrap();
        let session = session(dir.path());
        let mut adapter = SettingsPartAdapter::new(SetupPart::Layout, Rc::clone(&session));
        let mut layout = LayoutSettings::default();
        layout.toolbar_position = "left".to_string();
        let bytes = serde_json::to_vec(&layout).unwrap();
        adapter.validate(&bytes).unwrap();
        adapter.stage("t", &bytes).unwrap();
        adapter.commit("t").unwrap();
        assert_eq!(
            crate::load_settings(dir.path()).layout.toolbar_position,
            "left"
        );
        adapter.rollback("t").unwrap();
        assert_eq!(
            crate::load_settings(dir.path()).layout,
            LayoutSettings::default()
        );
    }

    #[test]
    fn rollback_refuses_an_external_settings_change() {
        let dir = tempfile::tempdir().unwrap();
        crate::save_settings_to_dir(dir.path(), &Settings::default()).unwrap();
        let session = session(dir.path());
        let mut adapter = SettingsPartAdapter::new(SetupPart::Home, Rc::clone(&session));
        let bytes = serde_json::to_vec(&HomeCustomization::default()).unwrap();
        adapter.stage("t", &bytes).unwrap();
        adapter.commit("t").unwrap();
        let mut external = crate::load_settings(dir.path());
        external.language = "es".to_string();
        crate::save_settings_to_dir(dir.path(), &external).unwrap();
        assert_eq!(adapter.rollback("t"), Err("setup.changed".to_string()));
    }

    #[test]
    fn unsupported_code_names_the_part() {
        assert_eq!(unsupported_warning(SetupPart::Theme), "setup.unsupported.theme");
        assert_eq!(unsupported_warning(SetupPart::Keyboard), "setup.unsupported.keyboard");
    }
}
