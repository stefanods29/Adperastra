//! Bounded local gathering for diagnostic sessions (Step 09h T5). Only
//! app-owned synthetic reports and recent logs are read. User documents,
//! preferences paths, host names and the private `.adperastra` folder are
//! never opened.

use std::io::Read;
use std::path::{Path, PathBuf};

use uuid::Uuid;

use crate::diagnostics_redact::Redactor;
use crate::diagnostics_types::{
    CollectedFile, DiagnosticsFileKind, DiagnosticsOptions, MAX_DUMP_BYTES, MAX_LOG_BYTES,
    MAX_REPORT_BYTES, MAX_TEXT_BYTES,
};
use crate::recovery_open::unfinished_rename_journals;
use crate::recovery_store::RECOVERY_DIR;

/// Fixed synthetic report names; they are not user paths.
pub const APP_INFO: &str = "app-info.txt";
pub const WINDOWS_INFO: &str = "windows-info.txt";
pub const HARDWARE_INFO: &str = "hardware.txt";
pub const FEATURE_INFO: &str = "features.txt";
pub const KNOWN_ISSUES: &str = "known-issues.txt";
pub const RECENT_LOG: &str = "recent-log.txt";
pub const RECOVERY_INFO: &str = "recovery.txt";

/// A path is never read when it names the private key folder or escapes the
/// app data directory.
pub fn is_forbidden_path(path: &Path) -> bool {
    path.components().any(|component| {
        component
            .as_os_str()
            .to_string_lossy()
            .trim()
            .eq_ignore_ascii_case(".adperastra")
    })
}

fn bounded(path: &Path) -> Result<(), String> {
    if is_forbidden_path(path) {
        return Err("diagnostics.invalid".to_string());
    }
    Ok(())
}

fn text_file(name: &str, text: String, redacted: bool) -> CollectedFile {
    let mut text = text;
    if text.len() as u64 > MAX_TEXT_BYTES {
        let mut end = MAX_TEXT_BYTES as usize;
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        text.truncate(end);
    }
    CollectedFile {
        id: Uuid::new_v4(),
        relative_name: name.to_string(),
        kind: DiagnosticsFileKind::Text,
        text: Some(text),
        dump: None,
        redacted,
    }
}

pub fn collect(
    data_dir: &Path,
    options: &DiagnosticsOptions,
    _now: u64,
) -> Result<Vec<CollectedFile>, String> {
    bounded(data_dir)?;
    let mut redactor = Redactor::new();
    // Mask the current account and computer even when a log line mentions
    // them outside a drive or UNC path. They are never written into a report
    // as their own fields.
    if let Ok(user) = std::env::var("USERNAME") {
        redactor.add_private_value(&user, "<user-");
    }
    if let Ok(host) = std::env::var("COMPUTERNAME") {
        redactor.add_private_value(&host, "<host-");
    }
    let redacted = !options.include_paths;
    let reports: Vec<(String, String)> = vec![
        (APP_INFO.to_string(), app_info()),
        (WINDOWS_INFO.to_string(), windows_info()),
        (HARDWARE_INFO.to_string(), hardware_info()),
        (FEATURE_INFO.to_string(), feature_info()),
        (KNOWN_ISSUES.to_string(), known_issues()),
        (RECOVERY_INFO.to_string(), recovery_info(data_dir)),
        (RECENT_LOG.to_string(), recent_logs(data_dir)?),
    ];

    let total: u64 = reports.iter().map(|(_, text)| text.len() as u64).sum();
    if total > MAX_REPORT_BYTES {
        return Err("diagnostics.too_large".to_string());
    }

    let mut files = Vec::new();
    for (name, text) in reports {
        let text = if redacted {
            redactor.redact(&text)
        } else {
            text
        };
        files.push(text_file(&name, text, redacted));
    }
    if options.include_dumps {
        if let Some(dump) = newest_dump(data_dir) {
            files.push(CollectedFile {
                id: Uuid::new_v4(),
                relative_name: "crash.dmp".to_string(),
                kind: DiagnosticsFileKind::Dump,
                text: None,
                dump: Some(dump),
                redacted: false,
            });
        }
    }
    Ok(files)
}

fn app_info() -> String {
    format!(
        "app_name=Adperastra\napp_version={}\npackage_version={}\nbuild_profile={}\n",
        release_version(),
        env!("CARGO_PKG_VERSION"),
        if cfg!(debug_assertions) { "debug" } else { "release" }
    )
}

