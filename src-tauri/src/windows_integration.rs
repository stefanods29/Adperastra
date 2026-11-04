//! Optional Explorer integration and the owned registration ledger
//! (Step 16, guide D2/D4).
//!
//! The plan below writes only app-owned keys or app-named values inside
//! shared keys. `UserChoice`, handler hashes, default-app choices and every
//! other program's values are never touched. Disable and uninstall restore
//! only values that still match what this app installed.
#![allow(dead_code)]


use std::path::Path;

use crate::registry_ledger::{
    assert_owned_value, identity, RegistryBackend, RegistryLedger, StoredValue, WindowsRegistry,
};
use crate::windows_integration_types::{
    is_owned_value, validate_integration_request, validate_owned_value, IntegrationRequest,
    IntegrationStatus, RegistryOwnedValue, RegistryValueType, LEDGER_SCHEMA, MAX_ASSOCIATIONS,
};

pub const APP_DISPLAY_NAME: &str = "Adperastra";
pub const RUN_VALUE_NAME: &str = "Adperastra";
pub const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
pub const REGISTERED_APPLICATIONS_KEY: &str = "Software\\RegisteredApplications";
pub const CAPABILITIES_KEY: &str = "Software\\Adperastra\\Capabilities";
pub const FILE_ASSOCIATIONS_KEY: &str = "Software\\Adperastra\\Capabilities\\FileAssociations";
pub const APPLICATIONS_KEY: &str = "Software\\Classes\\Applications\\Adperastra.exe";
/// Explorer shows this verb in the classic menu. The product name is fixed
/// and not translated; the conversion verb text is fixed by guide D2.
pub const OPEN_VERB_LABEL: &str = "Adperastra";
pub const OPEN_WITH_VERB_LABEL: &str = "Open with Adperastra";
pub const CONVERT_VERB_LABEL: &str = "Convert to…";

/// One registry value the plan will install.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedValue {
    pub key: String,
    pub name: String,
    pub value: StoredValue,
}

fn bad_request() -> String {
    "windows_integration.bad_request".to_string()
}

fn failed() -> String {
    "windows_integration.failed".to_string()
}

fn changed() -> String {
    "windows_integration.changed".to_string()
}

fn denied() -> String {
    "windows_integration.denied".to_string()
}

/// Validate the executable path used in a registry command. The uninstaller
/// and installer never accept a command line from the UI; this path always
/// comes from `std::env::current_exe`.
pub fn quote_executable(exe: &Path) -> Result<String, String> {
    let text = exe.to_string_lossy().into_owned();
    crate::windows_integration_types::validate_activation_path(&text)?;
    if text.contains('"') || text.ends_with('\\') || text.contains('\0') {
        return Err(bad_request());
    }
    Ok(format!("\"{text}\""))
}

/// The fixed `shell\...\command` value: one quoted executable, one fixed
/// verb, and Explorer's `%1` placeholder. No path is ever concatenated
/// unquoted and no extra argument is accepted.
pub fn registration_command(exe: &Path, verb: &str) -> Result<String, String> {
    if verb != "--open" && verb != "--convert" {
        return Err(bad_request());
    }
    Ok(format!("{} {} \"%1\"", quote_executable(exe)?, verb))
}

fn run_background_command(exe: &Path) -> Result<String, String> {
    Ok(format!("{} --background", quote_executable(exe)?))
}

fn progid(extension: &str) -> String {
    format!("Adperastra.File.{extension}")
}

fn progid_key(extension: &str) -> String {
    format!("Software\\Classes\\{}", progid(extension))
}

fn open_with_key(extension: &str) -> String {
    format!("Software\\Classes\\.{extension}\\OpenWithProgids")
}

