//! Metadata-only safety checks before a file-operation job changes anything.
use fs_service::{CancellationToken, ConflictPolicy, OpProgress, SkippedItem};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

pub struct Preflight {
    pub sources: Vec<PathBuf>,
    pub skipped: Vec<SkippedItem>,
    pub cancelled: bool,
}

/// Checks the complete mutation set before allowing its first change.
/// Missing transfer counterparts are normal (the forward action moved them).
pub fn check(
    kind: &str,
    sources: &[PathBuf],
    dest: Option<&Path>,
    policy: ConflictPolicy,
    allow_system: bool,
    token: &CancellationToken,
    progress: &mut dyn FnMut(&OpProgress),
) -> Result<Preflight, String> {
    let mut outcome = Preflight {
        sources: Vec::new(),
        skipped: Vec::new(),
        cancelled: false,
    };
    let mut scanner = Scanner {
        token,
        progress,
        last_report: Instant::now(),
    };
    let destructive = matches!(kind, "move" | "recycle" | "permanent" | "transfer");
    let mut needs_confirmation = false;
    for source in sources {
        if token.load(Ordering::Relaxed) {
            outcome.cancelled = true;
            outcome.sources.clear();
            return Ok(outcome);
        }
        let mut checks = Vec::new();
        if destructive {
            checks.push((source.clone(), None, kind == "transfer"));
        }
        if matches!(kind, "copy" | "move") && policy == ConflictPolicy::Replace {
            if let (Some(dest), Some(name)) = (dest, source.file_name()) {
                checks.push((dest.join(name), Some(source.as_path()), true));
            }
        }
        let mut skipped = false;
        for (path, replace_source, missing_ok) in checks {
            let check = if let Some(source) = replace_source {
                scanner.replacements(source, &path)
            } else {
                scanner.scan(&path, missing_ok)
            };
            match check {
                Ok(system) => needs_confirmation |= system,
                Err(ScanError::Cancelled) => {
                    outcome.cancelled = true;
                    outcome.sources.clear();
                    return Ok(outcome);
                }
                Err(ScanError::Skipped(reason)) => {
                    outcome.skipped.push(SkippedItem {
                        path: source.clone(),
                        reason,
                    });
                    skipped = true;
                    break;
                }
            }
        }
        if !skipped {
            outcome.sources.push(source.clone());
        }
    }
    if needs_confirmation && !allow_system {
        return Err("ops.system_confirmation_required".to_string());
    }
    Ok(outcome)
}

