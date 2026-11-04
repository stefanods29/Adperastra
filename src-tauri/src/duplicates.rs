//! Duplicate review commands and job (Step 11c T4/T5, E2).
//!
//! Stage 1 groups by size and collapses hard links; stage 2 filters with a
//! bounded partial hash; stage 3 hashes the whole file through a guarded
//! handle; a group becomes verified only after byte-for-byte comparison.
//! Nothing here deletes, moves or writes. `cleanup_available` is false until
//! an exact approved-object recycle operation is proved.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use ::storage_scan::{
    Coverage, DuplicateGroup, DuplicateMember, DuplicatePage, DuplicateRequest, MAX_PAGE_GROUPS,
};
use fs_service::FileIdentityKey;
use tauri::{AppHandle, State, WebviewWindow};
use uuid::Uuid;

use crate::background::BackgroundTaskKind;
use crate::background_queue::{BackgroundPriority, BackgroundScheduler};
use crate::duplicate_candidates::{enumerate_candidates, CandidateFile, CandidateSet};
use crate::duplicate_cleanup::{cleanup_capability, hex, DuplicateCleanupService};
use crate::duplicate_compare::verify_group;
use crate::duplicate_hash::{
    full_hash_guarded, partial_hash, stamp_matches, DuplicateHashCache,
};
use crate::jobs::{spawn_job, Jobs};

pub struct DuplicateScan {
    pub groups: Vec<DuplicateGroup>,
    pub skipped_count: u32,
    pub coverage: Coverage,
    pub generation: u64,
    pub cleanup_available: bool,
}

#[derive(Default)]
pub struct DuplicatesState {
    scans: Mutex<HashMap<String, DuplicateScan>>,
    running: Mutex<bool>,
}

impl DuplicatesState {
    pub fn new() -> Self {
        Self {
            scans: Mutex::new(HashMap::new()),
            running: Mutex::new(false),
        }
    }

    fn try_start(&self) -> Result<(), String> {
        let mut running = self
            .running
            .lock()
            .map_err(|_| "storage.unavailable".to_string())?;
        if *running {
            return Err("duplicates.busy".to_string());
        }
        *running = true;
        Ok(())
    }

    fn insert(&self, scan_id: String, scan: DuplicateScan) -> Result<(), String> {
        let mut scans = self
            .scans
            .lock()
            .map_err(|_| "storage.unavailable".to_string())?;
        if scans.len() >= 4 {
            if let Some(oldest) = scans.keys().next().cloned() {
                scans.remove(&oldest);
            }
        }
        scans.insert(scan_id, scan);
        Ok(())
    }

    fn with_scan<T>(
        &self,
        scan_id: &str,
        work: impl FnOnce(&DuplicateScan) -> Result<T, String>,
    ) -> Result<T, String> {
        let scans = self
            .scans
            .lock()
            .map_err(|_| "storage.unavailable".to_string())?;
        let scan = scans
            .get(scan_id)
            .ok_or_else(|| "storage.invalid".to_string())?;
        work(scan)
    }
}

struct DuplicateRunGuard {
    state: Arc<DuplicatesState>,
}

impl Drop for DuplicateRunGuard {
    fn drop(&mut self) {
        if let Ok(mut running) = self.state.running.lock() {
            *running = false;
        }
    }
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|age| age.as_secs())
        .unwrap_or(0)
}

