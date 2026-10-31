//! Walking the selected sources for creation (Step 06e D8). Metadata only:
//! nothing is opened for reading, online-only files are never hydrated, and
//! every skipped item is reported with the same bounded report as extraction.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use fs_service::owned_io::SourceIdentity;
use fs_service::{natural_cmp, stat_path, CancellationToken, Item, ItemKind, OpProgress};

use crate::create_types::CreateLimits;
use crate::entry::EntryKind;
use crate::error::ArchiveError;
use crate::limits::MAX_SKIPPED_REPORT;
use crate::plan::SkippedEntry;

/// How often walking reports progress.
const PROGRESS_EVERY: Duration = Duration::from_millis(100);

/// One item the plan accepted, with the metadata the writer checks again.
#[derive(Debug, Clone)]
pub(crate) struct Walked {
    pub source: PathBuf,
    pub inner: String,
    pub kind: EntryKind,
    pub size: u64,
    pub modified_unix: u64,
    pub identity: Option<SourceIdentity>,
}

pub(crate) struct WalkResult {
    pub entries: Vec<Walked>,
    pub skipped: Vec<SkippedEntry>,
    pub skipped_more: u64,
    pub total_bytes: u64,
}

struct Walker<'a> {
    include_hidden: bool,
    limits: &'a CreateLimits,
    token: &'a CancellationToken,
    progress: &'a mut dyn FnMut(&OpProgress),
    visited: HashSet<String>,
    entries: Vec<Walked>,
    skipped: Vec<SkippedEntry>,
    skipped_more: u64,
    manifest_bytes: u64,
    total_bytes: u64,
    items_done: usize,
    last_progress: Instant,
}

/// Plan every entry for `sources`, in natural order, without reading a file.
pub(crate) fn walk(
    sources: &[PathBuf],
    include_hidden: bool,
    limits: &CreateLimits,
    token: &CancellationToken,
    progress: &mut dyn FnMut(&OpProgress),
) -> Result<WalkResult, ArchiveError> {
    let roots = clean_roots(sources, limits)?;
    let mut walker = Walker {
        include_hidden,
        limits,
        token,
        progress,
        visited: HashSet::new(),
        entries: Vec::new(),
        skipped: Vec::new(),
        skipped_more: 0,
        manifest_bytes: 0,
        total_bytes: 0,
        items_done: 0,
        last_progress: Instant::now(),
    };
    let mut roots = roots;
    roots.sort_by(|left, right| natural_cmp(&file_name(left), &file_name(right)));
    for root in &roots {
        walker.check_cancel()?;
        walker.root(root)?;
    }
    walker.report_progress(&roots.first().cloned().unwrap_or_default(), true);
    Ok(WalkResult {
        entries: walker.entries,
        skipped: walker.skipped,
        skipped_more: walker.skipped_more,
        total_bytes: walker.total_bytes,
    })
}

/// Remove duplicates and children of selected folders, and refuse two roots
/// that would share one name inside the archive.
fn clean_roots(sources: &[PathBuf], limits: &CreateLimits) -> Result<Vec<PathBuf>, ArchiveError> {
    if sources.len() > limits.max_sources {
        return Err(ArchiveError::TooManySources);
    }
    let mut path_bytes = 0usize;
    for source in sources {
        if !source.is_absolute() {
            return Err(ArchiveError::BadRequest);
        }
        path_bytes = path_bytes.saturating_add(source.to_string_lossy().len());
    }
    if path_bytes > limits.max_root_path_bytes {
        return Err(ArchiveError::TooManySources);
    }
    let mut kept: Vec<PathBuf> = Vec::new();
    for source in sources {
        let normalized = normalize(source);
        if kept.iter().any(|other| normalize(other) == normalized) {
            continue;
        }
        kept.push(source.clone());
    }
    // A selected child of a selected folder is already inside that folder.
    let mut result = Vec::new();
    for (position, source) in kept.iter().enumerate() {
        let normalized = normalize(source);
        let below_another = kept.iter().enumerate().any(|(other_position, other)| {
            if other_position == position {
                return false;
            }
            let parent = normalize(other);
            normalized
                .strip_prefix(&parent)
                .is_some_and(|rest| rest.starts_with('\\') || rest.starts_with('/'))
        });
        if !below_another {
            result.push(source.clone());
        }
    }
    // Two unrelated roots with one name would collide inside the archive.
    let mut names: Vec<(String, String)> = Vec::new();
    for source in &result {
        let name = file_name(source).to_lowercase();
        match names.iter().find(|(seen, _)| *seen == name) {
            Some((_, path)) if path != &normalize(source) => return Err(ArchiveError::BadRequest),
            Some(_) => {}
            None => names.push((name, normalize(source))),
        }
    }
    Ok(result)
}

