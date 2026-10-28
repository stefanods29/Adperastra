//! File operations (Step 03b): create, copy, move, recycle, restore and
//! permanent delete. Copying is chunked so progress and Cancel work on
//! files of any size; a cancelled or failed copy never leaves a partial
//! file behind, and nothing is ever overwritten unless the caller chose
//! the `Replace` policy (the UI asks the user first).
//!
//! Recursive walks never follow a directory link into a folder that is
//! already being copied, so link loops terminate with a skipped item
//! instead of copying forever (rules.md section 6).

use crate::list::{validate_new_name, CancellationToken};
use crate::{FsError, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConflictPolicy {
    Replace,
    Skip,
    KeepBoth,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CreateKind {
    Folder,
    File,
}

/// Progress snapshot passed to the caller's callback while an operation runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OpProgress {
    pub items_done: usize,
    pub items_total: usize,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub current: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompletedItem {
    pub from: PathBuf,
    pub to: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkippedItem {
    pub path: PathBuf,
    /// Stable reason code; the UI translates `errors.ops.<reason>`.
    pub reason: String,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct OpReport {
    pub completed: Vec<CompletedItem>,
    pub skipped: Vec<SkippedItem>,
    pub cancelled: bool,
}

/// Short, stable reason for a failed operation (`errors.ops.<reason>`).
pub fn op_error_reason(error: &FsError) -> &'static str {
    match error {
        FsError::Validation(_) => "invalid_name",
        FsError::Cancelled => "cancelled",
        FsError::Io(io) => match io.raw_os_error() {
            Some(80) | Some(183) => "exists",
            Some(5) => "access_denied",
            Some(32) | Some(33) => "in_use",
            Some(2) | Some(3) => "not_found",
            Some(206) => "too_long",
            _ if io.kind() == std::io::ErrorKind::AlreadyExists => "exists",
            _ if io.kind() == std::io::ErrorKind::PermissionDenied => "access_denied",
            _ if io.kind() == std::io::ErrorKind::NotFound => "not_found",
            _ => "other",
        },
        _ => "other",
    }
}

fn reason(error: &FsError) -> String {
    op_error_reason(error).to_string()
}

fn exists(path: &Path) -> bool {
    path.symlink_metadata().is_ok()
}

fn is_real_dir(path: &Path) -> bool {
    path.symlink_metadata()
        .is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink())
}

/// A drive or network-share root (for example `C:`): never moved,
/// recycled or deleted as a whole.
fn is_drive_root(path: &Path) -> bool {
    path.parent().is_none()
}

fn skip(report: &mut OpReport, path: &Path, reason: &str) {
    report.skipped.push(SkippedItem {
        path: path.to_path_buf(),
        reason: reason.to_string(),
    });
}

fn same_folder(a: &Path, b: &Path) -> bool {
    a.to_string_lossy()
        .eq_ignore_ascii_case(&b.to_string_lossy())
}

/// `name (2).ext`, `name (3).ext`... like Windows Explorer.
pub fn unique_destination(dir: &Path, name: &str) -> PathBuf {
    let first = dir.join(name);
    if !exists(&first) {
        return first;
    }
    let (base, extension) = split_name(name);
    for number in 2..10_000 {
        let candidate = dir.join(format!("{base} ({number}){extension}"));
        if !exists(&candidate) {
            return candidate;
        }
    }
    first
}

/// `name - Copy.ext`, then `name - Copy (2).ext` (same-folder paste).
fn copy_destination(dir: &Path, name: &str) -> PathBuf {
    let (base, extension) = split_name(name);
    let first = dir.join(format!("{base} - Copy{extension}"));
    if !exists(&first) {
        return first;
    }
    for number in 2..10_000 {
        let candidate = dir.join(format!("{base} - Copy ({number}){extension}"));
        if !exists(&candidate) {
            return candidate;
        }
    }
    first
}

fn split_name(name: &str) -> (&str, &str) {
    // A leading dot (".gitignore") is part of the name, not an extension.
    match name.rfind('.') {
        Some(dot) if dot > 0 => (&name[..dot], &name[dot..]),
        _ => (name, ""),
    }
}

fn item_name(path: &Path) -> Result<String> {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| FsError::Validation("a drive or share root has no name".to_string()))
}

/// Create an empty folder or file with a unique name (Windows "New" behavior).
pub fn create_item(parent: &Path, name: &str, kind: CreateKind) -> Result<PathBuf> {
    validate_new_name(name)?;
    if !parent.is_absolute() {
        return Err(FsError::Validation("path must be absolute".to_string()));
    }
    let target = unique_destination(parent, name);
    match kind {
        CreateKind::Folder => fs::create_dir(&target)?,
        CreateKind::File => {
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)?;
        }
    }
    Ok(target)
}

