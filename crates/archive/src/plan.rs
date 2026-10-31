//! The extraction plan (Step 06d D5, D6): what an extraction would write,
//! what it must skip, and which top-level names it needs. Everything is
//! decided before the first byte is written.

use crate::entry::{EntryKind, Listing};
use crate::error::ArchiveError;
use crate::limits::{check_bomb, Limits};
use crate::path::{normalize_inner_path, parent_of, relative_to};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;

/// The most inner paths one extraction may name.
pub const MAX_EXTRACT_PATHS: usize = 10_000;

/// One extraction, as the app and the helper exchange it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractRequest {
    /// Inner paths to write (files or folders; a folder means everything
    /// below it). Empty: everything below `base`.
    pub paths: Vec<String>,
    /// The inner folder the output is relative to ("" is the root).
    pub base: String,
    pub dest_dir: String,
    /// A new folder to make inside `dest_dir` (its name is numbered when
    /// taken).
    pub new_folder: Option<String>,
    /// The archive's size when it was opened: a different size means the
    /// file changed.
    pub expected_size: u64,
    /// The archive's modified time, or 0 to skip that check.
    pub expected_modified: u64,
    /// Open mode: exactly one file, with its own name.
    pub single_file: bool,
    /// The `Zone.Identifier` text every written file also gets.
    pub zone: Option<String>,
}

/// Something the plan leaves out, and why (`errors.archive.<reason>`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkippedEntry {
    pub path: String,
    pub reason: String,
}

/// What the archive file itself says, used to detect a changed archive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ArchiveFacts {
    pub size: u64,
    pub modified_unix: u64,
}

/// One file or folder an extraction writes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlannedEntry {
    pub index: u32,
    pub inner: String,
    /// The path below `base`, one component per folder.
    pub relative: Vec<String>,
    pub size: u64,
    pub modified_unix: u64,
}

/// Everything one extraction will do.
#[derive(Debug, Clone, Default)]
pub struct ExtractPlan {
    pub files: Vec<PlannedEntry>,
    pub folders: Vec<PlannedEntry>,
    pub skipped: Vec<SkippedEntry>,
    pub bytes_total: u64,
    /// The distinct first names the extraction creates, first seen first.
    pub top_names: Vec<String>,
}

/// Decide what `request` would write. Errors are codes the UI translates;
/// nothing on disk is touched.
pub fn plan_extract(
    listing: &Listing,
    request: &ExtractRequest,
    facts: ArchiveFacts,
    limits: &Limits,
) -> Result<ExtractPlan, ArchiveError> {
    plan_extract_with_options(listing, request, facts, limits, false)
}