/// Build every registry value one request installs. Pure and deterministic;
/// the caller preflights the table before writing anything.
pub fn build_plan(
    exe: &Path,
    version: &str,
    request: &IntegrationRequest,
) -> Result<Vec<PlannedValue>, String> {
    if !crate::windows_integration_types::is_semver(version) {
        return Err(bad_request());
    }
    let request = validate_integration_request(request)?;
    let mut plan = Vec::new();
    let open_command = registration_command(exe, "--open")?;
    let convert_command = registration_command(exe, "--convert")?;
    let icon = format!("{},0", quote_executable(exe)?);
    let integrate_explorer = !request.extensions.is_empty() || request.classic_enabled;

    // "Show more options" entries apply to every file. They live under the
    // app-named subkeys of `*`; no other program's verb is touched.
    if request.classic_enabled {
        plan.push(PlannedValue {
            key: "Software\\Classes\\*\\shell\\Adperastra.Open".to_string(),
            name: String::new(),
            value: StoredValue::string(OPEN_WITH_VERB_LABEL),
        });
        plan.push(PlannedValue {
            key: "Software\\Classes\\*\\shell\\Adperastra.Open\\command".to_string(),
            name: String::new(),
            value: StoredValue::string(&open_command),
        });
        plan.push(PlannedValue {
            key: "Software\\Classes\\*\\shell\\Adperastra.Convert".to_string(),
            name: String::new(),
            value: StoredValue::string(CONVERT_VERB_LABEL),
        });
        plan.push(PlannedValue {
            key: "Software\\Classes\\*\\shell\\Adperastra.Convert\\command".to_string(),
            name: String::new(),
            value: StoredValue::string(&convert_command),
        });
    }

    // Application registration: one entry in "Open with" and in Windows'
    // default-apps page. It never becomes the default by itself. With no
    // selected family there is nothing to register; the removals pass then
    // restores whatever this ledger previously owned.
    if integrate_explorer {
        plan.push(PlannedValue {
            key: APPLICATIONS_KEY.to_string(),
            name: "FriendlyAppName".to_string(),
            value: StoredValue::string(APP_DISPLAY_NAME),
        });
        plan.push(PlannedValue {
            key: format!("{APPLICATIONS_KEY}\\DefaultIcon"),
            name: String::new(),
            value: StoredValue::string(&icon),
        });
        plan.push(PlannedValue {
            key: format!("{APPLICATIONS_KEY}\\shell\\open"),
            name: String::new(),
            value: StoredValue::string(OPEN_VERB_LABEL),
        });
        plan.push(PlannedValue {
            key: format!("{APPLICATIONS_KEY}\\shell\\open\\command"),
            name: String::new(),
            value: StoredValue::string(&open_command),
        });
    }

    for extension in &request.extensions {
        let progid = progid(extension);
        let key = progid_key(extension);
        plan.push(PlannedValue {
            key: key.clone(),
            name: String::new(),
            value: StoredValue::string(APP_DISPLAY_NAME),
        });
        plan.push(PlannedValue {
            key: format!("{key}\\DefaultIcon"),
            name: String::new(),
            value: StoredValue::string(&icon),
        });
        // The ProgID's own open verb is what "Open with" runs. It is not a
        // classic-menu entry by itself; `*` carries the explicit commands.
        plan.push(PlannedValue {
            key: format!("{key}\\shell\\open"),
            name: String::new(),
            value: StoredValue::string(OPEN_VERB_LABEL),
        });
        plan.push(PlannedValue {
            key: format!("{key}\\shell\\open\\command"),
            name: String::new(),
            value: StoredValue::string(&open_command),
        });
        // A named value in the shared OpenWithProgids list. The key is never
        // rewritten as a whole and the value name is ours alone.
        plan.push(PlannedValue {
            key: open_with_key(extension),
            name: progid.clone(),
            value: StoredValue::none(),
        });
        plan.push(PlannedValue {
            key: format!("{APPLICATIONS_KEY}\\SupportedTypes"),
            name: format!(".{extension}"),
            value: StoredValue::none(),
        });
        plan.push(PlannedValue {
            key: FILE_ASSOCIATIONS_KEY.to_string(),
            name: format!(".{extension}"),
            value: StoredValue::string(&progid),
        });
    }

    if integrate_explorer {
        plan.push(PlannedValue {
            key: CAPABILITIES_KEY.to_string(),
            name: "ApplicationName".to_string(),
            value: StoredValue::string(APP_DISPLAY_NAME),
        });
        plan.push(PlannedValue {
            key: CAPABILITIES_KEY.to_string(),
            name: "ApplicationIcon".to_string(),
            value: StoredValue::string(&icon),
        });
        plan.push(PlannedValue {
            key: REGISTERED_APPLICATIONS_KEY.to_string(),
            name: APP_DISPLAY_NAME.to_string(),
            value: StoredValue::string(CAPABILITIES_KEY),
        });
    }

    if request.start_with_windows {
        plan.push(PlannedValue {
            key: RUN_KEY.to_string(),
            name: RUN_VALUE_NAME.to_string(),
            value: StoredValue::string(&run_background_command(exe)?),
        });
    }

    for planned in &plan {
        assert_owned_value(&planned.key, &planned.name, &planned.value)?;
    }
    Ok(plan)
}