/// Targets inside `dest_dir` that already exist (what the UI asks about).
pub fn check_conflicts(sources: &[PathBuf], dest_dir: &Path) -> Vec<PathBuf> {
    let mut conflicts = Vec::new();
    for source in sources {
        if let Some(name) = source.file_name() {
            let target = dest_dir.join(name);
            if exists(&target) {
                conflicts.push(target);
            }
        }
    }
    conflicts
}

struct PlanEntry {
    from: PathBuf,
    /// Path relative to the top-level item's parent (includes its name).
    rel: PathBuf,
    is_dir: bool,
    size: u64,
}

struct Plan {
    entries: Vec<PlanEntry>,
    skipped: Vec<SkippedItem>,
    total_bytes: u64,
}

/// Expand top-level items into a flat copy plan. Directory links are only
/// followed into folders not already in the plan (loop guard).
fn expand(sources: &[PathBuf]) -> Plan {
    let mut plan = Plan {
        entries: Vec::new(),
        skipped: Vec::new(),
        total_bytes: 0,
    };
    let mut visited_dirs: HashSet<String> = HashSet::new();
    for source in sources {
        let metadata = match fs::symlink_metadata(source) {
            Ok(metadata) => metadata,
            Err(error) => {
                plan.skipped.push(SkippedItem {
                    path: source.clone(),
                    reason: reason(&FsError::from(error)),
                });
                continue;
            }
        };
        let name = match item_name(source) {
            Ok(name) => name,
            Err(error) => {
                plan.skipped.push(SkippedItem {
                    path: source.clone(),
                    reason: reason(&error),
                });
                continue;
            }
        };
        let rel = PathBuf::from(&name);
        if metadata.is_dir() {
            if let Ok(canonical) = fs::canonicalize(source) {
                visited_dirs.insert(canonical.to_string_lossy().to_lowercase());
            }
            expand_dir(source, &rel, &mut plan, &mut visited_dirs);
        } else {
            let size = metadata.len();
            plan.total_bytes += size;
            plan.entries.push(PlanEntry {
                from: source.clone(),
                rel,
                is_dir: false,
                size,
            });
        }
    }
    plan
}

fn expand_dir(dir: &Path, rel: &Path, plan: &mut Plan, visited: &mut HashSet<String>) {
    plan.entries.push(PlanEntry {
        from: dir.to_path_buf(),
        rel: rel.to_path_buf(),
        is_dir: true,
        size: 0,
    });
    let read = match fs::read_dir(dir) {
        Ok(read) => read,
        Err(error) => {
            plan.skipped.push(SkippedItem {
                path: dir.to_path_buf(),
                reason: reason(&FsError::from(error)),
            });
            return;
        }
    };
    // Directory entries carry their type (and, on Windows, their size)
    // from the enumeration itself, so the walk needs no per-item
    // metadata call - that keeps a 100,000-item walk at enumeration speed.
    let mut children: Vec<(PathBuf, std::fs::FileType, u64)> = Vec::new();
    for entry in read.flatten() {
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                plan.skipped.push(SkippedItem {
                    path: entry.path(),
                    reason: reason(&FsError::from(error)),
                });
                continue;
            }
        };
        let size = if file_type.is_dir() {
            0
        } else {
            entry.metadata().map(|m| m.len()).unwrap_or(0)
        };
        children.push((entry.path(), file_type, size));
    }
    children
        .sort_by_key(|(path, _, _)| path.file_name().map(|n| n.to_string_lossy().to_lowercase()));
    for (child, file_type, size) in children {
        let Some(name) = child.file_name().map(|n| n.to_string_lossy().into_owned()) else {
            continue;
        };
        let child_rel = rel.join(&name);
        // A link that points at a directory counts as a directory here;
        // the visited set below decides whether it may be followed.
        let is_dir = if file_type.is_symlink() {
            child.is_dir()
        } else {
            file_type.is_dir()
        };
        if is_dir {
            match fs::canonicalize(&child) {
                Ok(canonical) => {
                    let key = canonical.to_string_lossy().to_lowercase();
                    if !visited.insert(key) {
                        plan.skipped.push(SkippedItem {
                            path: child.clone(),
                            reason: "link_loop".to_string(),
                        });
                        continue;
                    }
                }
                Err(error) => {
                    plan.skipped.push(SkippedItem {
                        path: child.clone(),
                        reason: reason(&FsError::from(error)),
                    });
                    continue;
                }
            }
            expand_dir(&child, &child_rel, plan, visited);
        } else {
            plan.total_bytes += size;
            plan.entries.push(PlanEntry {
                from: child,
                rel: child_rel,
                is_dir: false,
                size,
            });
        }
    }
}

