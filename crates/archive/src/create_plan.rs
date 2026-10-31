//! The creation plan (Step 06e T5): every accepted item, every reported
//! skip, and the bounds it obeys. Nothing is created or written here.

use std::path::{Path, PathBuf};

use fs_service::owned_io::SourceIdentity;
use fs_service::{CancellationToken, OpProgress};

use crate::create_types::CreateLimits;
use crate::create_walk::{walk, Walked};
use crate::entry::EntryKind;
use crate::error::ArchiveError;
use crate::plan::SkippedEntry;

/// One item the writer will add to the new archive.
#[derive(Debug, Clone)]
pub struct CreateEntry {
    pub source: PathBuf,
    pub inner_path: String,
    pub kind: EntryKind,
    pub size: u64,
    pub modified_unix: u64,
    /// The exact file that was enumerated; kept out of every UI shape.
    pub(crate) identity: Option<SourceIdentity>,
}

/// Everything one creation will add, and everything it leaves out.
#[derive(Debug, Clone, Default)]
pub struct CreatePlan {
    pub entries: Vec<CreateEntry>,
    pub skipped: Vec<SkippedEntry>,
    pub skipped_more: u64,
    pub total_bytes: u64,
    /// Selected roots after duplicates and nested selections were removed.
    pub roots: usize,
}

impl CreatePlan {
    pub fn files(&self) -> usize {
        self.entries
            .iter()
            .filter(|entry| entry.kind == EntryKind::File)
            .count()
    }

    pub fn folders(&self) -> usize {
        self.entries
            .iter()
            .filter(|entry| entry.kind == EntryKind::Folder)
            .count()
    }
}

/// Walk the selection and decide what a new archive would hold.
pub fn plan_create(
    sources: &[String],
    include_hidden: bool,
    limits: &CreateLimits,
    token: &CancellationToken,
    progress: &mut dyn FnMut(&OpProgress),
) -> Result<CreatePlan, ArchiveError> {
    plan_create_with_exclusion(sources, include_hidden, limits, token, progress, None)
}

/// The same, leaving out one path (the archive being created, when the
/// destination lies inside a selected folder).
pub fn plan_create_with_exclusion(
    sources: &[String],
    include_hidden: bool,
    limits: &CreateLimits,
    token: &CancellationToken,
    progress: &mut dyn FnMut(&OpProgress),
    exclude: Option<&Path>,
) -> Result<CreatePlan, ArchiveError> {
    let paths: Vec<PathBuf> = sources.iter().map(PathBuf::from).collect();
    let walked = walk(&paths, include_hidden, limits, token, progress)?;
    let excluded = exclude.map(normalize);
    let mut plan = CreatePlan {
        skipped: walked.skipped,
        skipped_more: walked.skipped_more,
        total_bytes: walked.total_bytes,
        roots: sources.len(),
        ..CreatePlan::default()
    };
    for entry in walked.entries {
        if excluded
            .as_deref()
            .is_some_and(|target| normalize(&entry.source) == target)
        {
            continue;
        }
        plan.entries.push(from_walked(entry));
    }
    plan.roots = plan
        .entries
        .iter()
        .filter(|entry| !entry.inner_path.contains('/'))
        .count();
    // Every file must carry the identity the writer checks again.
    if plan
        .entries
        .iter()
        .any(|entry| entry.kind == EntryKind::File && entry.identity.is_none())
    {
        return Err(ArchiveError::SourceChanged);
    }
    Ok(plan)
}

fn from_walked(entry: Walked) -> CreateEntry {
    CreateEntry {
        source: entry.source,
        inner_path: entry.inner,
        kind: entry.kind,
        size: entry.size,
        modified_unix: entry.modified_unix,
        identity: entry.identity,
    }
}

fn normalize(path: &Path) -> String {
    path.to_string_lossy().replace('/', "\\").to_lowercase()
}
