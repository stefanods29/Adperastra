//! Verified portable copy of the app data (Step 10c T6, E6).
//!
//! The destination must be new or empty. Sources are only app-owned
//! categories; shared engine packs are optional. Every file is copied through
//! an owned staging folder, hashed, and listed in a manifest that is written
//! last. The original data is never moved, merged or deleted, and only the
//! staging folder this run created can be cleaned up.

use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};

use fs_service::CancellationToken;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, State, WebviewWindow};
use uuid::Uuid;

use crate::jobs::{spawn_job, Jobs};
use crate::portable_copy_manifest::{
    build_manifest, manifest_bytes, manifest_sha256, ManifestFile,
    MANIFEST_FILE_NAME,
};
use crate::profile_root::ProfileServiceState;
use crate::{ensure_main, valid_request_id, validate_absolute_path};

pub const MAX_COPY_FILES: usize = 200_000;
pub const COPY_CHUNK_BYTES: usize = 1024 * 1024;
pub const STAGING_PREFIX: &str = "~adp-portable-";
const MAX_ERROR_CODES: usize = 256;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// Top-level app-owned files copied by every portable copy.
const OWNED_FILES: &[&str] = &[
    "settings.json",
    "session.json",
    "explorer-state.json",
    "folder-views.json",
    "saved-tab-groups.json",
    "profiles.json",
];