/// Run all three stages. A source that changes between stage 2 and stage 3
/// is skipped; the job continues and reports partial coverage.
pub fn collect_groups(
    request: &DuplicateRequest,
    cancel: &fs_service::CancellationToken,
    progress: &mut dyn FnMut(&fs_service::OpProgress),
    mut cache: Option<&mut dyn DuplicateHashCache>,
) -> Result<DuplicateScan, String> {
    let candidates: CandidateSet = enumerate_candidates(request, cancel, progress)?;
    let mut groups = Vec::new();
    let mut skipped = candidates.coverage.skipped_count;
    let mut bytes_seen = 0u64;
    let mut files_seen = 0usize;

    for size_group in candidates.groups {
        let mut partial_buckets: HashMap<[u8; 32], Vec<CandidateFile>> = HashMap::new();
        for member in size_group.members {
            bytes_seen = bytes_seen.saturating_add(member.logical_bytes);
            files_seen = files_seen.saturating_add(1);
            match partial_hash(&member, cancel) {
                Ok(hash) => partial_buckets.entry(hash).or_default().push(member),
                Err(code) if code == "duplicates.changed" => {
                    skipped = skipped.saturating_add(1);
                }
                Err(code) => return Err(code),
            }
            if cancel.load(std::sync::atomic::Ordering::Relaxed) {
                return Ok(DuplicateScan {
                    groups,
                    skipped_count: skipped,
                    coverage: Coverage::Partial,
                    generation: 0,
                    cleanup_available: cleanup_capability(),
                });
            }
            progress(&fs_service::OpProgress {
                items_done: files_seen,
                items_total: 0,
                bytes_done: bytes_seen,
                bytes_total: 0,
                current: String::new(),
            });
        }

        for (_, members) in partial_buckets {
            if members.len() < 2 {
                continue;
            }
            let mut full_buckets: HashMap<[u8; 32], Vec<(CandidateFile, [u8; 32])>> =
                HashMap::new();
            for member in members {
                // A cache hit is used only when the current object still
                // has the exact reviewed stamp; otherwise stage 3 runs.
                let cached = if let Some(store) = cache.as_ref() {
                    let current = fs_service::capture_source_stamp(std::path::Path::new(
                        member.primary_path(),
                    ))
                    .ok();
                    if current
                        .as_ref()
                        .is_some_and(|stamp| stamp_matches(stamp, &member.source))
                    {
                        store.get(&member.key, &member.source)
                    } else {
                        None
                    }
                } else {
                    None
                };
                let hash = match cached {
                    Some(hash) => hash,
                    None => match full_hash_guarded(&member, cancel, &mut |_| {}) {
                        Ok(hash) => {
                            if let Some(store) = cache.as_mut() {
                                store.put(&member.key, &member.source, &hash);
                            }
                            hash
                        }
                        Err(code) if code == "duplicates.changed" => {
                            skipped = skipped.saturating_add(1);
                            continue;
                        }
                        Err(code) => return Err(code),
                    },
                };
                full_buckets
                    .entry(hash)
                    .or_default()
                    .push((member, hash));
            }
            for (_hash, bucket) in full_buckets {
                if bucket.len() < 2 {
                    continue;
                }
                let physical: Vec<CandidateFile> =
                    bucket.iter().map(|(member, _)| member.clone()).collect();
                let hashes: Vec<[u8; 32]> = bucket.iter().map(|(_, hash)| *hash).collect();
                let verified = verify_group(&physical, &hashes, cancel)?;
                let member_count = u32::try_from(bucket.len()).unwrap_or(u32::MAX);
                let reclaimable = if verified {
                    reclaimable_bytes(&physical)
                } else {
                    None
                };
                let mut members: Vec<DuplicateMember> = bucket
                    .iter()
                    .map(|(member, hash)| DuplicateMember {
                        key: member.key.clone(),
                        source: member.source.clone(),
                        paths: member.paths.iter().take(256).cloned().collect(),
                        full_hash: hex(hash),
                        logical_bytes: member.logical_bytes,
                        allocated_bytes: member.allocated_bytes,
                        modified_unix: member.modified_unix,
                        verified,
                    })
                    .collect();
                members.sort_by_key(|member| member.paths[0].to_lowercase());
                members.truncate(256);
                let mut kept_bytes = 0usize;
                let mut kept = Vec::new();
                for member in members {
                    let next = member_wire_bytes(&member);
                    if !kept.is_empty()
                        && kept_bytes.saturating_add(next) > MAX_DUPLICATE_PAGE_BYTES
                    {
                        break;
                    }
                    kept_bytes = kept_bytes.saturating_add(next);
                    kept.push(member);
                }
                let visible = u32::try_from(kept.len()).unwrap_or(u32::MAX);
                groups.push(DuplicateGroup {
                    id: Uuid::new_v4().to_string(),
                    members: kept,
                    member_count,
                    members_page_complete: member_count <= visible,
                    verified,
                    reclaimable_bytes: reclaimable,
                });
            }
        }
    }

    groups.sort_by(|left, right| {
        right
            .reclaimable_bytes
            .unwrap_or(0)
            .cmp(&left.reclaimable_bytes.unwrap_or(0))
            .then_with(|| {
                left.members
                    .first()
                    .map(|member| member.paths[0].to_lowercase())
                    .cmp(
                        &right
                            .members
                            .first()
                            .map(|member| member.paths[0].to_lowercase()),
                    )
            })
    });

    Ok(DuplicateScan {
        groups,
        skipped_count: skipped,
        coverage: if skipped > 0 || !candidates.coverage.coverage.is_complete() {
            Coverage::Partial
        } else {
            Coverage::Complete
        },
        generation: 0,
        cleanup_available: cleanup_capability(),
    })
}