fn is_current(
    current: Option<&StoredValue>,
    value_type: RegistryValueType,
    bytes: &[u8],
) -> bool {
    matches!(
        current,
        Some(value) if value.value_type == value_type && value.bytes.as_slice() == bytes
    )
}

fn restore_entry(backend: &dyn RegistryBackend, entry: &RegistryOwnedValue) -> Result<(), String> {
    validate_owned_value(entry)?;
    match &entry.previous_value {
        Some(bytes) => {
            let value = StoredValue {
                value_type: entry.previous_value_type.unwrap_or(entry.value_type),
                bytes: bytes.clone(),
            };
            value.validate()?;
            backend.write(&entry.key, &entry.name, &value)
        }
        None => {
            if !is_owned_value(&entry.key, &entry.name) {
                return Err(bad_request());
            }
            backend.delete(&entry.key, &entry.name)
        }
    }
}

struct JournalEntry {
    key: String,
    name: String,
    before: Option<StoredValue>,
}

fn undo(backend: &dyn RegistryBackend, journal: &[JournalEntry]) {
    for entry in journal.iter().rev() {
        match &entry.before {
            Some(value) => {
                let _ = backend.write(&entry.key, &entry.name, value);
            }
            None => {
                let _ = backend.delete(&entry.key, &entry.name);
            }
        }
    }
}

fn record_before(
    backend: &dyn RegistryBackend,
    key: &str,
    name: &str,
    journal: &mut Vec<JournalEntry>,
) -> Result<(), String> {
    let before = backend.read(key, name)?;
    journal.push(JournalEntry {
        key: key.to_string(),
        name: name.to_string(),
        before,
    });
    Ok(())
}

/// Names the app itself owns, even when an older install left no ledger.
fn adoptable_value_name(name: &str) -> bool {
    name == "Adperastra" || name == "Adperastra.exe" || name.starts_with("Adperastra.")
}

