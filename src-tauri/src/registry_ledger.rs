//! The owned registry ledger (Step 16, guide D2/D4).
//!
//! Every registry value the app installs is recorded with its exact previous
//! value (and previous type). Disable and uninstall restore a value only when
//! it still matches what the app installed; a value another program changed
//! is preserved and the app stops claiming it. `UserChoice` and handler
//! hashes are never written: `windows_integration_types::is_owned_key`
//! refuses them before any backend call.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};

use crate::windows_integration_types::{
    is_owned_value, validate_owned_value, RegistryOwnedValue, RegistryValueType, LEDGER_SCHEMA,
    MAX_KEY_CHARS, MAX_LEDGER_VALUES, MAX_NAME_CHARS, MAX_REGISTRY_VALUE_BYTES,
};

/// Largest ledger file the app will parse.
pub const MAX_LEDGER_FILE_BYTES: usize = 8 * 1024 * 1024;
/// The ledger file under the installation base directory (profile-independent).
pub const LEDGER_FILE_NAME: &str = "windows-integration-ledger.json";

/// One registry value as the platform sees it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredValue {
    pub value_type: RegistryValueType,
    pub bytes: Vec<u8>,
}

impl StoredValue {
    /// `REG_SZ` text as UTF-16LE with a terminating NUL.
    pub fn string(text: &str) -> Self {
        Self {
            value_type: RegistryValueType::String,
            bytes: encode_utf16(text),
        }
    }

    /// `REG_EXPAND_SZ` text as UTF-16LE with a terminating NUL.
    pub fn expand_string(text: &str) -> Self {
        Self {
            value_type: RegistryValueType::ExpandString,
            bytes: encode_utf16(text),
        }
    }

    /// `REG_DWORD`, four little-endian bytes.
    pub fn dword(value: u32) -> Self {
        Self {
            value_type: RegistryValueType::Dword,
            bytes: value.to_le_bytes().to_vec(),
        }
    }

    /// `REG_NONE`: a name that exists without data.
    pub fn none() -> Self {
        Self {
            value_type: RegistryValueType::None,
            bytes: Vec::new(),
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        if self.bytes.len() > MAX_REGISTRY_VALUE_BYTES {
            return Err("windows_integration.bad_request".to_string());
        }
        if self.value_type == RegistryValueType::Dword && self.bytes.len() != 4 {
            return Err("windows_integration.bad_request".to_string());
        }
        if matches!(
            self.value_type,
            RegistryValueType::String | RegistryValueType::ExpandString
        ) && (!self.bytes.len().is_multiple_of(2) || self.decode_string().is_none())
        {
            return Err("windows_integration.bad_request".to_string());
        }
        Ok(())
    }

    pub fn decode_string(&self) -> Option<String> {
        if !self.bytes.len().is_multiple_of(2) {
            return None;
        }
        let units: Vec<u16> = self
            .bytes
            .as_chunks::<2>().0.iter()
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        let end = units
            .iter()
            .position(|unit| *unit == 0)
            .unwrap_or(units.len());
        String::from_utf16(&units[..end]).ok()
    }
}

fn encode_utf16(text: &str) -> Vec<u8> {
    let mut bytes = Vec::with_capacity((text.len() + 1) * 2);
    for unit in text.encode_utf16().chain(std::iter::once(0)) {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    bytes
}

/// The platform registry. Object-safe so tests can read and write an
/// in-memory table without touching the user's real registry.
pub trait RegistryBackend: Send + Sync {
    fn read(&self, key: &str, name: &str) -> Result<Option<StoredValue>, String>;
    fn write(&self, key: &str, name: &str, value: &StoredValue) -> Result<(), String>;
    fn delete(&self, key: &str, name: &str) -> Result<(), String>;
}

/// Case-insensitive registry identity for a key/value pair.
pub fn identity(key: &str, name: &str) -> String {
    format!(
        "{}\u{1f}{}",
        key.trim_end_matches('\\').to_ascii_lowercase(),
        name.to_ascii_lowercase()
    )
}

fn default_schema() -> u32 {
    LEDGER_SCHEMA
}

/// The persisted ledger. Missing files load as an empty ledger; a corrupt or
/// newer file is refused instead of being silently reset.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RegistryLedger {
    #[serde(default = "default_schema")]
    pub schema_version: u32,
    #[serde(default)]
    pub values: Vec<RegistryOwnedValue>,
}

impl Default for RegistryLedger {
    fn default() -> Self {
        Self {
            schema_version: LEDGER_SCHEMA,
            values: Vec::new(),
        }
    }
}

impl RegistryLedger {
    /// Validate every row, reject duplicates, sort by identity.
    pub fn normalized(&self) -> Result<Self, String> {
        if self.schema_version != LEDGER_SCHEMA {
            return Err("windows_integration.changed".to_string());
        }
        if self.values.len() > MAX_LEDGER_VALUES {
            return Err("windows_integration.changed".to_string());
        }
        let mut seen = BTreeSet::new();
        let mut values = Vec::with_capacity(self.values.len());
        for value in &self.values {
            validate_owned_value(value).map_err(|_| "windows_integration.changed".to_string())?;
            if !seen.insert(identity(&value.key, &value.name)) {
                return Err("windows_integration.changed".to_string());
            }
            values.push(value.clone());
        }
        values.sort_by(|left, right| {
            identity(&left.key, &left.name).cmp(&identity(&right.key, &right.name))
        });
        Ok(Self {
            schema_version: LEDGER_SCHEMA,
            values,
        })
    }

