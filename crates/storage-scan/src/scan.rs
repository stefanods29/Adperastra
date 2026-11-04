//! The bounded metadata scan (Step 11c E7).
//!
//! `scan_storage` walks one root, records every node through a `ScanSink`
//! (the native SQLite store is the production implementation), and returns
//! an explicit summary. Limits, cancellation and per-item failures produce
//! `coverage: partial`; they never turn into a false "complete" scan and
//! never modify any source file.

use std::collections::{BTreeSet, HashSet};
use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use fs_service::{CancellationToken, OpProgress};
use uuid::Uuid;

use crate::limits::{ScanLimits, MAX_REASON_CODES};
use crate::types::{
    Coverage, StorageError, StorageNode, StorageNodeKind, StorageScanRequest, StorageSummary,
};
use crate::walk::{inspect_chunk, FsScanIo, Inspected, ScanIo};

/// One scan identity: the summary id and the root/watch generation.
#[derive(Debug, Clone)]
pub struct ScanRun {
    pub scan_id: String,
    pub generation: u64,
}

/// Where the scanner records each node. Returning `StorageError::Limit`
/// stops the scan with an explicit partial summary, never a success claim.
pub trait ScanSink {
    fn record_node(&mut self, node: StorageNode) -> Result<(), StorageError>;
}

/// E7: scan with the real filesystem implementation.
pub fn scan_storage(
    request: &StorageScanRequest,
    run: &ScanRun,
    sink: &mut dyn ScanSink,
    cancel: &CancellationToken,
    progress: &mut dyn FnMut(&OpProgress),
) -> Result<StorageSummary, StorageError> {
    scan_storage_with(
        &FsScanIo,
        request,
        run,
        sink,
        cancel,
        progress,
        &ScanLimits::default(),
    )
}

/// The injectable form used by the unit tests and by the native store.
pub fn scan_storage_with<I: ScanIo + ?Sized>(
    io: &I,
    request: &StorageScanRequest,
    run: &ScanRun,
    sink: &mut dyn ScanSink,
    cancel: &CancellationToken,
    progress: &mut dyn FnMut(&OpProgress),
    limits: &ScanLimits,
) -> Result<StorageSummary, StorageError> {
    request.validate()?;
    if io.is_network(Path::new(&request.root)) && !request.allow_network {
        return Err(StorageError::Invalid);
    }
    let root = Path::new(&request.root);
    let root_info = io.inspect(root).map_err(|_| StorageError::Unavailable)?;
    if !root_info.is_dir {
        return Err(StorageError::Invalid);
    }

    let mut state = ScanState::new(run.scan_id.clone(), run.generation, request.include_hidden);
    let mut seen_dirs = HashSet::new();
    seen_dirs.insert(root_info.key.path_key.clone());
    let totals = visit_dir(
        io,
        root,
        root_info,
        None,
        0,
        &mut state,
        &mut seen_dirs,
        sink,
        cancel,
        progress,
        limits,
    )?;

    if state.cancelled {
        state.reasons.insert("cancelled");
    }
    if state.limit {
        state.reasons.insert("limit");
    }
    state.progress(progress, true);

    let coverage = Coverage::partial_if(
        state.cancelled
            || state.limit
            || state.skipped > 0
            || !state.reasons.is_empty()
            || totals.partial,
    );
    let allocated_unique_bytes = if state.files == 0 {
        Some(0)
    } else if state.unknown_allocated >= state.files {
        None
    } else {
        Some(state.allocated_known)
    };
    let mut reason_codes: Vec<String> = state
        .reasons
        .iter()
        .take(MAX_REASON_CODES)
        .map(|reason| (*reason).to_string())
        .collect();
    if state.cancelled && !reason_codes.iter().any(|code| code == "cancelled") {
        reason_codes.push("cancelled".to_string());
    }
    if state.limit && !reason_codes.iter().any(|code| code == "limit") {
        reason_codes.push("limit".to_string());
    }
    reason_codes.truncate(MAX_REASON_CODES);

    Ok(StorageSummary {
        scan_id: run.scan_id.clone(),
        root: request.root.clone(),
        logical_bytes: state.logical,
        allocated_unique_bytes,
        unknown_allocated_count: state.unknown_allocated,
        files_count: state.files,
        folders_count: state.folders,
        link_count: state.links,
        skipped_count: state.skipped,
        coverage,
        cancelled: state.cancelled,
        stale: false,
        generation: run.generation,
        calculated_unix: unix_now(),
        reason_codes,
    })
}