enum ScanError {
    Cancelled,
    Skipped(String),
}
struct Scanner<'a> {
    token: &'a CancellationToken,
    progress: &'a mut dyn FnMut(&OpProgress),
    last_report: Instant,
}
impl Scanner<'_> {
    fn replacements(&mut self, source: &Path, target: &Path) -> Result<bool, ScanError> {
        let mut pending = vec![(source.to_path_buf(), target.to_path_buf())];
        let mut found_system = false;
        while let Some((source, target)) = pending.pop() {
            if self.token.load(Ordering::Relaxed) {
                return Err(ScanError::Cancelled);
            }
            let target_metadata = match fs::symlink_metadata(&target) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => {
                    return Err(ScanError::Skipped(
                        fs_service::op_error_reason(&error.into()).to_string(),
                    ))
                }
            };
            let source_metadata = fs::symlink_metadata(&source).map_err(|error| {
                ScanError::Skipped(fs_service::op_error_reason(&error.into()).to_string())
            })?;
            if directory_reparse(&target_metadata) || directory_reparse(&source_metadata) {
                return Err(ScanError::Skipped("link_not_supported".to_string()));
            }
            // The engine refuses file/folder mismatches without changing either.
            if source_metadata.is_dir() != target_metadata.is_dir() {
                continue;
            }
            if protected_path(&target) {
                return Err(ScanError::Skipped("protected_path".to_string()));
            }
            found_system |= system_attribute(&target_metadata);
            self.report(&target);
            if source_metadata.is_dir() {
                let entries = fs::read_dir(&source).map_err(|error| {
                    ScanError::Skipped(fs_service::op_error_reason(&error.into()).to_string())
                })?;
                for entry in entries {
                    if self.token.load(Ordering::Relaxed) {
                        return Err(ScanError::Cancelled);
                    }
                    let entry = entry.map_err(|error| {
                        ScanError::Skipped(fs_service::op_error_reason(&error.into()).to_string())
                    })?;
                    pending.push((entry.path(), target.join(entry.file_name())));
                }
            }
        }
        Ok(found_system)
    }

    fn report(&mut self, path: &Path) {
        if self.last_report.elapsed() >= Duration::from_millis(50) {
            // Totals are unknown during preparation: show an indeterminate bar.
            (self.progress)(&OpProgress {
                items_done: 0,
                items_total: 0,
                bytes_done: 0,
                bytes_total: 0,
                current: path.to_string_lossy().into_owned(),
            });
            self.last_report = Instant::now();
        }
    }

    fn scan(&mut self, root: &Path, missing_ok: bool) -> Result<bool, ScanError> {
        if protected_path(root) {
            return Err(ScanError::Skipped("protected_path".to_string()));
        }
        let mut pending = vec![root.to_path_buf()];
        let mut found_system = false;
        while let Some(path) = pending.pop() {
            if self.token.load(Ordering::Relaxed) {
                return Err(ScanError::Cancelled);
            }
            let metadata = match fs::symlink_metadata(&path) {
                Ok(value) => value,
                Err(error) if missing_ok && error.kind() == std::io::ErrorKind::NotFound => {
                    continue
                }
                Err(error) => {
                    return Err(ScanError::Skipped(
                        fs_service::op_error_reason(&error.into()).to_string(),
                    ))
                }
            };
            if directory_reparse(&metadata) {
                return Err(ScanError::Skipped("link_not_supported".to_string()));
            }
            found_system |= system_attribute(&metadata);
            self.report(&path);
            if metadata.is_dir() {
                if protected_path(&path) {
                    return Err(ScanError::Skipped("protected_path".to_string()));
                }
                let entries = fs::read_dir(&path).map_err(|error| {
                    ScanError::Skipped(fs_service::op_error_reason(&error.into()).to_string())
                })?;
                for entry in entries {
                    if self.token.load(Ordering::Relaxed) {
                        return Err(ScanError::Cancelled);
                    }
                    let entry = entry.map_err(|error| {
                        ScanError::Skipped(fs_service::op_error_reason(&error.into()).to_string())
                    })?;
                    pending.push(entry.path());
                }
            }
        }
        Ok(found_system)
    }
}

#[cfg(windows)]
fn directory_reparse(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    let attributes = metadata.file_attributes();
    directory_reparse_attributes(attributes)
}
#[cfg(windows)]
fn directory_reparse_attributes(attributes: u32) -> bool {
    use windows::Win32::Storage::FileSystem::{
        FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT,
    };
    attributes & FILE_ATTRIBUTE_DIRECTORY.0 != 0 && attributes & FILE_ATTRIBUTE_REPARSE_POINT.0 != 0
}
#[cfg(not(windows))]
fn directory_reparse(metadata: &fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}
#[cfg(windows)]
fn system_attribute(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & windows::Win32::Storage::FileSystem::FILE_ATTRIBUTE_SYSTEM.0 != 0
}
#[cfg(not(windows))]
fn system_attribute(_metadata: &fs::Metadata) -> bool {
    false
}