fn reclaimable_bytes(members: &[CandidateFile]) -> Option<u64> {
    let mut total = 0u64;
    for member in members.iter().skip(1) {
        total = total.saturating_add(member.allocated_bytes?);
    }
    Some(total)
}

const MAX_DUPLICATE_PAGE_BYTES: usize = 768 * 1024;

fn member_wire_bytes(member: &DuplicateMember) -> usize {
    member.paths.iter().map(String::len).sum::<usize>()
        + member.key.path_key.len()
        + member.source.path_key.len()
        + 320
}

fn group_wire_bytes(group: &DuplicateGroup) -> usize {
    group
        .members
        .iter()
        .map(member_wire_bytes)
        .sum::<usize>()
        + 160
}

fn page(scan_id: &str, scan: &DuplicateScan, cursor: Option<&str>) -> DuplicatePage {
    let start = match cursor {
        None => 0,
        Some(id) => scan
            .groups
            .iter()
            .position(|group| group.id == id)
            .map(|index| index + 1)
            .unwrap_or(usize::MAX),
    };
    let mut bytes = 0usize;
    let mut slice: Vec<DuplicateGroup> = Vec::new();
    if start != usize::MAX {
        for group in scan.groups.iter().skip(start).take(MAX_PAGE_GROUPS) {
            let next = group_wire_bytes(group);
            if !slice.is_empty() && bytes + next > MAX_DUPLICATE_PAGE_BYTES {
                break;
            }
            bytes += next;
            slice.push(group.clone());
        }
    }
    let complete = start != usize::MAX
        && start.saturating_add(slice.len()) >= scan.groups.len();
    DuplicatePage {
        scan_id: scan_id.to_string(),
        next_cursor: if complete {
            None
        } else {
            slice.last().map(|group| group.id.clone())
        },
        groups: slice,
        complete,
        skipped_count: scan.skipped_count,
        coverage: scan.coverage,
        cleanup_available: scan.cleanup_available,
    }
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn duplicates_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    state: State<'_, Arc<DuplicatesState>>,
    storage: State<'_, Arc<crate::storage_scan::StorageState>>,
    scheduler: State<'_, Arc<BackgroundScheduler>>,
    request_id: String,
    request: DuplicateRequest,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    request
        .validate()
        .map_err(|error| error.code().to_string())?;
    for root in &request.roots {
        crate::validate_absolute_path(root).map_err(|_| "storage.invalid".to_string())?;
    }
    let scan_id = Uuid::new_v4().to_string();
    let generation = request
        .roots
        .first()
        .map(|root| crate::storage_watch::root_generation(std::path::Path::new(root)))
        .transpose()?
        .unwrap_or(0);
    state.try_start()?;
    let run_guard = DuplicateRunGuard {
        state: state.inner().clone(),
    };
    let token = match jobs.begin(&request_id, 0) {
        Ok(token) => token,
        Err(error) => return Err(error),
    };
    let permit = match scheduler
        .acquire(
            BackgroundTaskKind::StorageScan,
            Uuid::new_v4(),
            BackgroundPriority::User,
            token.clone(),
        )
        .await
    {
        Ok(permit) => permit,
        Err(_) => {
            jobs.finish(&request_id, Err("duplicates.busy".to_string()));
            return Err("duplicates.busy".to_string());
        }
    };
    let state_for_job = state.inner().clone();
    let storage_for_job = storage.inner().clone();
    let scan_for_job = scan_id.clone();
    let request_for_job = request.clone();
    spawn_job(app, request_id, token, move |context| {
        let _run_guard = run_guard;
        let _permit = permit;
        let mut progress = |update: &fs_service::OpProgress| context.set_progress(update);
        let mut store = storage_for_job.open_store()?;
        let cache: &mut dyn DuplicateHashCache = &mut store;
        let mut scan = collect_groups(
            &request_for_job,
            context.token(),
            &mut progress,
            Some(cache),
        )?;
        let _ = store.hash_cache_trim(now_unix());
        let _ = store.trim(now_unix());
        scan.generation = generation;
        if context
            .token()
            .load(std::sync::atomic::Ordering::Relaxed)
        {
            scan.coverage = Coverage::Partial;
        }
        let first_page = page(&scan_for_job, &scan, None);
        state_for_job.insert(scan_for_job, scan)?;
        serde_json::to_value(first_page).map_err(|_| "storage.failed".to_string())
    });
    Ok(())
}