struct ScanState {
    logical: u64,
    files: u32,
    folders: u32,
    links: u32,
    skipped: u32,
    unknown_allocated: u32,
    allocated_known: u64,
    counted: u32,
    include_hidden: bool,
    seen_files: HashSet<(String, String)>,
    reasons: BTreeSet<&'static str>,
    cancelled: bool,
    limit: bool,
    last_progress: Instant,
}

impl ScanState {
    fn new(_scan_id: String, _generation: u64, include_hidden: bool) -> Self {
        Self {
            include_hidden,
            logical: 0,
            files: 0,
            folders: 0,
            links: 0,
            skipped: 0,
            unknown_allocated: 0,
            allocated_known: 0,
            counted: 0,
            seen_files: HashSet::new(),
            reasons: BTreeSet::new(),
            cancelled: false,
            limit: false,
            last_progress: Instant::now(),
        }
    }

    fn progress(&mut self, progress: &mut dyn FnMut(&OpProgress), force: bool) {
        if !force && self.last_progress.elapsed().as_millis() < 100 {
            return;
        }
        self.last_progress = Instant::now();
        progress(&OpProgress {
            items_done: self.counted as usize,
            items_total: 0,
            bytes_done: self.logical,
            bytes_total: 0,
            current: String::new(),
        });
    }
}

#[derive(Default)]
struct Totals {
    logical: u64,
    items: u32,
    children: u32,
    files: u32,
    folders: u32,
    links: u32,
    unknown: u32,
    allocated_known: u64,
    skipped: u32,
    partial: bool,
}

fn new_id() -> String {
    Uuid::new_v4().to_string()
}

fn record(
    sink: &mut dyn ScanSink,
    node: StorageNode,
    state: &mut ScanState,
) -> Result<(), StorageError> {
    match sink.record_node(node) {
        Ok(()) => Ok(()),
        Err(StorageError::Limit) => {
            state.limit = true;
            state.reasons.insert("limit");
            Ok(())
        }
        Err(error) => Err(error),
    }
}