fn normalize(path: &Path) -> String {
    path.to_string_lossy()
        .trim_end_matches(['\\', '/'])
        .replace('/', "\\")
        .to_lowercase()
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

impl Walker<'_> {
    fn root(&mut self, path: &Path) -> Result<(), ArchiveError> {
        let Some(name) = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
        else {
            self.skip(path, "invalid_name");
            return Ok(());
        };
        self.enter(path, &name, 1)
    }

    fn enter(&mut self, path: &Path, inner: &str, depth: usize) -> Result<(), ArchiveError> {
        let item = match stat_path(path) {
            Ok(item) => item,
            Err(_) => {
                self.skip(path, "access_denied");
                return Ok(());
            }
        };
        if let Some(reason) = self.refused(&item) {
            self.skip(path, reason);
            return Ok(());
        }
        if depth > self.limits.max_depth || inner.chars().count() > self.limits.max_inner_path_chars
        {
            return Err(ArchiveError::BadRequest);
        }
        self.manifest_bytes = self.manifest_bytes.saturating_add(inner.len() as u64);
        if self.manifest_bytes > self.limits.max_manifest_bytes {
            return Err(ArchiveError::BadRequest);
        }
        match item.kind {
            ItemKind::Folder => {
                self.entries.push(Walked {
                    source: path.to_path_buf(),
                    inner: inner.to_string(),
                    kind: EntryKind::Folder,
                    size: 0,
                    modified_unix: item.modified_unix,
                    identity: None,
                });
                self.count_entry()?;
                let canonical = std::fs::canonicalize(path)
                    .map(|value| normalize(&value))
                    .unwrap_or_else(|_| normalize(path));
                if !self.visited.insert(canonical) {
                    return Ok(());
                }
                self.children(path, inner, depth)?;
            }
            ItemKind::File => {
                let identity = match SourceIdentity::capture(path) {
                    Ok(identity) => identity,
                    Err(_) => {
                        self.skip(path, "source_changed");
                        return Ok(());
                    }
                };
                self.total_bytes = self.total_bytes.saturating_add(item.size);
                if self.total_bytes > self.limits.max_total_bytes {
                    return Err(ArchiveError::CreateTooLarge);
                }
                self.entries.push(Walked {
                    source: path.to_path_buf(),
                    inner: inner.to_string(),
                    kind: EntryKind::File,
                    size: item.size,
                    modified_unix: item.modified_unix,
                    identity: Some(identity),
                });
                self.count_entry()?;
            }
            ItemKind::Drive | ItemKind::Other => self.skip(path, "other"),
        }
        self.items_done += 1;
        self.report_progress(path, false);
        Ok(())
    }

    fn children(&mut self, folder: &Path, inner: &str, depth: usize) -> Result<(), ArchiveError> {
        let Ok(read) = std::fs::read_dir(folder) else {
            self.skip(folder, "access_denied");
            return Ok(());
        };
        let mut children: Vec<PathBuf> = read.flatten().map(|entry| entry.path()).collect();
        children.sort_by(|left, right| natural_cmp(&file_name(left), &file_name(right)));
        for child in children {
            self.check_cancel()?;
            let name = file_name(&child);
            let inner_child = format!("{inner}/{name}");
            self.enter(&child, &inner_child, depth + 1)?;
        }
        Ok(())
    }

    fn refused(&self, item: &Item) -> Option<&'static str> {
        if item.attrs.is_link {
            return Some("link_entry");
        }
        if item.attrs.online_only {
            return Some("online_only");
        }
        if !self.include_hidden && (item.attrs.hidden || item.attrs.system) {
            return Some("hidden");
        }
        None
    }

    fn count_entry(&mut self) -> Result<(), ArchiveError> {
        if self.entries.len() > self.limits.max_entries {
            return Err(ArchiveError::TooManySources);
        }
        Ok(())
    }

    fn check_cancel(&self) -> Result<(), ArchiveError> {
        if self.token.load(Ordering::Relaxed) {
            return Err(ArchiveError::Cancelled);
        }
        Ok(())
    }

    fn skip(&mut self, path: &Path, reason: &str) {
        let text = path.to_string_lossy().into_owned();
        if self.skipped.len() < MAX_SKIPPED_REPORT {
            self.skipped.push(SkippedEntry {
                path: text,
                reason: reason.to_string(),
            });
        } else {
            self.skipped_more += 1;
        }
    }

    fn report_progress(&mut self, current: &Path, force: bool) {
        if !force && self.last_progress.elapsed() < PROGRESS_EVERY {
            return;
        }
        self.last_progress = Instant::now();
        (self.progress)(&OpProgress {
            items_done: self.items_done,
            items_total: 0,
            bytes_done: self.total_bytes,
            bytes_total: 0,
            current: current.to_string_lossy().into_owned(),
        });
    }
}