/// Apply one request. Preflight refuses to overwrite a value the app did not
/// install. Any failure rolls every write and restore back to the state
/// before the call, and the caller keeps the old ledger on disk.
pub fn apply(
    backend: &dyn RegistryBackend,
    ledger: RegistryLedger,
    request: &IntegrationRequest,
    exe: &Path,
    version: &str,
) -> Result<RegistryLedger, String> {
    let request = validate_integration_request(request)?;
    let plan = build_plan(exe, version, &request)?;
    let ledger = ledger.normalized()?;
    let mut next = ledger.clone();

    // 1. Preflight: never overwrite a foreign value.
    for planned in &plan {
        let current = backend.read(&planned.key, &planned.name)?;
        let installed = ledger.find(&planned.key, &planned.name);
        let ours = match (current.as_ref(), installed) {
            (Some(current), Some(entry)) => {
                current.value_type == entry.value_type
                    && current.bytes == entry.installed_value
            }
            _ => false,
        };
        if let Some(current) = current {
            let already_planned = current.value_type == planned.value.value_type
                && current.bytes == planned.value.bytes;
            // Only an installed value path may coexist with an existing
            // value. A UAC-denied read returns an error above, not `None`.
            if !ours && !already_planned && !adoptable_value_name(&planned.name) {
                return Err(denied());
            }
        }
    }

    let mut journal: Vec<JournalEntry> = Vec::new();
    let planned_ids: std::collections::BTreeSet<String> = plan
        .iter()
        .map(|planned| identity(&planned.key, &planned.name))
        .collect();

    // 2. Remove entries the new request no longer includes, restoring a
    //    matching owned value and leaving a foreign value alone.
    let removals: Vec<RegistryOwnedValue> = next
        .values
        .iter()
        .filter(|entry| !planned_ids.contains(&identity(&entry.key, &entry.name)))
        .cloned()
        .collect();
    for entry in removals {
        let current = match backend.read(&entry.key, &entry.name) {
            Ok(current) => current,
            Err(_) => {
                undo(backend, &journal);
                return Err(failed());
            }
        };
        if is_current(current.as_ref(), entry.value_type, &entry.installed_value)
            && (record_before(backend, &entry.key, &entry.name, &mut journal).is_err()
                || restore_entry(backend, &entry).is_err())
            {
                undo(backend, &journal);
                return Err(failed());
            }
        next.remove(&entry.key, &entry.name);
    }

    // 3. Install the plan, keeping the exact previous value and type.
    for planned in &plan {
        let current = match backend.read(&planned.key, &planned.name) {
            Ok(current) => current,
            Err(_) => {
                undo(backend, &journal);
                return Err(failed());
            }
        };
        let existing = next.find(&planned.key, &planned.name).cloned();
        let previous_value = match &existing {
            Some(entry) => entry.previous_value.clone(),
            None => current.as_ref().map(|value| value.bytes.clone()),
        };
        let previous_value_type = match &existing {
            Some(entry) if entry.previous_value.is_some() => entry
                .previous_value_type
                .or(Some(entry.value_type)),
            Some(_) => None,
            None => current.as_ref().map(|value| value.value_type),
        };
        if record_before(backend, &planned.key, &planned.name, &mut journal).is_err() {
            undo(backend, &journal);
            return Err(failed());
        }
        if backend
            .write(&planned.key, &planned.name, &planned.value)
            .is_err()
        {
            undo(backend, &journal);
            return Err(failed());
        }
        let entry = RegistryOwnedValue {
            key: planned.key.clone(),
            name: planned.name.clone(),
            installed_value: planned.value.bytes.clone(),
            previous_value,
            previous_value_type,
            value_type: planned.value.value_type,
            app_version: version.to_string(),
            ledger_schema: LEDGER_SCHEMA,
        };
        if next.upsert(entry).is_err() {
            undo(backend, &journal);
            return Err(failed());
        }
    }

    next.normalized()
}

/// Restore every entry that still matches what the app installed. Entries a
/// third party replaced are dropped from the returned ledger and left as is.
pub fn restore_with_backend(
    backend: &dyn RegistryBackend,
    ledger: &RegistryLedger,
) -> Result<(RegistryLedger, IntegrationStatus), String> {
    let ledger = ledger.normalized()?;
    let mut journal: Vec<JournalEntry> = Vec::new();
    for entry in &ledger.values {
        let current = match backend.read(&entry.key, &entry.name) {
            Ok(current) => current,
            Err(_) => {
                undo(backend, &journal);
                return Err(failed());
            }
        };
        if is_current(current.as_ref(), entry.value_type, &entry.installed_value)
            && (record_before(backend, &entry.key, &entry.name, &mut journal).is_err()
                || restore_entry(backend, entry).is_err())
            {
                undo(backend, &journal);
                return Err(failed());
            }
    }
    Ok((RegistryLedger::default(), IntegrationStatus::disabled()))
}

/// Guide E4: the uninstaller and the disable path restore only current
/// matching owned values.
pub fn restore_owned_registration(
    ledger: &RegistryLedger,
) -> Result<IntegrationStatus, String> {
    restore_with_backend(&WindowsRegistry, ledger).map(|(_, status)| status)
}

/// The live status. A ledger entry whose value changed is not reported as
/// enabled; the status carries `windows_integration.changed` for the UI.
pub fn status(backend: &dyn RegistryBackend, ledger: &RegistryLedger) -> IntegrationStatus {
    let mut status = IntegrationStatus::disabled();
    let ledger = match ledger.normalized() {
        Ok(ledger) => ledger,
        Err(_) => {
            status.reason_code = Some(changed());
            return status;
        }
    };
    let mut classic = false;
    let mut associations: Vec<String> = Vec::new();
    for entry in &ledger.values {
        let current = match backend.read(&entry.key, &entry.name) {
            Ok(current) => current,
            Err(_) => {
                status.reason_code = Some(failed());
                continue;
            }
        };
        let matches = is_current(current.as_ref(), entry.value_type, &entry.installed_value);
        if !matches {
            if status.reason_code.is_none() {
                status.reason_code = Some(changed());
            }
            continue;
        }
        if entry.key.eq_ignore_ascii_case(RUN_KEY)
            && entry.name.eq_ignore_ascii_case(RUN_VALUE_NAME)
        {
            status.startup_enabled = true;
        }
        if entry
            .key
            .eq_ignore_ascii_case("Software\\Classes\\*\\shell\\Adperastra.Open")
        {
            classic = true;
        }
        if let Some(extension) = open_with_extension(&entry.key, &entry.name) {
            if !associations.contains(&extension) && associations.len() < MAX_ASSOCIATIONS {
                associations.push(extension);
            }
        }
    }
    associations.sort();
    status.classic_enabled = classic;
    status.associations = associations;
    status
}