#[allow(clippy::too_many_arguments)]
fn visit_dir<I: ScanIo + ?Sized>(
    io: &I,
    path: &Path,
    info: Inspected,
    parent_id: Option<String>,
    depth: u16,
    state: &mut ScanState,
    seen_dirs: &mut HashSet<String>,
    sink: &mut dyn ScanSink,
    cancel: &CancellationToken,
    progress: &mut dyn FnMut(&OpProgress),
    limits: &ScanLimits,
) -> Result<Totals, StorageError> {
    if cancel.load(Ordering::Relaxed) {
        state.cancelled = true;
        return Ok(Totals {
            partial: true,
            ..Totals::default()
        });
    }
    state.counted = state.counted.saturating_add(1);
    state.folders = state.folders.saturating_add(1);
    if state.folders > limits.max_folders || state.counted > limits.max_entries {
        state.limit = true;
        state.reasons.insert("limit");
        return Ok(Totals {
            partial: true,
            ..Totals::default()
        });
    }

    let id = new_id();
    let name = info.name.clone();
    let key = info.key.clone();

    let entries = match io.read_dir(path) {
        Ok(entries) => entries,
        Err(_) => {
            state.skipped = state.skipped.saturating_add(1);
            state.reasons.insert("permission");
            let node = StorageNode {
                id: id.clone(),
                parent_id: parent_id.clone(),
                key,
                path: path.to_string_lossy().into_owned(),
                name,
                kind: StorageNodeKind::Folder,
                logical_bytes: 0,
                allocated_bytes: None,
                item_count: 0,
                online_only: info.online_only,
                coverage: Coverage::Partial,
                children_count: 0,
            };
            record(sink, node, state)?;
            return Ok(Totals {
                partial: true,
                ..Totals::default()
            });
        }
    };

    let mut totals = Totals::default();
    for batch in entries.chunks(crate::limits::ENTRY_CHUNK) {
        if cancel.load(Ordering::Relaxed) {
            state.cancelled = true;
            totals.partial = true;
            break;
        }
        if state.counted >= limits.max_entries {
            state.limit = true;
            state.reasons.insert("limit");
            totals.partial = true;
            break;
        }
        let inspected = inspect_chunk(io, batch);
        for (entry_path, entry) in batch.iter().zip(inspected) {
            if cancel.load(Ordering::Relaxed) || state.limit {
                state.cancelled |= cancel.load(Ordering::Relaxed);
                totals.partial = true;
                break;
            }
            let Some(entry) = entry else {
                state.skipped = state.skipped.saturating_add(1);
                state.reasons.insert("permission");
                totals.skipped = totals.skipped.saturating_add(1);
                totals.partial = true;
                continue;
            };
            if entry.hidden && !state.include_hidden {
                continue;
            }
            if entry.is_link {
                state.skipped = state.skipped.saturating_add(1);
                state.reasons.insert("loop");
                totals.skipped = totals.skipped.saturating_add(1);
                totals.partial = true;
                continue;
            }
            if entry.is_dir {
                if state.counted >= limits.max_entries {
                    state.limit = true;
                    state.reasons.insert("limit");
                    totals.partial = true;
                    break;
                }
                let child_key = entry.key.path_key.clone();
                if !seen_dirs.insert(child_key) {
                    state.skipped = state.skipped.saturating_add(1);
                    state.reasons.insert("loop");
                    totals.skipped = totals.skipped.saturating_add(1);
                    totals.partial = true;
                    continue;
                }
                if depth.saturating_add(1) > limits.max_depth {
                    state.skipped = state.skipped.saturating_add(1);
                    state.reasons.insert("depth");
                    totals.skipped = totals.skipped.saturating_add(1);
                    totals.partial = true;
                    continue;
                }
                let child = visit_dir(
                    io,
                    entry_path,
                    entry,
                    Some(id.clone()),
                    depth.saturating_add(1),
                    state,
                    seen_dirs,
                    sink,
                    cancel,
                    progress,
                    limits,
                )?;
                totals.logical = totals.logical.saturating_add(child.logical);
                totals.items = totals.items.saturating_add(child.items).saturating_add(1);
                totals.children = totals.children.saturating_add(1);
                totals.folders = totals
                    .folders
                    .saturating_add(child.folders)
                    .saturating_add(1);
                totals.files = totals.files.saturating_add(child.files);
                totals.links = totals.links.saturating_add(child.links);
                totals.unknown = totals.unknown.saturating_add(child.unknown);
                totals.allocated_known =
                    totals.allocated_known.saturating_add(child.allocated_known);
                totals.skipped = totals.skipped.saturating_add(child.skipped);
                totals.partial |= child.partial;
            } else {
                if state.files >= limits.max_files || state.counted >= limits.max_entries {
                    state.limit = true;
                    state.reasons.insert("limit");
                    totals.partial = true;
                    break;
                }
                state.counted = state.counted.saturating_add(1);
                state.files = state.files.saturating_add(1);
                state.logical = state.logical.saturating_add(entry.logical_bytes);
                totals.logical = totals.logical.saturating_add(entry.logical_bytes);
                totals.items = totals.items.saturating_add(1);
                totals.children = totals.children.saturating_add(1);
                totals.files = totals.files.saturating_add(1);
                if entry.key.stable {
                    let physical = (entry.key.volume_id.clone(), entry.key.file_id.clone());
                    if !state.seen_files.insert(physical) {
                        state.links = state.links.saturating_add(1);
                        totals.links = totals.links.saturating_add(1);
                    } else if let Some(allocated) = entry.allocated_bytes {
                        state.allocated_known = state.allocated_known.saturating_add(allocated);
                        totals.allocated_known = totals.allocated_known.saturating_add(allocated);
                    } else {
                        state.unknown_allocated = state.unknown_allocated.saturating_add(1);
                        totals.unknown = totals.unknown.saturating_add(1);
                    }
                } else if let Some(allocated) = entry.allocated_bytes {
                    state.allocated_known = state.allocated_known.saturating_add(allocated);
                    totals.allocated_known = totals.allocated_known.saturating_add(allocated);
                } else {
                    state.unknown_allocated = state.unknown_allocated.saturating_add(1);
                    totals.unknown = totals.unknown.saturating_add(1);
                }
                let node = StorageNode {
                    id: new_id(),
                    parent_id: Some(id.clone()),
                    key: entry.key,
                    path: entry_path.to_string_lossy().into_owned(),
                    name: entry.name,
                    kind: StorageNodeKind::File,
                    logical_bytes: entry.logical_bytes,
                    allocated_bytes: entry.allocated_bytes,
                    item_count: 0,
                    online_only: entry.online_only,
                    coverage: Coverage::Complete,
                    children_count: 0,
                };
                record(sink, node, state)?;
                if state.limit {
                    totals.partial = true;
                    break;
                }
            }
            state.progress(progress, false);
        }
        if state.limit || state.cancelled {
            totals.partial = true;
            break;
        }
    }

    let node = StorageNode {
        id,
        parent_id,
        key,
        path: path.to_string_lossy().into_owned(),
        name,
        kind: StorageNodeKind::Folder,
        logical_bytes: totals.logical,
        allocated_bytes: None,
        item_count: totals.items,
        online_only: info.online_only,
        coverage: Coverage::partial_if(totals.partial || state.limit || state.cancelled),
        children_count: totals.children,
    };
    record(sink, node, state)?;
    state.progress(progress, true);
    Ok(totals)
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|age| age.as_secs())
        .unwrap_or(0)
}