fn path_key(path: &Path) -> String {
    let raw = path.to_string_lossy();
    let plain = if let Some(unc) = raw.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        raw.strip_prefix(r"\\?\").unwrap_or(&raw).to_string()
    };
    plain.trim_end_matches(['\\', '/']).to_lowercase()
}
pub(crate) fn protected_path(path: &Path) -> bool {
    if path.is_absolute() && path.parent().is_none() {
        return true;
    }
    let keys = protected_folders();
    let key = path_key(path);
    if keys.iter().any(|root| path_key(root) == key) {
        return true;
    }
    // Resolve aliases using metadata only; no file contents are read.
    // In particular, an ancestor junction must not hide the Windows root.
    fs::canonicalize(path).ok().is_some_and(|real| {
        let key = path_key(&real);
        keys.iter().any(|root| path_key(root) == key)
    })
}
fn protected_folders() -> &'static Vec<PathBuf> {
    static ROOTS: OnceLock<Vec<PathBuf>> = OnceLock::new();
    ROOTS.get_or_init(|| {
        #[cfg(windows)]
        {
            use windows::Win32::UI::Shell::{
                FOLDERID_ProgramFiles, FOLDERID_ProgramFilesX64, FOLDERID_ProgramFilesX86,
                FOLDERID_Windows, SHGetKnownFolderPath, KNOWN_FOLDER_FLAG,
            };
            [
                FOLDERID_Windows,
                FOLDERID_ProgramFiles,
                FOLDERID_ProgramFilesX86,
                FOLDERID_ProgramFilesX64,
            ]
            .iter()
            .filter_map(|id| {
                // SAFETY: id is a known-folder GUID. The returned string
                // is copied, then its CoTaskMem allocation is freed once.
                let ptr = unsafe { SHGetKnownFolderPath(id, KNOWN_FOLDER_FLAG(0), None) }.ok()?;
                let text = unsafe { ptr.to_string() }.ok();
                unsafe {
                    windows::Win32::System::Com::CoTaskMemFree(Some(
                        ptr.0 as *const std::ffi::c_void,
                    ))
                };
                text.map(PathBuf::from)
            })
            .collect()
        }
        #[cfg(not(windows))]
        {
            Vec::new()
        }
    })
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);

    struct TestDir(PathBuf);
    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "adperastra-safety-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn file(&self, name: &str, system: bool) -> PathBuf {
            let path = self.0.join(name);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, b"keep this content").unwrap();
            if system {
                use windows::Win32::Storage::FileSystem::{
                    SetFileAttributesW, FILE_ATTRIBUTE_SYSTEM,
                };
                let wide: Vec<u16> = path
                    .as_os_str()
                    .to_string_lossy()
                    .encode_utf16()
                    .chain(Some(0))
                    .collect();
                // SAFETY: the test owns this path; wide is terminated and outlives the call.
                unsafe {
                    SetFileAttributesW(windows::core::PCWSTR(wide.as_ptr()), FILE_ATTRIBUTE_SYSTEM)
                        .unwrap()
                };
            }
            path
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            assert!(self
                .0
                .parent()
                .is_some_and(|parent| parent == std::env::temp_dir()));
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn scan(kind: &str, paths: &[PathBuf], allow_system: bool) -> Result<Preflight, String> {
        check(
            kind,
            paths,
            None,
            ConflictPolicy::Skip,
            allow_system,
            &fs_service::new_cancellation_token(),
            &mut |_| {},
        )
    }

    #[test]
    fn system_source_requires_confirmation_before_any_change() {
        let dir = TestDir::new();
        let path = dir.file("system.ini", true);
        assert_eq!(
            scan("move", std::slice::from_ref(&path), false)
                .err()
                .as_deref(),
            Some("ops.system_confirmation_required")
        );
        assert_eq!(fs::read(path).unwrap(), b"keep this content");
    }

    #[test]
    fn confirmed_system_source_is_allowed_but_normal_files_need_no_confirmation() {
        let dir = TestDir::new();
        let system = dir.file("system.ini", true);
        let normal = dir.file("notes.txt", false);
        assert_eq!(
            scan("move", std::slice::from_ref(&system), true)
                .unwrap()
                .sources,
            [system]
        );
        assert_eq!(
            scan("move", std::slice::from_ref(&normal), false)
                .unwrap()
                .sources,
            [normal]
        );
    }

    #[test]
    fn nested_system_items_are_checked_for_move_recycle_and_permanent_delete() {
        let dir = TestDir::new();
        dir.file("folder/nested/system.ini", true);
        for kind in ["move", "recycle", "permanent"] {
            assert_eq!(
                scan(kind, &[dir.0.join("folder")], false).err().as_deref(),
                Some("ops.system_confirmation_required"),
                "{kind}"
            );
        }
    }

    #[test]
    fn replacement_checks_system_items_inside_the_existing_target() {
        let src = TestDir::new();
        let dest = TestDir::new();
        src.file("folder/nested/system.ini", false);
        dest.file("folder/nested/system.ini", true);
        assert_eq!(
            check(
                "copy",
                &[src.0.join("folder")],
                Some(&dest.0),
                ConflictPolicy::Replace,
                false,
                &fs_service::new_cancellation_token(),
                &mut |_| {}
            )
            .err()
            .as_deref(),
            Some("ops.system_confirmation_required")
        );
        assert!(check(
            "copy",
            &[src.0.join("folder")],
            Some(&dest.0),
            ConflictPolicy::KeepBoth,
            false,
            &fs_service::new_cancellation_token(),
            &mut |_| {}
        )
        .is_ok());
    }

    #[test]
    fn drive_roots_are_refused_even_after_system_confirmation() {
        let outcome = scan("recycle", &[PathBuf::from("C:\\")], true).unwrap();
        assert!(outcome.sources.is_empty());
        assert_eq!(outcome.skipped[0].reason, "protected_path");
    }

    #[test]
    fn cancelled_metadata_scan_changes_nothing_and_reports_cancellation() {
        let dir = TestDir::new();
        let path = dir.file("notes.txt", false);
        let token = fs_service::new_cancellation_token();
        token.store(true, Ordering::Relaxed);
        let outcome = check(
            "move",
            std::slice::from_ref(&path),
            None,
            ConflictPolicy::Skip,
            false,
            &token,
            &mut |_| {},
        )
        .unwrap();
        assert!(outcome.cancelled);
        assert!(outcome.sources.is_empty());
        assert_eq!(fs::read(path).unwrap(), b"keep this content");
    }

    #[test]
    fn missing_transfer_counterpart_is_expected_and_system_endpoint_is_still_checked() {
        let dir = TestDir::new();
        let existing = dir.file("system.ini", true);
        assert_eq!(
            scan("transfer", &[dir.0.join("moved-away.ini"), existing], false)
                .err()
                .as_deref(),
            Some("ops.system_confirmation_required")
        );
    }

    #[test]
    fn merging_a_folder_does_not_warn_about_untouched_system_children() {
        let src = TestDir::new();
        let dest = TestDir::new();
        src.file("folder/new.txt", false);
        dest.file("folder/desktop.ini", true);
        assert!(check(
            "copy",
            &[src.0.join("folder")],
            Some(&dest.0),
            ConflictPolicy::Replace,
            false,
            &fs_service::new_cancellation_token(),
            &mut |_| {}
        )
        .is_ok());
    }

    #[test]
    fn directory_junction_attributes_are_distinguished_from_cloud_file_placeholders() {
        use windows::Win32::Storage::FileSystem::{
            FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS,
            FILE_ATTRIBUTE_REPARSE_POINT,
        };
        assert!(directory_reparse_attributes(
            FILE_ATTRIBUTE_DIRECTORY.0 | FILE_ATTRIBUTE_REPARSE_POINT.0
        ));
        assert!(!directory_reparse_attributes(
            FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS.0 | FILE_ATTRIBUTE_REPARSE_POINT.0
        ));
        assert!(!directory_reparse_attributes(FILE_ATTRIBUTE_DIRECTORY.0));
    }

    #[test]
    fn actual_windows_and_program_files_roots_cannot_be_confirmed_away() {
        let roots = protected_folders();
        assert!(roots.len() >= 2);
        for root in roots {
            let outcome = scan("recycle", std::slice::from_ref(root), true).unwrap();
            assert!(outcome.sources.is_empty());
            assert_eq!(outcome.skipped[0].reason, "protected_path");
        }
    }
}