    pub fn find(&self, key: &str, name: &str) -> Option<&RegistryOwnedValue> {
        let wanted = identity(key, name);
        self.values
            .iter()
            .find(|value| identity(&value.key, &value.name) == wanted)
    }

    /// Insert or replace one row, keeping the ledger bounded and valid.
    pub fn upsert(&mut self, value: RegistryOwnedValue) -> Result<(), String> {
        validate_owned_value(&value)?;
        let wanted = identity(&value.key, &value.name);
        if let Some(slot) = self
            .values
            .iter_mut()
            .find(|existing| identity(&existing.key, &existing.name) == wanted)
        {
            *slot = value;
            return Ok(());
        }
        if self.values.len() >= MAX_LEDGER_VALUES {
            return Err("windows_integration.bad_request".to_string());
        }
        self.values.push(value);
        Ok(())
    }

    pub fn remove(&mut self, key: &str, name: &str) {
        let wanted = identity(key, name);
        self.values
            .retain(|value| identity(&value.key, &value.name) != wanted);
    }

    pub fn is_empty(&self) -> bool {
        self.values.is_empty()
    }

    /// Read the ledger under the installation base directory.
    pub fn load(path: &Path) -> Result<Self, String> {
        match std::fs::read(path) {
            Ok(bytes) => {
                if bytes.len() > MAX_LEDGER_FILE_BYTES {
                    return Err("windows_integration.changed".to_string());
                }
                let ledger = serde_json::from_slice::<Self>(&bytes)
                    .map_err(|_| "windows_integration.changed".to_string())?;
                ledger
                    .normalized()
                    .map_err(|_| "windows_integration.changed".to_string())
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(_) => Err("windows_integration.failed".to_string()),
        }
    }

    /// Write the ledger with the crash-safe app-state writer (R-SAFE-9).
    pub fn save(&self, path: &Path) -> Result<(), String> {
        let ledger = self.normalized()?;
        let json = serde_json::to_vec_pretty(&ledger)
            .map_err(|_| "windows_integration.failed".to_string())?;
        if json.len() > MAX_LEDGER_FILE_BYTES {
            return Err("windows_integration.bad_request".to_string());
        }
        fs_service::state::atomic_write(path, &json)
            .map_err(|_| "windows_integration.failed".to_string())
    }
}

/// The ledger file for one installation base directory.
pub struct LedgerStore {
    path: std::path::PathBuf,
}

impl LedgerStore {
    pub fn in_base(base: &Path) -> Self {
        Self {
            path: base.join(LEDGER_FILE_NAME),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn load(&self) -> Result<RegistryLedger, String> {
        RegistryLedger::load(&self.path)
    }

    pub fn save(&self, ledger: &RegistryLedger) -> Result<(), String> {
        ledger.save(&self.path)
    }
}

/// The real `HKEY_CURRENT_USER` backend (64-bit view).
#[cfg(windows)]
pub struct WindowsRegistry;

#[cfg(windows)]
struct KeyHandle(windows::Win32::System::Registry::HKEY);

#[cfg(windows)]
impl Drop for KeyHandle {
    fn drop(&mut self) {
        // SAFETY: the handle came from RegOpenKeyExW or RegCreateKeyExW and is
        // closed exactly once.
        unsafe {
            let _ = windows::Win32::System::Registry::RegCloseKey(self.0);
        }
    }
}

#[cfg(windows)]
fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

#[cfg(windows)]
fn map_error(status: windows::Win32::Foundation::WIN32_ERROR) -> String {
    if status == windows::Win32::Foundation::ERROR_ACCESS_DENIED {
        "windows_integration.denied".to_string()
    } else {
        "windows_integration.failed".to_string()
    }
}

#[cfg(windows)]
fn to_registry_type(value_type: RegistryValueType) -> windows::Win32::System::Registry::REG_VALUE_TYPE {
    use windows::Win32::System::Registry::{
        REG_BINARY, REG_DWORD, REG_EXPAND_SZ, REG_NONE, REG_SZ,
    };
    match value_type {
        RegistryValueType::String => REG_SZ,
        RegistryValueType::ExpandString => REG_EXPAND_SZ,
        RegistryValueType::Binary => REG_BINARY,
        RegistryValueType::Dword => REG_DWORD,
        RegistryValueType::None => REG_NONE,
    }
}

#[cfg(windows)]
fn from_registry_type(
    value_type: windows::Win32::System::Registry::REG_VALUE_TYPE,
) -> Result<RegistryValueType, String> {
    match value_type.0 {
        1 => Ok(RegistryValueType::String),
        2 => Ok(RegistryValueType::ExpandString),
        3 => Ok(RegistryValueType::Binary),
        4 => Ok(RegistryValueType::Dword),
        0 => Ok(RegistryValueType::None),
        _ => Err("windows_integration.changed".to_string()),
    }
}

#[cfg(windows)]
impl RegistryBackend for WindowsRegistry {
    fn read(&self, key: &str, name: &str) -> Result<Option<StoredValue>, String> {
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
        use windows::Win32::System::Registry::{
            RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ, KEY_WOW64_64KEY,
            REG_VALUE_TYPE,
        };

        if key.chars().count() > MAX_KEY_CHARS || name.chars().count() > MAX_NAME_CHARS {
            return Err("windows_integration.bad_request".to_string());
        }
        let key_wide = wide(key);
        let mut handle = HKEY(std::ptr::null_mut());
        // SAFETY: the key string outlives the call and `handle` is written by
        // Windows on success.
        let status = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                PCWSTR(key_wide.as_ptr()),
                None,
                KEY_READ | KEY_WOW64_64KEY,
                &mut handle,
            )
        };
        if status == ERROR_FILE_NOT_FOUND {
            return Ok(None);
        }
        if status != ERROR_SUCCESS {
            return Err(map_error(status));
        }
        let key_handle = KeyHandle(handle);
        let name_wide = wide(name);
        let mut value_type = REG_VALUE_TYPE::default();
        let mut length: u32 = 0;
        // SAFETY: both pointers are valid for the duration of the call.
        let status = unsafe {
            RegQueryValueExW(
                key_handle.0,
                PCWSTR(name_wide.as_ptr()),
                None,
                Some(&mut value_type),
                None,
                Some(&mut length),
            )
        };
        if status == ERROR_FILE_NOT_FOUND {
            return Ok(None);
        }
        if status != ERROR_SUCCESS {
            return Err(map_error(status));
        }
        if length as usize > MAX_REGISTRY_VALUE_BYTES {
            return Err("windows_integration.bad_request".to_string());
        }
        let mut buffer = vec![0u8; length.max(1) as usize];
        let mut read_length = length;
        // SAFETY: the buffer is at least `length` bytes, as reported above.
        let status = unsafe {
            RegQueryValueExW(
                key_handle.0,
                PCWSTR(name_wide.as_ptr()),
                None,
                Some(&mut value_type),
                Some(buffer.as_mut_ptr()),
                Some(&mut read_length),
            )
        };
        if status != ERROR_SUCCESS {
            return Err(map_error(status));
        }
        buffer.truncate(read_length as usize);
        Ok(Some(StoredValue {
            value_type: from_registry_type(value_type)?,
            bytes: buffer,
        }))
    }