const CHUNK: usize = 1024 * 1024;

struct Runner<'a> {
    policy: ConflictPolicy,
    /// Moves never duplicate an item onto itself; copies with KeepBoth do.
    moving: bool,
    token: &'a CancellationToken,
    progress: &'a mut dyn FnMut(&OpProgress),
    items_total: usize,
    items_done: usize,
    bytes_total: u64,
    bytes_done: u64,
    current: String,
    cancelled: bool,
}

impl Runner<'_> {
    fn report(&mut self) {
        (self.progress)(&OpProgress {
            items_done: self.items_done,
            items_total: self.items_total,
            bytes_done: self.bytes_done,
            bytes_total: self.bytes_total,
            current: self.current.clone(),
        });
    }

    fn cancelled(&mut self) -> bool {
        if self.token.load(Ordering::Relaxed) {
            self.cancelled = true;
        }
        self.cancelled
    }

    /// Decide the real target for one top-level item. `None` means skip.
    fn target_for(
        &mut self,
        source: &Path,
        dest_dir: &Path,
        report: &mut OpReport,
    ) -> Option<PathBuf> {
        let name = item_name(source).ok()?;
        let target = dest_dir.join(&name);
        if !exists(&target) {
            return Some(target);
        }
        // Moving an item onto itself is never meaningful; copying it into
        // its own folder with KeepBoth is the "paste here" duplicate.
        if same_folder(source, &target) {
            if !self.moving && self.policy == ConflictPolicy::KeepBoth {
                let name = item_name(source).ok()?;
                return Some(copy_destination(dest_dir, &name));
            }
            report.skipped.push(SkippedItem {
                path: source.to_path_buf(),
                reason: "exists".to_string(),
            });
            return None;
        }
        match self.policy {
            ConflictPolicy::Skip => {
                report.skipped.push(SkippedItem {
                    path: source.to_path_buf(),
                    reason: "exists".to_string(),
                });
                None
            }
            ConflictPolicy::KeepBoth => {
                if source.parent().is_some_and(|p| same_folder(p, dest_dir)) {
                    Some(copy_destination(dest_dir, &name))
                } else {
                    Some(unique_destination(dest_dir, &name))
                }
            }
            ConflictPolicy::Replace => {
                // A file never replaces a folder (or the reverse): that
                // would delete everything inside it.
                if is_real_dir(source) != is_real_dir(&target) {
                    skip(report, source, "kind_mismatch");
                    return None;
                }
                Some(target)
            }
        }
    }

    /// Copy one file. The data is written to a hidden sibling first and
    /// only swapped in once complete, so a failed or cancelled Replace
    /// keeps the old destination and never leaves a partial file behind.
    fn copy_file(&mut self, from: &Path, to: &Path) -> std::result::Result<(), FsError> {
        if is_real_dir(to) {
            return Err(FsError::Io(std::io::ErrorKind::AlreadyExists.into()));
        }
        let parent = to.parent().unwrap_or(to);
        fs::create_dir_all(parent)?;
        let name = to
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        let partial = unique_destination(parent, &format!("~{name}.partial"));
        let mut input = fs::File::open(from)?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&partial)
            .map_err(FsError::from)?;
        let mut buffer = vec![0u8; CHUNK];
        let started_at = self.bytes_done;
        let result = (|| {
            loop {
                if self.cancelled() {
                    return Err(FsError::Cancelled);
                }
                let read = input.read(&mut buffer)?;
                if read == 0 {
                    break;
                }
                output.write_all(&buffer[..read])?;
                self.bytes_done += read as u64;
            }
            output.flush()?;
            Ok(())
        })();
        drop(output);
        if result.is_ok() {
            if let Ok(metadata) = fs::metadata(from) {
                copy_times(from, &partial);
                let _ = fs::set_permissions(&partial, metadata.permissions());
            }
        }
        // Renaming onto a file replaces it in one step (MoveFileEx with
        // MOVEFILE_REPLACE_EXISTING on Windows).
        let result = result.and_then(|()| fs::rename(&partial, to).map_err(FsError::from));
        if let Err(error) = result {
            let _ = remove_file_forced(&partial);
            self.bytes_done = started_at;
            return Err(error);
        }
        Ok(())
    }

    fn copy_plan(
        &mut self,
        plan: &Plan,
        source: &Path,
        target: &Path,
        report: &mut OpReport,
    ) -> Vec<PathBuf> {
        // Plan entries copied successfully (files and folders), for moves.
        let mut copied: Vec<PathBuf> = Vec::new();
        let name = item_name(source).unwrap_or_default();
        for entry in &plan.entries {
            if self.cancelled() {
                break;
            }
            let Some(suffix) = entry.rel.strip_prefix(&name).ok() else {
                continue;
            };
            let dest = if suffix.as_os_str().is_empty() {
                target.to_path_buf()
            } else {
                target.join(suffix)
            };
            self.current = entry.from.to_string_lossy().into_owned();
            self.items_done += 1;
            if entry.is_dir {
                match fs::create_dir_all(&dest) {
                    Ok(()) => copied.push(entry.from.clone()),
                    Err(error) => report.skipped.push(SkippedItem {
                        path: entry.from.clone(),
                        reason: reason(&FsError::from(error)),
                    }),
                }
            } else {
                if is_real_dir(&dest) {
                    skip(report, &entry.from, "kind_mismatch");
                    self.bytes_done += entry.size;
                    continue;
                }
                // A file conflict inside a merged folder follows the policy.
                if exists(&dest) && dest != entry.from {
                    match self.policy {
                        ConflictPolicy::Skip => {
                            report.skipped.push(SkippedItem {
                                path: entry.from.clone(),
                                reason: "exists".to_string(),
                            });
                            self.bytes_done += entry.size;
                            continue;
                        }
                        ConflictPolicy::KeepBoth => {
                            // Numbered name inside the merged folder.
                            let renamed = unique_destination(
                                dest.parent().unwrap_or(target),
                                &entry
                                    .from
                                    .file_name()
                                    .map(|n| n.to_string_lossy().into_owned())
                                    .unwrap_or_default(),
                            );
                            match self.copy_file(&entry.from, &renamed) {
                                Ok(()) => copied.push(entry.from.clone()),
                                Err(FsError::Cancelled) => break,
                                Err(error) => report.skipped.push(SkippedItem {
                                    path: entry.from.clone(),
                                    reason: reason(&error),
                                }),
                            }
                            continue;
                        }
                        ConflictPolicy::Replace => {}
                    }
                }
                match self.copy_file(&entry.from, &dest) {
                    Ok(()) => copied.push(entry.from.clone()),
                    Err(FsError::Cancelled) => break,
                    Err(error) => report.skipped.push(SkippedItem {
                        path: entry.from.clone(),
                        reason: reason(&error),
                    }),
                }
            }
            self.report();
        }
        copied
    }
}