#[tauri::command]
pub fn duplicates_page(
    window: WebviewWindow,
    state: State<'_, Arc<DuplicatesState>>,
    scan_id: String,
    cursor: Option<String>,
) -> Result<DuplicatePage, String> {
    crate::ensure_main(window.label())?;
    Uuid::parse_str(&scan_id).map_err(|_| "storage.invalid".to_string())?;
    if let Some(cursor) = cursor.as_deref() {
        Uuid::parse_str(cursor).map_err(|_| "storage.invalid".to_string())?;
    }
    state.with_scan(&scan_id, |scan| {
        if let Some(cursor) = cursor.as_deref() {
            if !scan.groups.iter().any(|group| group.id == cursor) {
                return Err("storage.invalid".to_string());
            }
        }
        Ok(page(&scan_id, scan, cursor.as_deref()))
    })
}

#[tauri::command]
pub fn duplicates_release(
    window: WebviewWindow,
    state: State<'_, Arc<DuplicatesState>>,
    scan_id: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    Uuid::parse_str(&scan_id).map_err(|_| "storage.invalid".to_string())?;
    state
        .scans
        .lock()
        .map_err(|_| "storage.unavailable".to_string())?
        .remove(&scan_id);
    Ok(())
}

#[tauri::command]
pub fn duplicates_cleanup_prepare(
    window: WebviewWindow,
    state: State<'_, Arc<DuplicatesState>>,
    cleanup: State<'_, Arc<DuplicateCleanupService>>,
    scan_id: String,
    selected: Vec<FileIdentityKey>,
    keepers: Vec<FileIdentityKey>,
) -> Result<::storage_scan::DuplicateCleanupPlan, String> {
    crate::ensure_main(window.label())?;
    Uuid::parse_str(&scan_id).map_err(|_| "storage.invalid".to_string())?;
    state.with_scan(&scan_id, |scan| {
        cleanup.prepare(
            &scan_id,
            scan.generation,
            &scan.groups,
            &selected,
            &keepers,
            now_unix(),
        )
    })
}

#[tauri::command]
pub fn duplicates_cleanup_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    cleanup: State<'_, Arc<DuplicateCleanupService>>,
    request_id: String,
    plan_id: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    Uuid::parse_str(&plan_id).map_err(|_| "storage.invalid".to_string())?;
    if !cleanup.capability() {
        return Err("storage.cleanup_unavailable".to_string());
    }
    let token = jobs.begin(&request_id, 0)?;
    let cleanup_for_job = cleanup.inner().clone();
    spawn_job(app, request_id, token, move |_context| {
        cleanup_for_job.execute(&plan_id, now_unix())?;
        Err("storage.cleanup_unavailable".to_string())
    });
    Ok(())
}