    fn write(&self, key: &str, name: &str, value: &StoredValue) -> Result<(), String> {
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::ERROR_SUCCESS;
        use windows::Win32::System::Registry::{
            RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE,
            KEY_SET_VALUE, KEY_WOW64_64KEY, REG_OPTION_NON_VOLATILE,
        };

        if key.chars().count() > MAX_KEY_CHARS || name.chars().count() > MAX_NAME_CHARS {
            return Err("windows_integration.bad_request".to_string());
        }
        value.validate()?;
        let key_wide = wide(key);
        let mut handle = HKEY(std::ptr::null_mut());
        // SAFETY: the key string outlives the call; `handle` is written on
        // success and closed by the guard below.
        let status = unsafe {
            RegCreateKeyExW(
                HKEY_CURRENT_USER,
                PCWSTR(key_wide.as_ptr()),
                None,
                PCWSTR::null(),
                REG_OPTION_NON_VOLATILE,
                KEY_SET_VALUE | KEY_QUERY_VALUE | KEY_WOW64_64KEY,
                None,
                &mut handle,
                None,
            )
        };
        if status != ERROR_SUCCESS {
            return Err(map_error(status));
        }
        let key_handle = KeyHandle(handle);
        let name_wide = wide(name);
        // SAFETY: the value bytes outlive the call.
        let status = unsafe {
            RegSetValueExW(
                key_handle.0,
                PCWSTR(name_wide.as_ptr()),
                None,
                to_registry_type(value.value_type),
                Some(value.bytes.as_slice()),
            )
        };
        if status != ERROR_SUCCESS {
            return Err(map_error(status));
        }
        Ok(())
    }