fn remove_any(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        remove_tree(path)
    } else {
        remove_file_forced(path)
    }
}

fn remove_file_forced(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(_) => {
            // A read-only file refuses deletion on Windows; clear and retry.
            if let Ok(metadata) = fs::metadata(path) {
                let mut permissions = metadata.permissions();
                #[allow(clippy::permissions_set_readonly_false)]
                permissions.set_readonly(false);
                let _ = fs::set_permissions(path, permissions);
            }
            fs::remove_file(path).map_err(FsError::from)
        }
    }
}

fn remove_tree(path: &Path) -> Result<()> {
    let mut entries: Vec<PathBuf> = Vec::new();
    let mut stack = vec![path.to_path_buf()];
    while let Some(current) = stack.pop() {
        entries.push(current.clone());
        if current.is_dir() && !current.is_symlink() {
            if let Ok(read) = fs::read_dir(&current) {
                for entry in read.flatten() {
                    stack.push(entry.path());
                }
            }
        }
    }
    // Deepest first; links are removed as links, never followed.
    entries.sort_by_key(|p| std::cmp::Reverse(p.components().count()));
    for entry in entries {
        let metadata = fs::symlink_metadata(&entry)?;
        if metadata.is_dir() && !metadata.file_type().is_symlink() {
            fs::remove_dir(&entry)?;
        } else {
            remove_file_forced(&entry)?;
        }
    }
    Ok(())
}

