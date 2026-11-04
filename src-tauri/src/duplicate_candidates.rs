//! Stage 1 of duplicate review (Step 11c T4): enumerate regular local
//! files, group by reported size, and collapse hard links to the physical
//! file they name. No content is read here; online-only placeholders and
//! reparse entries are reported as skipped, never hashed.

use std::collections::{BTreeMap, HashMap};
use std::path::PathBuf;

use ::storage_scan::walk::{enumerate_files, EnumerateOutcome, FsScanIo};
use ::storage_scan::{Coverage, DuplicateRequest, MAX_HARDLINK_PATHS};
use fs_service::owned_io::SourceIdentity;
use fs_service::{CancellationToken, FileIdentityKey, OpProgress, SourceStamp};

#[derive(Debug, Clone)]
pub struct CandidateFile {
    /// One path per hard-link alias; the first is the reported path.
    pub paths: Vec<String>,
    pub key: FileIdentityKey,
    pub source: SourceStamp,
    pub identity: SourceIdentity,
    pub logical_bytes: u64,
    pub allocated_bytes: Option<u64>,
    pub modified_unix: u64,
}

impl CandidateFile {
    pub fn primary_path(&self) -> &str {
        &self.paths[0]
    }
}

#[derive(Debug, Clone)]
pub struct CandidateGroup {
    #[allow(dead_code)] // Size is the stage-1 grouping key, kept for diagnostics.
    pub size: u64,
    pub members: Vec<CandidateFile>,
}

#[derive(Debug, Clone, Copy)]
pub struct CandidateCoverage {
    pub skipped_count: u32,
    pub coverage: Coverage,
    #[allow(dead_code)] // Cancellation is reflected in `coverage`.
    pub cancelled: bool,
}

/// Stage 1 result; the input cap is the shared 1,000,000-file bound.
#[derive(Debug, Clone)]
pub struct CandidateSet {
    pub groups: Vec<CandidateGroup>,
    pub coverage: CandidateCoverage,
}

/// Enumerate up to the shared input cap and group by size. A file whose
/// metadata, stamp or identity cannot be read is counted as skipped; it is
/// never guessed into a group.
pub fn enumerate_candidates(
    request: &DuplicateRequest,
    cancel: &CancellationToken,
    progress: &mut dyn FnMut(&OpProgress),
) -> Result<CandidateSet, String> {
    request.validate().map_err(|error| error.code().to_string())?;
    let roots: Vec<PathBuf> = request.roots.iter().map(PathBuf::from).collect();
    let (files, outcome) = enumerate_files(
        &FsScanIo,
        &roots,
        request.include_hidden,
        request.allow_network,
        cancel,
        progress,
    )
    .map_err(|error| error.code().to_string())?;
    let (groups, additional_skipped) = group_candidates(files, request.minimum_bytes);
    let skipped_count = outcome.skipped_count.saturating_add(additional_skipped);
    let cancelled = outcome.cancelled;
    Ok(CandidateSet {
        groups,
        coverage: CandidateCoverage {
            skipped_count,
            coverage: combine_coverage(&outcome),
            cancelled,
        },
    })
}

fn combine_coverage(outcome: &EnumerateOutcome) -> Coverage {
    if outcome.coverage.is_complete() && !outcome.cancelled {
        Coverage::Complete
    } else {
        Coverage::Partial
    }
}

/// Group by reported size and collapse stable hard links. The returned
/// `u32` is the number of aliases or non-local files skipped.
pub fn group_candidates(
    files: Vec<::storage_scan::FileRecord>,
    minimum_bytes: u64,
) -> (Vec<CandidateGroup>, u32) {
    let mut skipped = 0u32;
    let mut by_size: BTreeMap<u64, Vec<CandidateFile>> = BTreeMap::new();
    for file in files {
        if file.online_only {
            skipped = skipped.saturating_add(1);
            continue;
        }
        if file.logical_bytes < minimum_bytes {
            continue;
        }
        let candidate = CandidateFile {
            paths: vec![file.path],
            key: file.key,
            source: file.stamp,
            identity: file.identity,
            logical_bytes: file.logical_bytes,
            allocated_bytes: file.allocated_bytes,
            modified_unix: file.modified_unix,
        };
        by_size
            .entry(candidate.logical_bytes)
            .or_default()
            .push(candidate);
    }

    let mut groups = Vec::new();
    for (size, members) in by_size {
        let mut collapsed: Vec<CandidateFile> = Vec::new();
        let mut physical: HashMap<(String, String), usize> = HashMap::new();
        for member in members {
            if member.key.stable {
                let identity = (member.key.volume_id.clone(), member.key.file_id.clone());
                if let Some(index) = physical.get(&identity).copied() {
                    let existing = &mut collapsed[index];
                    if existing.paths.len() < MAX_HARDLINK_PATHS {
                        existing.paths.push(member.paths[0].clone());
                    } else {
                        skipped = skipped.saturating_add(1);
                    }
                    continue;
                }
                physical.insert(identity, collapsed.len());
            }
            collapsed.push(member);
        }
        if collapsed.len() >= 2 {
            groups.push(CandidateGroup {
                size,
                members: collapsed,
            });
        }
    }
    (groups, skipped)
}

/// Stage 1 of the native command. Kept public so the tests can feed
/// synthetic records without creating a million files.
#[allow(dead_code)] // Test and coordinator entry point for synthetic records.
pub fn groups_from_records(
    records: Vec<::storage_scan::FileRecord>,
    minimum_bytes: u64,
) -> (Vec<CandidateGroup>, u32) {
    group_candidates(records, minimum_bytes)
}