/// Top-level app-owned folders. `webview` and `logs` are deliberately
/// excluded: they are machine-local caches, not portable app data.
const OWNED_DIRS: &[&str] = &[
    "profiles",
    "versions",
    "recovery",
    "themes",
    "locked-pending",
    "templates",
    "tags",
    "index",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableCopyRequest {
    pub dest_dir: String,
    pub include_packs: bool,
    pub expected_base: String,
    pub nooverwrite: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PortableCopyReport {
    pub dest_dir: String,
    pub files_copied: u32,
    pub bytes_copied: u64,
    pub manifest_sha256: String,
    pub complete: bool,
    pub error_codes: Vec<String>,
    pub source_retained: bool,
}

#[derive(Debug, Clone)]
pub struct SourceEntry {
    pub absolute: PathBuf,
    /// Forward-slash path below the app-data base.
    pub relative: String,
    pub is_dir: bool,
    pub bytes: u64,
}

/// The file access used by the copy. Tests inject failures and cancellation
/// without touching the real app data.
pub trait CopySource {
    fn entries(&self, base: &Path, include_packs: bool) -> Result<Vec<SourceEntry>, String>;
    fn open_file(&self, path: &Path) -> Result<Box<dyn Read + Send>, String>;
    fn sha256(&self, path: &Path) -> Result<String, String>;
}

pub struct FsSource;

fn is_private_path(path: &Path) -> bool {
    path.components().any(|component| {
        matches!(component, Component::Normal(name) if name.to_string_lossy().eq_ignore_ascii_case(".adperastra"))
    })
}

fn is_reparse_or_symlink(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}

impl CopySource for FsSource {
    fn entries(&self, base: &Path, include_packs: bool) -> Result<Vec<SourceEntry>, String> {
        if is_private_path(base) {
            return Err("profiles.copy_failed".to_string());
        }
        let mut result = Vec::new();
        for name in OWNED_FILES {
            let path = base.join(name);
            if path.is_file() {
                push_entry(base, &path, &mut result)?;
            }
        }
        for name in OWNED_DIRS {
            let path = base.join(name);
            if path.is_dir() {
                push_entry(base, &path, &mut result)?;
            }
        }
        if include_packs {
            let packs = base.join("packs");
            if packs.is_dir() {
                push_entry(base, &packs, &mut result)?;
            }
        }
        Ok(result)
    }

    fn open_file(&self, path: &Path) -> Result<Box<dyn Read + Send>, String> {
        Ok(Box::new(File::open(path).map_err(|_| "profiles.copy_failed".to_string())?))
    }

    fn sha256(&self, path: &Path) -> Result<String, String> {
        let mut file = File::open(path).map_err(|_| "profiles.copy_failed".to_string())?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; COPY_CHUNK_BYTES];
        loop {
            let read = file
                .read(&mut buffer)
                .map_err(|_| "profiles.copy_failed".to_string())?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
        }
        Ok(format!("{:x}", hasher.finalize()))
    }
}

fn push_entry(base: &Path, path: &Path, out: &mut Vec<SourceEntry>) -> Result<(), String> {
    if out.len() >= MAX_COPY_FILES {
        return Err("profiles.copy_failed".to_string());
    }
    if is_private_path(path) {
        return Ok(());
    }
    let metadata = std::fs::symlink_metadata(path).map_err(|_| "profiles.copy_failed".to_string())?;
    if is_reparse_or_symlink(&metadata) {
        return Ok(());
    }
    let relative = path
        .strip_prefix(base)
        .map_err(|_| "profiles.copy_failed".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    if metadata.is_dir() {
        out.push(SourceEntry {
            absolute: path.to_path_buf(),
            relative,
            is_dir: true,
            bytes: 0,
        });
        let mut children: Vec<PathBuf> = std::fs::read_dir(path)
            .map_err(|_| "profiles.copy_failed".to_string())?
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .collect();
        children.sort();
        for child in children {
            push_entry(base, &child, out)?;
        }
        return Ok(());
    }
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    if name.starts_with("~adp-") || name.ends_with(".partial") || name.ends_with(".tmp") {
        return Ok(());
    }
    out.push(SourceEntry {
        absolute: path.to_path_buf(),
        relative,
        is_dir: false,
        bytes: metadata.len(),
    });
    Ok(())
}

fn normalized_text(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('\\', "/");
    let without_verbatim = if let Some(rest) = raw.strip_prefix("//?/UNC/") {
        format!("//{rest}")
    } else if let Some(rest) = raw.strip_prefix("//?/") {
        rest.to_string()
    } else {
        raw
    };
    without_verbatim
        .trim_end_matches('/')
        .to_ascii_lowercase()
}

fn same_path(a: &Path, b: &Path) -> bool {
    normalized_text(a) == normalized_text(b)
}

fn is_inside(parent: &Path, child: &Path) -> bool {
    let parent = normalized_text(parent);
    let child = normalized_text(child);
    child.len() > parent.len()
        && child.starts_with(&parent)
        && child.as_bytes().get(parent.len()) == Some(&b'/')
}

struct ValidatedCopy {
    base: PathBuf,
    dest: PathBuf,
    dest_existed: bool,
}

fn validate_request(base: &Path, request: &PortableCopyRequest) -> Result<ValidatedCopy, String> {
    if !request.nooverwrite {
        return Err("profiles.invalid".to_string());
    }
    validate_absolute_path(&request.expected_base).map_err(|_| "profiles.invalid".to_string())?;
    validate_absolute_path(&request.dest_dir).map_err(|_| "profiles.invalid".to_string())?;
    let expected = PathBuf::from(&request.expected_base);
    if !same_path(&expected, base) {
        return Err("profiles.changed".to_string());
    }
    if is_private_path(base) {
        return Err("profiles.copy_failed".to_string());
    }
    let dest = PathBuf::from(&request.dest_dir);
    if same_path(&dest, base) || is_inside(base, &dest) || is_inside(&dest, base) {
        return Err("profiles.copy_failed".to_string());
    }
    let dest_existed = match std::fs::metadata(&dest) {
        Ok(metadata) => {
            if !metadata.is_dir() {
                return Err("profiles.copy_failed".to_string());
            }
            let mut entries = std::fs::read_dir(&dest).map_err(|_| "profiles.copy_failed".to_string())?;
            if entries.next().is_some() {
                return Err("profiles.copy_failed".to_string());
            }
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = dest.parent().ok_or_else(|| "profiles.copy_failed".to_string())?;
            if !parent.is_dir() {
                return Err("profiles.copy_failed".to_string());
            }
            false
        }
        Err(_) => return Err("profiles.copy_failed".to_string()),
    };
    Ok(ValidatedCopy {
        base: base.to_path_buf(),
        dest,
        dest_existed,
    })
}

struct Staging {
    path: PathBuf,
    published: bool,
}

impl Staging {
    fn create(parent: &Path) -> Result<Self, String> {
        for _ in 0..8 {
            let path = parent.join(format!("{STAGING_PREFIX}{}.partial", Uuid::new_v4()));
            match std::fs::create_dir(&path) {
                Ok(()) => return Ok(Self { path, published: false }),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(_) => return Err("profiles.copy_failed".to_string()),
            }
        }
        Err("profiles.copy_failed".to_string())
    }

    /// Publish into an empty destination that already existed.
    fn publish_into_empty(&mut self, dest: &Path) -> Result<(), String> {
        let mut children: Vec<PathBuf> = std::fs::read_dir(&self.path)
            .map_err(|_| "profiles.copy_failed".to_string())?
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .collect();
        // The manifest is published only after every copied file.
        children.sort_by_key(|child| {
            child
                .file_name()
                .map(|name| name.to_string_lossy() == MANIFEST_FILE_NAME)
                == Some(true)
        });
        for child in children {
            let name = child
                .file_name()
                .ok_or_else(|| "profiles.copy_failed".to_string())?;
            let target = dest.join(name);
            if target.exists() {
                return Err("profiles.copy_failed".to_string());
            }
            std::fs::rename(&child, &target).map_err(|_| "profiles.copy_failed".to_string())?;
        }
        let _ = std::fs::remove_dir(&self.path);
        self.published = true;
        Ok(())
    }
}

impl Drop for Staging {
    fn drop(&mut self) {
        if !self.published {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}

fn failure_with_counts(
    dest: &Path,
    code: &str,
    files_copied: u32,
    bytes_copied: u64,
) -> PortableCopyReport {
    PortableCopyReport {
        dest_dir: dest.to_string_lossy().into_owned(),
        files_copied,
        bytes_copied,
        manifest_sha256: String::new(),
        complete: false,
        error_codes: vec![code.to_string()],
        source_retained: true,
    }
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn copy_one(
    source: &dyn CopySource,
    entry: &SourceEntry,
    target: &Path,
    token: &CancellationToken,
) -> Result<String, String> {
    let mut reader = source.open_file(&entry.absolute)?;
    let mut writer = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
        .map_err(|_| "profiles.copy_failed".to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; COPY_CHUNK_BYTES];
    let mut written = 0u64;
    loop {
        if token.load(Ordering::Relaxed) {
            return Err("profiles.copy_failed".to_string());
        }
        let read = reader
            .read(&mut buffer)
            .map_err(|_| "profiles.copy_failed".to_string())?;
        if read == 0 {
            break;
        }
        writer
            .write_all(&buffer[..read])
            .map_err(|_| "profiles.copy_failed".to_string())?;
        hasher.update(&buffer[..read]);
        written = written.saturating_add(read as u64);
    }
    writer
        .sync_all()
        .map_err(|_| "profiles.copy_failed".to_string())?;
    if written != entry.bytes {
        return Err("profiles.copy_failed".to_string());
    }
    let written_hash = format!("{:x}", hasher.finalize());
    let source_hash = source.sha256(&entry.absolute)?;
    if written_hash != source_hash {
        return Err("profiles.copy_failed".to_string());
    }
    Ok(written_hash)
}

/// Copy every app-owned entry into owned staging and publish a manifest last.
/// Expected failures (cancel, read error, hash mismatch) return a report with
/// `complete: false`; a bad request is an `Err` before any write.
pub fn copy_app_data(
    base: &Path,
    request: &PortableCopyRequest,
    token: &CancellationToken,
    source: &dyn CopySource,
    on_progress: &mut dyn FnMut(u32, u32, u64),
) -> Result<PortableCopyReport, String> {
    let validated = validate_request(base, request)?;
    let entries = source.entries(&validated.base, request.include_packs)?;
    let total_files = entries.iter().filter(|entry| !entry.is_dir).count() as u32;
    let total_bytes = entries
        .iter()
        .filter(|entry| !entry.is_dir)
        .try_fold(0u64, |total, entry| total.checked_add(entry.bytes))
        .ok_or_else(|| "profiles.copy_failed".to_string())?;
    if total_bytes > MAX_SAFE_INTEGER {
        return Err("profiles.copy_failed".to_string());
    }
    let free = archive::free_bytes(
        validated
            .dest
            .parent()
            .unwrap_or(&validated.dest),
    );
    if archive::check_space(total_bytes, free, &archive::Limits::default()).is_err() {
        return Err("profiles.copy_failed".to_string());
    }

    let parent = validated
        .dest
        .parent()
        .ok_or_else(|| "profiles.copy_failed".to_string())?;
    let mut staging = Staging::create(parent)?;
    let mut manifest_files: Vec<ManifestFile> = Vec::new();
    let mut files_copied = 0u32;
    let mut bytes_copied = 0u64;

    for entry in &entries {
        if token.load(Ordering::Relaxed) {
            return Ok(failure_with_counts(
                &validated.dest,
                "profiles.copy_failed",
                files_copied,
                bytes_copied,
            ));
        }
        let target = staging.path.join(&entry.relative);
        if entry.is_dir {
            if std::fs::create_dir_all(&target).is_err() {
                return Ok(failure_with_counts(
                    &validated.dest,
                    "profiles.copy_failed",
                    files_copied,
                    bytes_copied,
                ));
            }
            continue;
        }
        if let Some(parent) = target.parent() {
            if std::fs::create_dir_all(parent).is_err() {
                return Ok(failure_with_counts(
                    &validated.dest,
                    "profiles.copy_failed",
                    files_copied,
                    bytes_copied,
                ));
            }
        }
        match copy_one(source, entry, &target, token) {
            Ok(hash) => {
                manifest_files.push(ManifestFile {
                    relative_path: entry.relative.clone(),
                    bytes: entry.bytes,
                    sha256: hash,
                });
                files_copied = files_copied.saturating_add(1);
                bytes_copied = bytes_copied.saturating_add(entry.bytes);
                on_progress(files_copied, total_files, bytes_copied);
            }
            Err(_) => {
                return Ok(failure_with_counts(
                    &validated.dest,
                    "profiles.copy_failed",
                    files_copied,
                    bytes_copied,
                ))
            }
        }
    }

    let manifest = build_manifest("app-data", manifest_files, now_unix())
        .map_err(|_| "profiles.copy_failed".to_string())?;
    let bytes = manifest_bytes(&manifest)?;
    let manifest_path = staging.path.join(MANIFEST_FILE_NAME);
    let mut manifest_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&manifest_path)
        .map_err(|_| "profiles.copy_failed".to_string())?;
    if manifest_file.write_all(&bytes).is_err() || manifest_file.sync_all().is_err() {
        return Ok(failure_with_counts(
            &validated.dest,
            "profiles.copy_failed",
            files_copied,
            bytes_copied,
        ));
    }
    drop(manifest_file);

    if validated.dest_existed {
        if staging.publish_into_empty(&validated.dest).is_err() {
            return Ok(failure_with_counts(
                &validated.dest,
                "profiles.copy_failed",
                files_copied,
                bytes_copied,
            ));
        }
    } else if std::fs::rename(&staging.path, &validated.dest).is_err() {
        return Ok(failure_with_counts(
            &validated.dest,
            "profiles.copy_failed",
            files_copied,
            bytes_copied,
        ));
    } else {
        staging.published = true;
    }

    Ok(PortableCopyReport {
        dest_dir: validated.dest.to_string_lossy().into_owned(),
        files_copied,
        bytes_copied,
        manifest_sha256: manifest_sha256(&manifest)?,
        complete: true,
        error_codes: Vec::new(),
        source_retained: true,
    })
}

/// `portable_copy_start`: the request shape and the job id are checked before
/// a job exists, then the work runs in the shared job table.
#[tauri::command]
pub fn portable_copy_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    profile: State<'_, ProfileServiceState>,
    request_id: String,
    request: PortableCopyRequest,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    if !profile.location.writable {
        return Err("profiles.not_writable".to_string());
    }
    let base = profile.location.data_dir.clone();
    validate_request(&base, &request)?;
    let token = jobs.begin(&request_id, 0)?;
    spawn_job(app, request_id, token, move |ctx| {
        let source = FsSource;
        let report = copy_app_data(&base, &request, ctx.token(), &source, &mut |done, total, bytes| {
            let progress = fs_service::OpProgress {
                items_done: done as usize,
                items_total: total as usize,
                bytes_done: bytes,
                bytes_total: 0,
                current: String::new(),
            };
            ctx.set_progress(&progress);
        })?;
        let mut error_codes = report.error_codes.clone();
        error_codes.truncate(MAX_ERROR_CODES);
        serde_json::to_value(PortableCopyReport {
            error_codes,
            ..report
        })
        .map_err(|_| "profiles.copy_failed".to_string())
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::portable_copy_manifest::{validate_manifest, PortableManifest};

    struct Fixture {
        temp: tempfile::TempDir,
        base: PathBuf,
        dest: PathBuf,
    }

    fn fixture() -> Fixture {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().join("data");
        std::fs::create_dir_all(base.join("versions")).unwrap();
        std::fs::create_dir_all(base.join("recovery")).unwrap();
        std::fs::create_dir_all(base.join("packs")).unwrap();
        std::fs::create_dir_all(base.join("webview")).unwrap();
        std::fs::write(base.join("settings.json"), b"{\"schema_version\":30}").unwrap();
        std::fs::write(base.join("versions").join("one.bin"), b"one").unwrap();
        std::fs::write(base.join("recovery").join("record.bin"), b"recover").unwrap();
        std::fs::write(base.join("packs").join("engine.dll"), b"pack").unwrap();
        std::fs::write(base.join("webview").join("cache.bin"), b"cache").unwrap();
        let dest = temp.path().join("portable");
        Fixture { temp, base, dest }
    }

    fn request(base: &Path, dest: &Path) -> PortableCopyRequest {
        PortableCopyRequest {
            dest_dir: dest.to_string_lossy().into_owned(),
            include_packs: false,
            expected_base: base.to_string_lossy().into_owned(),
            nooverwrite: true,
        }
    }

    fn copy(fixture: &Fixture) -> PortableCopyReport {
        let token = fs_service::new_cancellation_token();
        copy_app_data(
            &fixture.base,
            &request(&fixture.base, &fixture.dest),
            &token,
            &FsSource,
            &mut |_, _, _| {},
        )
        .unwrap()
    }

    #[test]
    fn refuses_a_non_empty_destination_and_keeps_its_files() {
        let fixture = fixture();
        std::fs::create_dir_all(&fixture.dest).unwrap();
        std::fs::write(fixture.dest.join("foreign.txt"), b"keep").unwrap();
        let token = fs_service::new_cancellation_token();
        assert_eq!(
            copy_app_data(
                &fixture.base,
                &request(&fixture.base, &fixture.dest),
                &token,
                &FsSource,
                &mut |_, _, _| {},
            ),
            Err("profiles.copy_failed".to_string())
        );
        assert_eq!(
            std::fs::read(fixture.dest.join("foreign.txt")).unwrap(),
            b"keep".to_vec()
        );
    }

    #[test]
    fn copies_app_data_without_webview_or_packs_by_default() {
        let fixture = fixture();
        let report = copy(&fixture);
        assert!(report.complete);
        assert!(report.source_retained);
        assert!(fixture.dest.join("settings.json").is_file());
        assert!(fixture.dest.join("versions/one.bin").is_file());
        assert!(!fixture.dest.join("webview").exists());
        assert!(!fixture.dest.join("packs").exists());
        assert!(fixture.base.join("settings.json").is_file());
    }

    #[test]
    fn the_manifest_has_a_hash_for_every_copied_file() {
        let fixture = fixture();
        let report = copy(&fixture);
        let bytes = std::fs::read(fixture.dest.join(MANIFEST_FILE_NAME)).unwrap();
        let manifest: PortableManifest = serde_json::from_slice(&bytes).unwrap();
        validate_manifest(&manifest).unwrap();
        assert_eq!(manifest.files.len(), report.files_copied as usize);
        for file in &manifest.files {
            let copied = fixture.dest.join(file.relative_path.replace('/', "\\"));
            assert_eq!(std::fs::read(&copied).unwrap().len() as u64, file.bytes);
            assert_eq!(file.sha256, sha256_bytes(&std::fs::read(&copied).unwrap()));
        }
        assert_eq!(report.manifest_sha256, manifest_sha256(&manifest).unwrap());
    }

    fn sha256_bytes(bytes: &[u8]) -> String {
        let mut hasher = Sha256::new();
        hasher.update(bytes);
        format!("{:x}", hasher.finalize())
    }

    struct FailingSource {
        fail_on: &'static str,
    }

    impl CopySource for FailingSource {
        fn entries(&self, base: &Path, include_packs: bool) -> Result<Vec<SourceEntry>, String> {
            FsSource.entries(base, include_packs)
        }

        fn open_file(&self, path: &Path) -> Result<Box<dyn Read + Send>, String> {
            FsSource.open_file(path)
        }

        fn sha256(&self, path: &Path) -> Result<String, String> {
            if path.ends_with(self.fail_on) {
                Err("profiles.copy_failed".to_string())
            } else {
                FsSource.sha256(path)
            }
        }
    }

    #[test]
    fn a_source_hash_failure_publishes_no_complete_copy() {
        let fixture = fixture();
        let token = fs_service::new_cancellation_token();
        let report = copy_app_data(
            &fixture.base,
            &request(&fixture.base, &fixture.dest),
            &token,
            &FailingSource {
                fail_on: "settings.json",
            },
            &mut |_, _, _| {},
        )
        .unwrap();
        assert!(!report.complete);
        assert_eq!(report.error_codes, vec!["profiles.copy_failed".to_string()]);
        assert!(!fixture.dest.exists());
        assert!(fixture.base.join("settings.json").is_file());
    }

    #[test]
    fn cancellation_keeps_the_source_and_publishes_nothing() {
        let fixture = fixture();
        let token = fs_service::new_cancellation_token();
        token.store(true, Ordering::Relaxed);
        let report = copy_app_data(
            &fixture.base,
            &request(&fixture.base, &fixture.dest),
            &token,
            &FsSource,
            &mut |_, _, _| {},
        )
        .unwrap();
        assert!(!report.complete);
        assert!(!fixture.dest.exists());
        assert!(fixture.base.join("settings.json").is_file());
    }

    #[test]
    fn a_foreign_staging_like_folder_is_never_guessed_or_deleted() {
        let fixture = fixture();
        let foreign = fixture.temp.path().join("~adp-portable-foreign.partial");
        std::fs::create_dir_all(&foreign).unwrap();
        std::fs::write(foreign.join("keep.txt"), b"foreign").unwrap();
        let _ = copy(&fixture);
        assert!(foreign.join("keep.txt").exists());
    }

    #[test]
    fn the_private_signing_folder_is_never_read() {
        assert!(is_private_path(Path::new(
            "C:\\Users\\someone\\.adperastra\\signing-key.pfx"
        )));
        assert!(is_private_path(Path::new("C:\\Users\\someone\\.ADPERASTRA")));
        assert!(!is_private_path(Path::new(
            "C:\\Users\\someone\\AppData\\Local\\Adperastra"
        )));
    }

    #[test]
    fn the_expected_base_must_match() {
        let fixture = fixture();
        let mut wrong = request(&fixture.base, &fixture.dest);
        wrong.expected_base = fixture.temp.path().join("other").to_string_lossy().into_owned();
        let token = fs_service::new_cancellation_token();
        assert_eq!(
            copy_app_data(&fixture.base, &wrong, &token, &FsSource, &mut |_, _, _| {}),
            Err("profiles.changed".to_string())
        );
    }
}