/// Copy the source's created/modified/accessed times onto the copy, like
/// Windows Explorer (best effort; the copy is still valid without them).
#[cfg(windows)]
fn copy_times(from: &Path, to: &Path) {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::{FILETIME, HANDLE};
    use windows::Win32::Storage::FileSystem::SetFileTime;
    let Ok(metadata) = fs::metadata(from) else {
        return;
    };
    let Ok(mut dest) = fs::OpenOptions::new().write(true).open(to) else {
        return;
    };
    let (Ok(created), Ok(accessed), Ok(modified)) =
        (metadata.created(), metadata.accessed(), metadata.modified())
    else {
        return;
    };
    let convert = |time: std::time::SystemTime| {
        let since_epoch = time
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let ticks = (since_epoch / 100) as u64 + 116_444_736_000_000_000;
        FILETIME {
            dwLowDateTime: (ticks & 0xFFFF_FFFF) as u32,
            dwHighDateTime: (ticks >> 32) as u32,
        }
    };
    let (created, accessed, modified) = (convert(created), convert(accessed), convert(modified));
    let _ = dest.flush();
    // SAFETY: the handle belongs to `dest`, which outlives the call.
    unsafe {
        let _ = SetFileTime(
            HANDLE(dest.as_raw_handle()),
            Some(&created),
            Some(&accessed),
            Some(&modified),
        );
    }
}

#[cfg(not(windows))]
fn copy_times(_from: &Path, _to: &Path) {}

/// Copy items into `dest_dir`. See the module docs for the guarantees.
pub fn copy_items(
    sources: &[PathBuf],
    dest_dir: &Path,
    policy: ConflictPolicy,
    token: &CancellationToken,
    progress: &mut dyn FnMut(&OpProgress),
) -> Result<OpReport> {
    if !dest_dir.is_absolute() || sources.iter().any(|s| !s.is_absolute()) {
        return Err(FsError::Validation("paths must be absolute".to_string()));
    }
    let mut report = OpReport::default();
    let plans: Vec<Plan> = sources
        .iter()
        .map(|s| expand(std::slice::from_ref(s)))
        .collect();
    let total_bytes: u64 = plans.iter().map(|p| p.total_bytes).sum();
    for plan in &plans {
        report.skipped.extend(plan.skipped.iter().cloned());
    }
    let entries_total: usize = plans.iter().map(|plan| plan.entries.len()).sum();
    let mut runner = Runner {
        policy,
        moving: false,
        token,
        progress,
        items_total: entries_total,
        items_done: 0,
        bytes_total: total_bytes,
        bytes_done: 0,
        current: String::new(),
        cancelled: false,
    };
    for (source, plan) in sources.iter().zip(plans.iter()) {
        if runner.cancelled() {
            break;
        }
        runner.current = source.to_string_lossy().into_owned();
        if source.is_dir() && dest_dir.starts_with(source) {
            report.skipped.push(SkippedItem {
                path: source.clone(),
                reason: "into_itself".to_string(),
            });
            runner.items_done += plan.entries.len();
            runner.report();
            continue;
        }
        if let Some(target) = runner.target_for(source, dest_dir, &mut report) {
            let copied = runner.copy_plan(plan, source, &target, &mut report);
            let files_total = plan.entries.iter().filter(|e| !e.is_dir).count();
            let files_copied = copied.iter().filter(|p| !p.is_dir()).count();
            // An item only counts as copied if at least one of its files
            // copied (or it is an empty folder, created above).
            if files_total == 0 || files_copied > 0 {
                report.completed.push(CompletedItem {
                    from: source.clone(),
                    to: target,
                });
            }
        }
        runner.report();
    }
    report.cancelled = runner.cancelled;
    Ok(report)
}