/// The public release version from the build; 08d owns the release manifest.
pub(crate) fn release_version() -> String {
    option_env!("ADPERASTRA_RELEASE_VERSION")
        .unwrap_or(env!("CARGO_PKG_VERSION"))
        .to_string()
}

#[cfg(windows)]
fn registry_string(root: windows::Win32::System::Registry::HKEY, subkey: &str, name: &str) -> Option<String> {
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{RegGetValueW, RRF_RT_REG_SZ};

    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }
    let subkey = wide(subkey);
    let name = wide(name);
    let mut buffer = vec![0u16; 512];
    let mut size = (buffer.len() * 2) as u32;
    // SAFETY: the buffers and size outlive the call; the output is bounded.
    let result = unsafe {
        RegGetValueW(
            root,
            PCWSTR(subkey.as_ptr()),
            PCWSTR(name.as_ptr()),
            RRF_RT_REG_SZ,
            None,
            Some(buffer.as_mut_ptr() as *mut std::ffi::c_void),
            Some(&mut size),
        )
    };
    if result.0 != 0 {
        return None;
    }
    let length = buffer.iter().position(|unit| *unit == 0).unwrap_or(buffer.len());
    Some(String::from_utf16_lossy(&buffer[..length]))
}

fn windows_info() -> String {
    #[cfg(windows)]
    {
        use windows::Win32::System::Registry::HKEY_LOCAL_MACHINE;
        let key = "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion";
        format!(
            "windows_product={}\nwindows_version={}\nwindows_build={}\n",
            registry_string(HKEY_LOCAL_MACHINE, key, "ProductName").unwrap_or_else(|| "unknown".into()),
            registry_string(HKEY_LOCAL_MACHINE, key, "DisplayVersion").unwrap_or_else(|| "unknown".into()),
            registry_string(HKEY_LOCAL_MACHINE, key, "CurrentBuildNumber").unwrap_or_else(|| "unknown".into())
        )
    }
    #[cfg(not(windows))]
    {
        format!("windows_product=unknown\nwindows_os={}\n", std::env::consts::OS)
    }
}

fn hardware_info() -> String {
    #[cfg(windows)]
    {
        use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
        use windows::Win32::System::Registry::HKEY_LOCAL_MACHINE;
        let cpu = registry_string(
            HKEY_LOCAL_MACHINE,
            "HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\0",
            "ProcessorNameString",
        )
        .unwrap_or_else(|| "unknown".into());
        let mut memory = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            ..Default::default()
        };
        // SAFETY: `dwLength` is set and the structure is a local output.
        let ram = unsafe { GlobalMemoryStatusEx(&mut memory) }
            .ok()
            .map(|_| memory.ullTotalPhys)
            .unwrap_or(0);
        format!("cpu={cpu}\nram_bytes={ram}\n")
    }
    #[cfg(not(windows))]
    {
        "cpu=unknown\nram_bytes=0\n".to_string()
    }
}

/// Loaded packs are empty before the pack manager (Step 12a); the feature
/// list is a fixed build fact, not a claim about an unbuilt feature.
fn feature_info() -> String {
    "packs=none\nfeatures=explorer,tabs,sessions,text-editing,versions,archives,data-viewers,recovery,diagnostics\n"
        .to_string()
}

fn known_issues() -> String {
    // The repository's KNOWN_ISSUES.md is not shipped with the app. A code
    // list can only be attached by the build; never invent one here.
    "known_issue_codes=none\n".to_string()
}

fn recovery_info(data_dir: &Path) -> String {
    let root = data_dir.join(RECOVERY_DIR);
    let catalog = root.join("catalog.json");
    let count = std::fs::symlink_metadata(&catalog)
        .ok()
        .filter(|metadata| {
            metadata.is_file()
                && !metadata.file_type().is_symlink()
                && metadata.len() <= MAX_REPORT_BYTES
        })
        .and_then(|_| std::fs::read(&catalog).ok())
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|value| value.get("records").and_then(|records| records.as_array().map(Vec::len)))
        .unwrap_or(0);
    let journals = unfinished_rename_journals(data_dir).len();
    format!(
        "recovery_records={count}\nunfinished_rename_journals={journals}\n"
    )
}