    fn delete(&self, key: &str, name: &str) -> Result<(), String> {
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS};
        use windows::Win32::System::Registry::{
            RegDeleteValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_SET_VALUE,
            KEY_WOW64_64KEY,
        };

        if key.chars().count() > MAX_KEY_CHARS || name.chars().count() > MAX_NAME_CHARS {
            return Err("windows_integration.bad_request".to_string());
        }
        let key_wide = wide(key);
        let mut handle = HKEY(std::ptr::null_mut());
        // SAFETY: the key string outlives the call.
        let status = unsafe {
            RegOpenKeyExW(
                HKEY_CURRENT_USER,
                PCWSTR(key_wide.as_ptr()),
                None,
                KEY_SET_VALUE | KEY_WOW64_64KEY,
                &mut handle,
            )
        };
        if status == ERROR_FILE_NOT_FOUND {
            return Ok(());
        }
        if status != ERROR_SUCCESS {
            return Err(map_error(status));
        }
        let key_handle = KeyHandle(handle);
        let name_wide = wide(name);
        // SAFETY: the value name outlives the call.
        let status = unsafe { RegDeleteValueW(key_handle.0, PCWSTR(name_wide.as_ptr())) };
        if status == ERROR_FILE_NOT_FOUND || status == ERROR_SUCCESS {
            Ok(())
        } else {
            Err(map_error(status))
        }
    }
}

/// Non-Windows builds only exist for documentation tooling; registry work is
/// unavailable and never pretends to succeed.
#[cfg(not(windows))]
pub struct WindowsRegistry;

#[cfg(not(windows))]
impl RegistryBackend for WindowsRegistry {
    fn read(&self, _key: &str, _name: &str) -> Result<Option<StoredValue>, String> {
        Err("windows_integration.failed".to_string())
    }

    fn write(&self, _key: &str, _name: &str, _value: &StoredValue) -> Result<(), String> {
        Err("windows_integration.failed".to_string())
    }

    fn delete(&self, _key: &str, _name: &str) -> Result<(), String> {
        Err("windows_integration.failed".to_string())
    }
}

/// Small counters used by the tests to prove a refused request performs no
/// registry work at all.
#[derive(Debug, Default)]
pub struct BackendCounters {
    reads: AtomicU64,
    writes: AtomicU32,
    deletes: AtomicU32,
}

impl BackendCounters {
    pub fn reads(&self) -> u64 {
        self.reads.load(Ordering::Relaxed)
    }

    pub fn writes(&self) -> u32 {
        self.writes.load(Ordering::Relaxed)
    }

    pub fn deletes(&self) -> u32 {
        self.deletes.load(Ordering::Relaxed)
    }

    pub fn record_read(&self) {
        self.reads.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_write(&self) {
        self.writes.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_delete(&self) {
        self.deletes.fetch_add(1, Ordering::Relaxed);
    }
}

/// Re-exported so the owning command module can validate a value before it
/// asks the backend to write it.
pub fn assert_owned_value(key: &str, name: &str, value: &StoredValue) -> Result<(), String> {
    if !is_owned_value(key, name) {
        return Err("windows_integration.bad_request".to_string());
    }
    value.validate()
}

#[cfg(test)]
#[path = "windows_registry_step16_tests.rs"]
mod step16_tests;