/// Move items into `dest_dir`. Same-volume moves are renames; cross-volume
/// moves copy then delete only what copied successfully.
pub fn move_items(
    sources: &[PathBuf],
    dest_dir: &Path,
    policy: ConflictPolicy,
    token: &CancellationToken,
    progress: &mut dyn FnMut(&OpProgress),
) -> Result<OpReport> {
    if !dest_dir.is_absolute() || sources.iter().any(|s| !s.is_absolute()) {
        return Err(FsError::Validation("paths must be absolute".to_string()));
    }
    let mut report = OpReport::default();
    let plans: Vec<Plan> = sources
        .iter()
        .map(|s| expand(std::slice::from_ref(s)))
        .collect();
    let total_bytes: u64 = plans.iter().map(|p| p.total_bytes).sum();
    for plan in &plans {
        report.skipped.extend(plan.skipped.iter().cloned());
    }
    let entries_total: usize = plans.iter().map(|plan| plan.entries.len()).sum();
    let mut runner = Runner {
        policy,
        moving: true,
        token,
        progress,
        items_total: entries_total,
        items_done: 0,
        bytes_total: total_bytes,
        bytes_done: 0,
        current: String::new(),
        cancelled: false,
    };
    for (source, plan) in sources.iter().zip(plans.iter()) {
        if runner.cancelled() {
            break;
        }
        runner.current = source.to_string_lossy().into_owned();
        if source.is_dir() && dest_dir.starts_with(source) {
            report.skipped.push(SkippedItem {
                path: source.clone(),
                reason: "into_itself".to_string(),
            });
            runner.items_done += plan.entries.len();
            runner.report();
            continue;
        }
        if is_drive_root(source) {
            skip(&mut report, source, "drive_root");
            runner.items_done += plan.entries.len();
            continue;
        }
        let Some(target) = runner.target_for(source, dest_dir, &mut report) else {
            runner.items_done += plan.entries.len();
            continue;
        };
        // Fast path: a plain rename (same volume). Renaming a file onto a
        // file the user chose to replace swaps it in one step; a folder
        // that already exists is merged below instead.
        if !is_real_dir(&target) && fs::rename(source, &target).is_ok() {
            runner.bytes_done += plan.total_bytes;
            runner.items_done += plan.entries.len();
            report.completed.push(CompletedItem {
                from: source.clone(),
                to: target,
            });
            runner.report();
            continue;
        }
        // Otherwise (cross-volume, a link, or merging into an existing
        // folder): copy + delete. The copy replaces an old file only once
        // it is complete.
        let copied = runner.copy_plan(plan, source, &target, &mut report);
        if runner.cancelled {
            break;
        }
        // Delete only what copied; skipped sources stay where they were.
        let copied_set: HashSet<String> = copied
            .iter()
            .map(|p| p.to_string_lossy().to_lowercase())
            .collect();
        let mut entries: Vec<&PlanEntry> = plan.entries.iter().collect();
        entries.sort_by_key(|e| std::cmp::Reverse(e.rel.components().count()));
        let mut fully_moved = true;
        for entry in entries {
            if !copied_set.contains(&entry.from.to_string_lossy().to_lowercase()) {
                fully_moved = false;
                continue;
            }
            let result = if entry.is_dir {
                fs::remove_dir(&entry.from).map_err(FsError::from)
            } else {
                remove_file_forced(&entry.from)
            };
            if let Err(error) = result {
                fully_moved = false;
                report.skipped.push(SkippedItem {
                    path: entry.from.clone(),
                    reason: reason(&error),
                });
            }
        }
        if fully_moved {
            report.completed.push(CompletedItem {
                from: source.clone(),
                to: target,
            });
        }
        runner.report();
    }
    report.cancelled = runner.cancelled;
    Ok(report)
}