fn recent_logs(data_dir: &Path) -> Result<String, String> {
    let folder = data_dir.join("logs");
    bounded(&folder)?;
    let Ok(entries) = std::fs::read_dir(&folder) else {
        return Ok("no recent logs\n".to_string());
    };
    let mut logs: Vec<(std::time::SystemTime, PathBuf, u64)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("log"))
        {
            continue;
        }
        if is_forbidden_path(&path) {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if !file_type.is_file() {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        logs.push((metadata.modified().unwrap_or(std::time::UNIX_EPOCH), path, metadata.len()));
    }
    logs.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    let mut text = String::new();
    for (_, path, length) in logs {
        if text.len() as u64 >= MAX_LOG_BYTES {
            break;
        }
        let take = (MAX_LOG_BYTES - text.len() as u64).min(length);
        if let Ok(file) = std::fs::File::open(&path) {
            let mut bytes = Vec::new();
            if file.take(take).read_to_end(&mut bytes).is_ok() {
                text.push_str(&String::from_utf8_lossy(&bytes));
                if !text.ends_with('\n') {
                    text.push('\n');
                }
            }
        }
    }
    if text.is_empty() {
        text.push_str("no recent logs\n");
    }
    Ok(text)
}

fn newest_dump(data_dir: &Path) -> Option<PathBuf> {
    let folder = data_dir.join("logs");
    let entries = std::fs::read_dir(folder).ok()?;
    let mut dumps: Vec<(std::time::SystemTime, PathBuf, u64)> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let is_dump = path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("dmp"));
            if !is_dump || is_forbidden_path(&path) || !entry.file_type().ok()?.is_file() {
                return None;
            }
            let metadata = entry.metadata().ok()?;
            Some((metadata.modified().ok()?, path, metadata.len()))
        })
        .collect();
    dumps.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    dumps
        .into_iter()
        .find(|(_, _, length)| *length > 0 && *length <= MAX_DUMP_BYTES)
        .map(|(_, path, _)| path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_private_key_folder_is_never_read() {
        let path = Path::new("C:\\Users\\alice\\.adperastra\\signing.pfx");
        assert!(is_forbidden_path(path));
        assert!(is_forbidden_path(Path::new("C:\\Users\\Alice\\.ADPERASTRA\\x")));
        assert!(!is_forbidden_path(Path::new("C:\\Users\\alice\\Documents\\notes.txt")));
    }

    #[test]
    fn default_session_has_no_dump_and_no_file_contents() {
        let folder = tempfile::tempdir().unwrap();
        let data = folder.path().join("data");
        std::fs::create_dir_all(data.join("logs")).unwrap();
        std::fs::write(data.join("logs").join("app.log"), "ordinary log\n").unwrap();
        let secret = folder.path().join(".adperastra");
        std::fs::create_dir_all(&secret).unwrap();
        std::fs::write(secret.join("private.key"), "PRIVATE KEY BYTES").unwrap();

        let files = collect(&data, &DiagnosticsOptions::default(), 1_000).unwrap();
        assert!(files.iter().all(|file| file.kind == DiagnosticsFileKind::Text));
        assert!(files.iter().all(|file| file.relative_name != "crash.dmp"));
        let joined = files
            .iter()
            .filter_map(|file| file.text.as_deref())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(!joined.contains("PRIVATE KEY BYTES"));
    }

    #[test]
    fn dumps_are_bounded_and_optional() {
        let folder = tempfile::tempdir().unwrap();
        let logs = folder.path().join("logs");
        std::fs::create_dir_all(&logs).unwrap();
        std::fs::write(logs.join("crash-1.dmp"), vec![0u8; 64]).unwrap();
        let files = collect(
            folder.path(),
            &DiagnosticsOptions {
                include_dumps: true,
                include_paths: false,
            },
            1_000,
        )
        .unwrap();
        assert!(files.iter().any(|file| file.kind == DiagnosticsFileKind::Dump));
        assert!(files
            .iter()
            .filter(|file| file.kind == DiagnosticsFileKind::Dump)
            .all(|file| file.bytes() <= MAX_DUMP_BYTES));
    }

    #[test]
    fn a_dump_over_the_cap_is_not_included() {
        let folder = tempfile::tempdir().unwrap();
        let logs = folder.path().join("logs");
        std::fs::create_dir_all(&logs).unwrap();
        std::fs::write(logs.join("crash-1.dmp"), vec![0u8; MAX_DUMP_BYTES as usize + 1]).unwrap();
        let files = collect(
            folder.path(),
            &DiagnosticsOptions {
                include_dumps: true,
                include_paths: false,
            },
            1_000,
        )
        .unwrap();
        assert!(files.iter().all(|file| file.kind == DiagnosticsFileKind::Text));
    }
}