/// The same plan, with encrypted entries allowed only when the caller says
/// so explicitly (Step 06e D11). Without that, old behavior is unchanged.
pub fn plan_extract_with_options(
    listing: &Listing,
    request: &ExtractRequest,
    facts: ArchiveFacts,
    limits: &Limits,
    allow_encrypted: bool,
) -> Result<ExtractPlan, ArchiveError> {
    if facts.size != request.expected_size
        || (request.expected_modified != 0 && request.expected_modified != facts.modified_unix)
    {
        return Err(ArchiveError::Changed);
    }
    if request.paths.len() > MAX_EXTRACT_PATHS {
        return Err(ArchiveError::BadRequest);
    }
    let known = known_paths(listing);
    let base = &request.base;
    if !base.is_empty()
        && (normalize_inner_path(base, limits).as_deref() != Ok(base.as_str())
            || !known.folders.contains(base.as_str()))
    {
        return Err(ArchiveError::BadRequest);
    }
    for path in &request.paths {
        if normalize_inner_path(path, limits).as_deref() != Ok(path.as_str())
            || !known.all.contains(path.as_str())
            || relative_to(path, base).is_none()
        {
            return Err(ArchiveError::BadRequest);
        }
    }
    if request.single_file {
        if request.paths.len() != 1 {
            return Err(ArchiveError::NotAFile);
        }
        let entry = listing
            .entries
            .iter()
            .find(|entry| entry.path == request.paths[0])
            .ok_or(ArchiveError::NotAFile)?;
        if entry.kind != EntryKind::File {
            return Err(ArchiveError::NotAFile);
        }
        if entry.encrypted && !allow_encrypted {
            return Err(ArchiveError::PasswordRequired);
        }
    }

    let mut plan = ExtractPlan::default();
    for entry in &listing.entries {
        if !is_selected(entry, request) {
            continue;
        }
        let Some(relative) = relative_to(&entry.path, base) else {
            continue;
        };
        if let Some(problem) = &entry.problem {
            plan.skipped.push(SkippedEntry {
                path: entry.path.clone(),
                reason: problem.clone(),
            });
            continue;
        }
        let planned = PlannedEntry {
            index: entry.index,
            inner: entry.path.clone(),
            relative: relative
                .split('/')
                .filter(|part| !part.is_empty())
                .map(str::to_string)
                .collect(),
            size: entry.size,
            modified_unix: entry.modified_unix,
        };
        match entry.kind {
            EntryKind::Folder => plan.folders.push(planned),
            EntryKind::Link => plan.skipped.push(SkippedEntry {
                path: entry.path.clone(),
                reason: "link_entry".to_string(),
            }),
            EntryKind::File if entry.encrypted && !allow_encrypted => {
                plan.skipped.push(SkippedEntry {
                    path: entry.path.clone(),
                    reason: "password_required".to_string(),
                })
            }
            EntryKind::File => plan.files.push(planned),
        }
    }
    plan.bytes_total = plan.files.iter().map(|file| file.size).sum();
    check_bomb(plan.bytes_total, facts.size, limits)?;
    plan.top_names = top_names_of(&plan);
    Ok(plan)
}

/// The names the extraction creates in the destination folder, with the
/// name each one really gets: a numbered one when the name is taken, so
/// nothing is ever replaced (R-SAFE-2).
pub fn top_level_names(plan: &ExtractPlan, root: &Path) -> Vec<(String, String)> {
    plan.top_names
        .iter()
        .map(|name| {
            let target = root.join(name);
            let actual = if target.symlink_metadata().is_ok() {
                fs_service::unique_destination(root, name)
                    .file_name()
                    .map(|file| file.to_string_lossy().into_owned())
                    .unwrap_or_else(|| name.clone())
            } else {
                name.clone()
            };
            (name.clone(), actual)
        })
        .collect()
}

fn is_selected(entry: &crate::entry::ArchiveEntry, request: &ExtractRequest) -> bool {
    if request.paths.is_empty() {
        return request.base.is_empty() || relative_to(&entry.path, &request.base).is_some();
    }
    request
        .paths
        .iter()
        .any(|wanted| entry.path == *wanted || entry.path.starts_with(&format!("{wanted}/")))
}

fn top_names_of(plan: &ExtractPlan) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut names = Vec::new();
    for entry in plan.files.iter().chain(plan.folders.iter()) {
        let Some(first) = entry.relative.first() else {
            continue;
        };
        if seen.insert(first.to_lowercase()) {
            names.push(first.clone());
        }
    }
    names
}

struct KnownPaths {
    all: HashSet<String>,
    folders: HashSet<String>,
}

/// Every path a request may name: the entries, and the folders made from
/// their paths.
fn known_paths(listing: &Listing) -> KnownPaths {
    let mut known = KnownPaths {
        all: HashSet::new(),
        folders: HashSet::new(),
    };
    for entry in &listing.entries {
        known.all.insert(entry.path.clone());
        if entry.kind == EntryKind::Folder {
            known.folders.insert(entry.path.clone());
        }
        let mut parent = parent_of(&entry.path);
        while !parent.is_empty() {
            known.all.insert(parent.to_string());
            known.folders.insert(parent.to_string());
            parent = parent_of(parent);
        }
    }
    known
}