/// Move items to the Recycle Bin (recoverable; Undo restores them).
pub fn recycle_items(
    paths: &[PathBuf],
    token: &CancellationToken,
    progress: &mut dyn FnMut(&OpProgress),
) -> Result<OpReport> {
    if paths.iter().any(|p| !p.is_absolute()) {
        return Err(FsError::Validation("paths must be absolute".to_string()));
    }
    let mut report = OpReport::default();
    let total = paths.len();
    for (index, path) in paths.iter().enumerate() {
        if token.load(Ordering::Relaxed) {
            report.cancelled = true;
            break;
        }
        progress(&OpProgress {
            items_done: index,
            items_total: total,
            bytes_done: 0,
            bytes_total: 0,
            current: path.to_string_lossy().into_owned(),
        });
        if is_drive_root(path) {
            skip(&mut report, path, "drive_root");
            continue;
        }
        match trash::delete(path) {
            Ok(()) => report.completed.push(CompletedItem {
                from: path.clone(),
                to: path.clone(),
            }),
            Err(error) => report.skipped.push(SkippedItem {
                path: path.clone(),
                reason: recycle_reason(&error),
            }),
        }
    }
    progress(&OpProgress {
        items_done: report.completed.len() + report.skipped.len(),
        items_total: total,
        bytes_done: 0,
        bytes_total: 0,
        current: String::new(),
    });
    Ok(report)
}

fn recycle_reason(error: &trash::Error) -> String {
    let text = error.to_string().to_lowercase();
    if text.contains("could not be found") || text.contains("not found") {
        "not_found".to_string()
    } else if text.contains("access") || text.contains("denied") {
        "access_denied".to_string()
    } else {
        "other".to_string()
    }
}

/// Restore previously recycled items to their original locations. Never
/// overwrites: if something new sits at the original path, the item is
/// skipped and stays in the Recycle Bin.
pub fn restore_items(originals: &[PathBuf]) -> Result<OpReport> {
    let mut report = OpReport::default();
    let bin = match trash::os_limited::list() {
        Ok(items) => items,
        Err(error) => {
            for original in originals {
                report.skipped.push(SkippedItem {
                    path: original.clone(),
                    reason: recycle_reason(&error),
                });
            }
            return Ok(report);
        }
    };
    for original in originals {
        if exists(original) {
            report.skipped.push(SkippedItem {
                path: original.clone(),
                reason: "exists".to_string(),
            });
            continue;
        }
        // Prefer the bin's own record of the full original path, so
        // `photo.jpg` and `photo.png` never swap. Windows reports a
        // recycled item's display name without its extension when "hide
        // extensions" is on, so the name/stem match is only a fallback
        // for items whose record can't be read.
        let parent = original.parent().unwrap_or(original);
        let name = item_name(original).unwrap_or_default();
        let stem = split_name(&name).0.to_string();
        let wanted = original.to_string_lossy();
        let candidate = bin
            .iter()
            .filter(|item| same_folder(&item.original_parent, parent))
            .filter(|item| match bin_original_path(item) {
                Some(full) => full.to_string_lossy().eq_ignore_ascii_case(&wanted),
                None => {
                    let shown = item.name.to_string_lossy();
                    shown.eq_ignore_ascii_case(&name) || shown.eq_ignore_ascii_case(&stem)
                }
            })
            .max_by_key(|item| item.time_deleted);
        match candidate {
            Some(item) => match restore_one(item, original) {
                Ok(()) => report.completed.push(CompletedItem {
                    from: original.clone(),
                    to: original.clone(),
                }),
                Err(reason_code) => report.skipped.push(SkippedItem {
                    path: original.clone(),
                    reason: reason_code,
                }),
            },
            None => report.skipped.push(SkippedItem {
                path: original.clone(),
                reason: "not_found".to_string(),
            }),
        }
    }
    Ok(report)
}

/// The full original path stored in the bin's `$I` record next to the
/// item's `$R` data (`$IABC123.txt` beside `$RABC123.txt`). Format v1:
/// 24-byte header then a 260-character path; v2: header, a character
/// count, then the path.
#[cfg(windows)]
fn bin_original_path(item: &trash::TrashItem) -> Option<PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    let data_path = Path::new(&item.id);
    let data_name = data_path.file_name()?.to_string_lossy().into_owned();
    let record_name = data_name.strip_prefix("$R")?;
    let record = data_path.with_file_name(format!("$I{record_name}"));
    let mut bytes = Vec::new();
    fs::File::open(record)
        .ok()?
        .take(24 + 4 + 2 * 32_768)
        .read_to_end(&mut bytes)
        .ok()?;
    let version = u64::from_le_bytes(bytes.get(..8)?.try_into().ok()?);
    let text = match version {
        1 => bytes.get(24..24 + 520)?,
        2 => {
            let count = u32::from_le_bytes(bytes.get(24..28)?.try_into().ok()?) as usize;
            bytes.get(28..28 + count * 2)?
        }
        _ => return None,
    };
    let wide: Vec<u16> = text
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| u16::from_le_bytes(*pair))
        .take_while(|&unit| unit != 0)
        .collect();
    (!wide.is_empty()).then(|| PathBuf::from(std::ffi::OsString::from_wide(&wide)))
}