fn open_with_extension(key: &str, name: &str) -> Option<String> {
    let key = key.to_ascii_lowercase();
    let rest = key.strip_prefix("software\\classes\\.")?;
    let (extension, tail) = rest.split_once('\\')?;
    if tail != "openwithprogids" {
        return None;
    }
    if !name.eq_ignore_ascii_case(&format!("Adperastra.File.{extension}")) {
        return None;
    }
    Some(extension.to_string())
}

/// Set or remove the start-with-Windows value through the same owned ledger.
/// It is a separate explicit choice (guide D7); it never enables background
/// tasks or update checks.
pub fn apply_start_with_windows(
    backend: &dyn RegistryBackend,
    ledger: RegistryLedger,
    enabled: bool,
    exe: &Path,
    version: &str,
) -> Result<RegistryLedger, String> {
    let mut next = ledger.normalized()?;
    if !enabled {
        if let Some(entry) = next.find(RUN_KEY, RUN_VALUE_NAME).cloned() {
            let current = backend.read(&entry.key, &entry.name)?;
            if is_current(current.as_ref(), entry.value_type, &entry.installed_value) {
                restore_entry(backend, &entry)?;
            }
            next.remove(&entry.key, &entry.name);
        }
        return Ok(next);
    }
    if !crate::windows_integration_types::is_semver(version) {
        return Err(bad_request());
    }
    let value = StoredValue::string(&run_background_command(exe)?);
    assert_owned_value(RUN_KEY, RUN_VALUE_NAME, &value)?;
    let current = backend.read(RUN_KEY, RUN_VALUE_NAME)?;
    let existing = next.find(RUN_KEY, RUN_VALUE_NAME).cloned();
    let ours = match (current.as_ref(), existing.as_ref()) {
        (Some(current), Some(entry)) => {
            current.value_type == entry.value_type && current.bytes == entry.installed_value
        }
        _ => false,
    };
    if let Some(current) = current.as_ref() {
        let already_planned = current.value_type == value.value_type && current.bytes == value.bytes;
        if !ours && !already_planned {
            return Err(denied());
        }
    }
    let previous_value = match &existing {
        Some(entry) => entry.previous_value.clone(),
        None => current.as_ref().map(|value| value.bytes.clone()),
    };
    let previous_value_type = match &existing {
        Some(entry) if entry.previous_value.is_some() => {
            entry.previous_value_type.or(Some(entry.value_type))
        }
        Some(_) => None,
        None => current.as_ref().map(|value| value.value_type),
    };
    backend.write(RUN_KEY, RUN_VALUE_NAME, &value)?;
    let entry = RegistryOwnedValue {
        key: RUN_KEY.to_string(),
        name: RUN_VALUE_NAME.to_string(),
        installed_value: value.bytes,
        previous_value,
        previous_value_type,
        value_type: value.value_type,
        app_version: version.to_string(),
        ledger_schema: LEDGER_SCHEMA,
    };
    if next.upsert(entry).is_err() {
        match current {
            Some(previous) => {
                let _ = backend.write(RUN_KEY, RUN_VALUE_NAME, &previous);
            }
            None => {
                let _ = backend.delete(RUN_KEY, RUN_VALUE_NAME);
            }
        }
        return Err(failed());
    }
    next.normalized()
}

/// Write one value only after the key and name pass the ownership rules.
pub fn write_owned_value(
    backend: &dyn RegistryBackend,
    key: &str,
    name: &str,
    value: &StoredValue,
) -> Result<(), String> {
    assert_owned_value(key, name, value)?;
    backend.write(key, name, value)
}