#[cfg(not(windows))]
fn bin_original_path(item: &trash::TrashItem) -> Option<PathBuf> {
    Some(item.original_path())
}

/// Restore one Recycle Bin item to `original` with its full original
/// name. The `trash` crate's own restore passes the bin display name,
/// which loses the extension when Windows hides extensions, so the move
/// is driven here with `IFileOperation` and the name we know.
#[cfg(windows)]
fn restore_one(item: &trash::TrashItem, original: &Path) -> std::result::Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        FileOperation, IFileOperation, IShellItem, SHCreateItemFromParsingName, FOFX_EARLYFAILURE,
        FOF_NO_UI,
    };

    fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
        value.encode_wide().chain(std::iter::once(0)).collect()
    }

    let parent = original.parent().ok_or("not_found")?;
    let name = original.file_name().ok_or("not_found")?;
    // SAFETY: COM is balanced below; every wide buffer outlives its call.
    let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.0 >= 0;
    let result = unsafe {
        (|| -> windows::core::Result<()> {
            let operation: IFileOperation =
                CoCreateInstance(&FileOperation as *const _, None, CLSCTX_ALL)?;
            operation.SetOperationFlags(FOF_NO_UI | FOFX_EARLYFAILURE)?;
            let id = wide(&item.id);
            let trash_item: IShellItem = SHCreateItemFromParsingName(PCWSTR(id.as_ptr()), None)?;
            let parent_wide = wide(parent.as_os_str());
            let folder: IShellItem =
                SHCreateItemFromParsingName(PCWSTR(parent_wide.as_ptr()), None)?;
            let name_wide = wide(name);
            operation.MoveItem(&trash_item, &folder, PCWSTR(name_wide.as_ptr()), None)?;
            operation.PerformOperations()?;
            if operation.GetAnyOperationsAborted()?.as_bool() {
                return Err(windows::core::Error::from_hresult(
                    windows::Win32::Foundation::E_FAIL,
                ));
            }
            Ok(())
        })()
    };
    if initialized {
        // SAFETY: pairs with the successful CoInitializeEx above.
        unsafe { CoUninitialize() };
    }
    result.map_err(|error| match error.code().0 {
        5 => "access_denied".to_string(),
        2 | 3 => "not_found".to_string(),
        _ => "other".to_string(),
    })
}

#[cfg(not(windows))]
fn restore_one(item: &trash::TrashItem, _original: &Path) -> std::result::Result<(), String> {
    trash::os_limited::restore_all([item.clone()]).map_err(|error| recycle_reason(&error))
}

/// Permanently delete items (cannot be undone).
pub fn delete_permanently(
    paths: &[PathBuf],
    token: &CancellationToken,
    progress: &mut dyn FnMut(&OpProgress),
) -> Result<OpReport> {
    if paths.iter().any(|p| !p.is_absolute()) {
        return Err(FsError::Validation("paths must be absolute".to_string()));
    }
    let mut report = OpReport::default();
    let total = paths.len();
    for (index, path) in paths.iter().enumerate() {
        if token.load(Ordering::Relaxed) {
            report.cancelled = true;
            break;
        }
        progress(&OpProgress {
            items_done: index,
            items_total: total,
            bytes_done: 0,
            bytes_total: 0,
            current: path.to_string_lossy().into_owned(),
        });
        if is_drive_root(path) {
            skip(&mut report, path, "drive_root");
            continue;
        }
        match remove_any(path) {
            Ok(()) => report.completed.push(CompletedItem {
                from: path.clone(),
                to: path.clone(),
            }),
            Err(error) => report.skipped.push(SkippedItem {
                path: path.clone(),
                reason: reason(&error),
            }),
        }
    }
    progress(&OpProgress {
        items_done: report.completed.len() + report.skipped.len(),
        items_total: total,
        bytes_done: 0,
        bytes_total: 0,
        current: String::new(),
    });
    Ok(report)
}
