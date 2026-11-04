//! Native bulk-rename adapter (Step 09e E1/E2): bounded validated plans,
//! exact source stamps, shared jobs, and fail-closed execution.
//!
//! `crates/fs-service/src/rename_handles.rs` (Step 09e T3) does not exist in
//! this tree, so no adapter can hold pinned parents and DELETE-capable
//! mutation handles. Execution therefore refuses with a typed error before
//! the first syscall; a path-only rename fallback is forbidden.

use std::cmp::Ordering;
use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use bulk_rename::collisions::mark_collisions;
use bulk_rename::operations::{requested_metadata, validate_request, TemplateValues};
use bulk_rename::preview::{compute_rows, plan_page, PreviewInput};
use bulk_rename::types::{
    DateZone, RenamePlanPage, RenamePreviewRow, RenameReport, RenameRequest, RenameStatus,
};
use fs_service::{CancellationToken, OpProgress, SourceStamp};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use uuid::Uuid;

use crate::jobs::{spawn_job, Jobs};
use crate::{ensure_main, valid_request_id};

/// How many unexpired plans the native store keeps.
pub const MAX_PLANS: usize = 32;
/// How many page cursors the native store keeps.
pub const MAX_PLAN_CURSORS: usize = 32;
/// How long a preview plan authorizes a later execute request.
pub const PLAN_LIFETIME_SECS: u64 = 300;

/// Why a native rename execution refused to run. No variant mutates a file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RenameExecuteRefusal {
    /// The handle-bound mutation adapter (Step 09e T3) is not in this tree.
    HandleAdapterUnavailable,
}

impl RenameExecuteRefusal {
    /// The documented error code the UI translates (`errors.rename.*`).
    pub const fn code(self) -> &'static str {
        match self {
            Self::HandleAdapterUnavailable => "rename.failed",
        }
    }
}

fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|age| age.as_secs())
        .unwrap_or(0)
}

fn progress(done: usize, total: usize) -> OpProgress {
    OpProgress {
        items_done: done,
        items_total: total,
        bytes_done: 0,
        bytes_total: 0,
        current: String::new(),
    }
}

/// One validated preview plan. The rows carry the exact stamps the native
/// preview derived; execute compares them again before it may run.
#[derive(Clone)]
pub struct StoredPlan {
    pub plan_id: Uuid,
    pub request_revision: u32,
    pub rows: Vec<RenamePreviewRow>,
    pub directories: Vec<bool>,
    pub expires_unix: u64,
}

#[derive(Debug, Clone, Copy)]
struct PlanCursor {
    plan: Uuid,
    offset: usize,
    expires_unix: u64,
}

#[derive(Default)]
struct Inner {
    plans: HashMap<Uuid, StoredPlan>,
    order: VecDeque<Uuid>,
    cursors: HashMap<Uuid, PlanCursor>,
    cursor_order: VecDeque<Uuid>,
}

/// The managed plan/cursor store. Both maps stay bounded and every entry
/// expires after `PLAN_LIFETIME_SECS`; releasing a plan drops its cursors.
#[derive(Default)]
pub struct RenamePlans {
    inner: Mutex<Inner>,
    executing: AtomicBool,
}

impl RenamePlans {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Inner>, String> {
        self.inner.lock().map_err(|_| "rename.failed".to_string())
    }

    /// One rename batch at a time, across every window.
    pub fn begin_execution(&self) -> Result<ExecutionLease<'_>, String> {
        if self
            .executing
            .compare_exchange(false, true, AtomicOrdering::AcqRel, AtomicOrdering::Acquire)
            .is_err()
        {
            return Err("rename.in_use".to_string());
        }
        Ok(ExecutionLease { plans: self })
    }

    /// Store a completed preview and return its first page.
    pub fn store(
        &self,
        request_revision: u32,
        rows: Vec<RenamePreviewRow>,
        directories: Vec<bool>,
    ) -> Result<RenamePlanPage, String> {
        if rows.len() != directories.len() {
            return Err("rename.bad_request".to_string());
        }
        let plan_id = Uuid::new_v4();
        let expires_unix = now_unix().saturating_add(PLAN_LIFETIME_SECS);
        let plan = StoredPlan {
            plan_id,
            request_revision,
            rows,
            directories,
            expires_unix,
        };
        {
            let mut inner = self.lock()?;
            inner.prune(now_unix());
            while inner.plans.len() >= MAX_PLANS {
                if let Some(oldest) = inner.order.pop_front() {
                    inner.plans.remove(&oldest);
                } else {
                    break;
                }
            }
            inner.order.push_back(plan_id);
            inner.plans.insert(plan_id, plan);
            inner.prune(now_unix());
        }
        let page = self.first_page(plan_id);
        if page.is_err() {
            self.release(plan_id);
        }
        page
    }

    fn first_page(&self, plan_id: Uuid) -> Result<RenamePlanPage, String> {
        let plan = self.lock()?.plans.get(&plan_id).cloned();
        let plan = plan.ok_or_else(|| "rename.changed".to_string())?;
        self.page_from(&plan, 0)
    }

    fn page_from(&self, plan: &StoredPlan, offset: usize) -> Result<RenamePlanPage, String> {
        let next = Uuid::new_v4();
        let page = plan_page(
            plan.plan_id,
            plan.request_revision,
            &plan.rows,
            offset,
            plan.expires_unix,
            next,
        )?;
        if page.next_cursor.is_some() {
            let mut inner = self.lock()?;
            inner.prune(now_unix());
            while inner.cursors.len() >= MAX_PLAN_CURSORS {
                if let Some(oldest) = inner.cursor_order.pop_front() {
                    inner.cursors.remove(&oldest);
                } else {
                    break;
                }
            }
            inner.cursor_order.push_back(next);
            inner.cursors.insert(
                next,
                PlanCursor {
                    plan: plan.plan_id,
                    offset: offset + page.rows.len(),
                    expires_unix: plan.expires_unix,
                },
            );
        }
        Ok(page)
    }

    /// The next page of a preview plan.
    pub fn page(&self, cursor: &str) -> Result<RenamePlanPage, String> {
        let cursor_id = Uuid::parse_str(cursor).map_err(|_| "rename.bad_request".to_string())?;
        let (position, plan) = {
            let mut inner = self.lock()?;
            inner.prune(now_unix());
            let position = *inner
                .cursors
                .get(&cursor_id)
                .ok_or_else(|| "rename.bad_request".to_string())?;
            let plan = inner
                .plans
                .get(&position.plan)
                .cloned()
                .ok_or_else(|| "rename.bad_request".to_string())?;
            (position, plan)
        };
        self.page_from(&plan, position.offset)
    }

    /// Idempotent release: an unknown or expired plan changes nothing.
    pub fn release(&self, plan_id: Uuid) {
        if let Ok(mut guard) = self.lock() {
            let inner = &mut *guard;
            inner.plans.remove(&plan_id);
            inner.order.retain(|id| *id != plan_id);
            inner.cursors.retain(|_, cursor| cursor.plan != plan_id);
            let cursors = &inner.cursors;
            inner.cursor_order.retain(|id| cursors.contains_key(id));
        }
    }

    /// The plan bound to the caller's revision, refused when expired, when
    /// the revision moved, or when any row is not executable.
    pub fn plan_for_execute(
        &self,
        plan_id: Uuid,
        request_revision: u32,
    ) -> Result<StoredPlan, String> {
        let mut inner = self.lock()?;
        inner.prune(now_unix());
        let plan = inner
            .plans
            .get(&plan_id)
            .cloned()
            .ok_or_else(|| "rename.changed".to_string())?;
        if plan.request_revision != request_revision {
            return Err("rename.changed".to_string());
        }
        if plan
            .rows
            .iter()
            .any(|row| row.status == RenameStatus::Conflict)
        {
            return Err("rename.conflict".to_string());
        }
        if let Some(row) = plan
            .rows
            .iter()
            .find(|row| row.status == RenameStatus::Invalid)
        {
            return Err(row
                .reason
                .clone()
                .unwrap_or_else(|| "rename.invalid_name".to_string()));
        }
        Ok(plan)
    }
}

/// Held for the lifetime of one execute attempt; drops the batch lock.
pub struct ExecutionLease<'a> {
    plans: &'a RenamePlans,
}

impl Drop for ExecutionLease<'_> {
    fn drop(&mut self) {
        self.plans.executing.store(false, AtomicOrdering::Release);
    }
}

impl Inner {
    fn prune(&mut self, now: u64) {
        self.plans.retain(|_, plan| plan.expires_unix > now);
        let plans = &self.plans;
        self.cursors
            .retain(|_, cursor| cursor.expires_unix > now && plans.contains_key(&cursor.plan));
        let cursors = &self.cursors;
        self.order.retain(|id| plans.contains_key(id));
        self.cursor_order.retain(|id| cursors.contains_key(id));
    }
}

/// The precise stamp of one source: files use the attribute-only reader;
/// folders keep the same stable identity plus their readable time.
fn capture_stamp(path: &Path, is_directory: bool) -> Result<SourceStamp, String> {
    if is_directory {
        let identity =
            fs_service::capture_file_identity(path).map_err(|_| "rename.changed".to_string())?;
        let metadata =
            std::fs::symlink_metadata(path).map_err(|_| "rename.changed".to_string())?;
        let ticks = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|age| {
                116_444_736_000_000_000u64
                    + age.as_secs().saturating_mul(10_000_000)
                    + u64::from(age.subsec_nanos() / 100)
            })
            .unwrap_or(0);
        let stamp = SourceStamp {
            path_key: identity.path_key,
            volume_id: identity.volume_id,
            file_id: identity.file_id,
            modified_ticks: ticks.to_string(),
            size_bytes: 0,
        };
        stamp
            .validate()
            .map_err(|_| "rename.changed".to_string())?;
        Ok(stamp)
    } else {
        fs_service::capture_source_stamp(path).map_err(|_| "rename.changed".to_string())
    }
}

/// A template token value already formatted in the plan's captured zone.
fn unix_date(ticks: &str, zone: DateZone) -> Option<String> {
    let unix = fs_service::filetime_to_unix(ticks.parse().ok()?);
    let date = if zone == DateZone::Local {
        crate::indexed_views::unix_to_local_date(unix)?
    } else {
        crate::indexed_views::civil_from_days((unix / 86_400) as i64)
    };
    Some(format_date(date))
}

fn format_date(date: crate::indexed_views::CivilDate) -> String {
    format!("{:04}-{:02}-{:02}", date.year, date.month, date.day)
}

/// ISO 8601 UTC metadata dates become a bare date in the plan's zone.
fn metadata_date(value: &str, zone: DateZone) -> Option<String> {
    if zone == DateZone::Utc {
        return Some(value.get(..10)?.to_string());
    }
    let unix = u64::try_from(crate::gallery_order::parse_iso_utc_to_unix(value)?).ok()?;
    Some(format_date(crate::indexed_views::unix_to_local_date(unix)?))
}

fn metadata_text(
    field: &crate::metadata_types::MetadataField,
    zone: DateZone,
) -> Option<String> {
    match &field.value {
        crate::metadata_types::MetadataValue::Text { value } => Some(value.clone()),
        crate::metadata_types::MetadataValue::Integer { value } => Some(value.to_string()),
        crate::metadata_types::MetadataValue::Decimal { value } => Some(value.to_string()),
        crate::metadata_types::MetadataValue::Date { value } => metadata_date(value, zone),
        crate::metadata_types::MetadataValue::List { value } => value.first().cloned(),
    }
}

/// Metadata fields are fetched only for placeholders the request names.
/// A failed read leaves the value absent, so the row is `metadata_missing`
/// instead of silently producing a blank name.
fn template_values(
    path: &Path,
    request: &RenameRequest,
    source: &SourceStamp,
    token: &CancellationToken,
) -> TemplateValues {
    let requested = requested_metadata(&request.operations);
    let mut values = TemplateValues {
        date_modified: unix_date(&source.modified_ticks, request.date_zone),
        ..TemplateValues::default()
    };
    if requested.is_empty() {
        return values;
    }
    let Ok(info) = crate::metadata::read_metadata(path, source, token) else {
        return values;
    };
    for field in &info.fields {
        let Some(text) = metadata_text(field, request.date_zone) else {
            continue;
        };
        match field.id {
            crate::metadata_types::MetadataFieldId::DateTaken => values.date_taken = Some(text),
            crate::metadata_types::MetadataFieldId::CameraModel => {
                values.camera_model = Some(text);
            }
            crate::metadata_types::MetadataFieldId::Width => values.width = Some(text),
            crate::metadata_types::MetadataFieldId::Height => values.height = Some(text),
            _ => {}
        }
    }
    values
}

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    /// `CompareStringOrdinal`: 1 = less, 2 = equal, 3 = greater, 0 = error.
    fn CompareStringOrdinal(
        string1: *const u16,
        count1: i32,
        string2: *const u16,
        count2: i32,
        ignore_case: i32,
    ) -> i32;
}

#[cfg(windows)]
fn ordinal_compare(left: &str, right: &str) -> Result<Ordering, String> {
    let left: Vec<u16> = left.encode_utf16().collect();
    let right: Vec<u16> = right.encode_utf16().collect();
    let count1 = i32::try_from(left.len()).map_err(|_| "rename.too_large".to_string())?;
    let count2 = i32::try_from(right.len()).map_err(|_| "rename.too_large".to_string())?;
    // SAFETY: both buffers are valid UTF-16 slices that outlive the call.
    let result = unsafe {
        CompareStringOrdinal(left.as_ptr(), count1, right.as_ptr(), count2, 1)
    };
    match result {
        1 => Ok(Ordering::Less),
        2 => Ok(Ordering::Equal),
        3 => Ok(Ordering::Greater),
        _ => Err("rename.failed".to_string()),
    }
}

/// Windows ordinal ignore-case equality, never a lowercase proof. The
/// filesystem's own comparison decides whether two names collide.
#[cfg(windows)]
fn same_name(left: &str, right: &str) -> Result<bool, String> {
    Ok(ordinal_compare(left, right)? == Ordering::Equal)
}

#[cfg(not(windows))]
fn same_name(left: &str, right: &str) -> Result<bool, String> {
    Ok(left.eq_ignore_ascii_case(right))
}

fn is_ancestor(ancestor: &str, descendant: &str) -> bool {
    let mut prefix = ancestor.to_string();
    if !prefix.ends_with('\\') {
        prefix.push('\\');
    }
    descendant.len() > prefix.len() && descendant.starts_with(&prefix)
}

fn invalidate(row: &mut RenamePreviewRow, code: &str) {
    if row.status != RenameStatus::Excluded {
        row.status = RenameStatus::Invalid;
        row.reason = Some(code.to_string());
    }
}

/// Native assertions `compute_rows` cannot make: protected roots, an
/// ancestor together with its descendant, unreadable parents, and target
/// collisions against the entries that really exist on disk.
fn apply_native_checks(
    rows: &mut [RenamePreviewRow],
    directories: &[bool],
) -> Result<(), String> {
    if rows.len() != directories.len() {
        return Err("rename.bad_request".to_string());
    }
    let mut parent_keys = Vec::with_capacity(rows.len());
    let mut parent_paths: HashMap<String, PathBuf> = HashMap::new();
    for row in rows.iter_mut() {
        if crate::operation_safety::protected_path(Path::new(&row.source_path)) {
            invalidate(row, "rename.bad_request");
        }
        let Some(parent) = Path::new(&row.source_path).parent() else {
            invalidate(row, "rename.bad_request");
            parent_keys.push(String::new());
            continue;
        };
        match fs_service::path_key_of(parent) {
            Ok(key) => {
                parent_paths
                    .entry(key.clone())
                    .or_insert_with(|| parent.to_path_buf());
                parent_keys.push(key);
            }
            Err(_) => {
                invalidate(row, "rename.bad_request");
                parent_keys.push(String::new());
            }
        }
    }
    // An ancestor and a descendant cannot both be renamed in one batch.
    let mut keys = Vec::with_capacity(rows.len());
    for row in rows.iter() {
        let key = if row.status == RenameStatus::Ready {
            fs_service::path_key_of(Path::new(&row.source_path)).ok()
        } else {
            None
        };
        keys.push(key);
    }
    let ready: Vec<(usize, &str)> = keys
        .iter()
        .enumerate()
        .filter_map(|(index, key)| key.as_deref().map(|key| (index, key)))
        .collect();
    let mut nested = Vec::new();
    for (position, (left, left_key)) in ready.iter().enumerate() {
        for (right, right_key) in &ready[position + 1..] {
            if is_ancestor(left_key, right_key) || is_ancestor(right_key, left_key) {
                nested.push((*left, *right));
            }
        }
    }
    for (left, right) in nested {
        rows[left].status = RenameStatus::Invalid;
        rows[left].reason = Some("rename.bad_request".to_string());
        rows[right].status = RenameStatus::Invalid;
        rows[right].reason = Some("rename.bad_request".to_string());
    }
    // Existing names that could collide with a proposed target. The fold is
    // only a pre-filter; `same_name` below is the authority.
    let mut targets: HashMap<String, HashMap<String, Vec<String>>> = HashMap::new();
    for key in parent_paths.keys() {
        targets.insert(key.clone(), HashMap::new());
    }
    for (index, row) in rows.iter().enumerate() {
        if !matches!(
            row.status,
            RenameStatus::Ready | RenameStatus::Unchanged | RenameStatus::Conflict
        ) {
            continue;
        }
        let Some(bucket) = targets.get_mut(&parent_keys[index]) else {
            continue;
        };
        bucket
            .entry(row.new_name.to_uppercase())
            .or_default()
            .push(row.new_name.clone());
    }
    let mut existing = Vec::new();
    for (key, folder) in &parent_paths {
        let Some(bucket) = targets.get(key) else {
            continue;
        };
        if bucket.is_empty() {
            continue;
        }
        let entries = match std::fs::read_dir(folder) {
            Ok(entries) => entries,
            Err(_) => {
                for (index, row) in rows.iter_mut().enumerate() {
                    if parent_keys[index] == *key {
                        invalidate(row, "rename.bad_request");
                    }
                }
                continue;
            }
        };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            let Some(candidates) = bucket.get(&name.to_uppercase()) else {
                continue;
            };
            for target in candidates {
                if same_name(&name, target)? {
                    existing.push((key.clone(), name.clone()));
                    break;
                }
            }
        }
    }
    mark_collisions(rows, &parent_keys, &existing, same_name)
}

/// The still-current stamps must equal the stamps captured by preview.
/// Only rows that would mutate are reopened here.
fn verify_plan_sources(plan: &StoredPlan) -> Result<(), String> {
    for (row, is_directory) in plan.rows.iter().zip(&plan.directories) {
        if row.status != RenameStatus::Ready {
            continue;
        }
        let current = capture_stamp(Path::new(&row.source_path), *is_directory)?;
        if current != row.source {
            return Err("rename.changed".to_string());
        }
    }
    Ok(())
}

/// Step 09e preview: validate first, run in the shared job table, store the
/// plan under a fresh UUID and return its first bounded page.
#[tauri::command]
pub async fn rename_preview_start(
    window: WebviewWindow,
    app: AppHandle,
    request_id: String,
    request: RenameRequest,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    validate_request(&request)?;
    let total = request.paths.len();
    let token = app.state::<Jobs>().begin(&request_id, total)?;
    spawn_job(app.clone(), request_id, token, move |context| {
        let plans = context.app().state::<RenamePlans>();
        let mut inputs = Vec::with_capacity(total);
        let mut directories = Vec::with_capacity(total);
        for (index, path) in request.paths.iter().enumerate() {
            if context.token().load(AtomicOrdering::Relaxed) {
                return Err("rename.cancelled".to_string());
            }
            let native = Path::new(path);
            let metadata =
                std::fs::symlink_metadata(native).map_err(|_| "rename.changed".to_string())?;
            if metadata.file_type().is_symlink() {
                return Err("rename.changed".to_string());
            }
            let is_directory = metadata.is_dir();
            let source = capture_stamp(native, is_directory)?;
            let old_name = native
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| "rename.bad_request".to_string())?
                .to_string();
            let templates = template_values(native, &request, &source, context.token());
            inputs.push(PreviewInput {
                source,
                old_name,
                is_directory,
                templates,
            });
            directories.push(is_directory);
            context.set_progress(&progress(index + 1, total));
        }
        let mut rows = compute_rows(&request, &inputs, || {
            context.token().load(AtomicOrdering::Relaxed)
        })?;
        apply_native_checks(&mut rows, &directories)?;
        if context.token().load(AtomicOrdering::Relaxed) {
            return Err("rename.cancelled".to_string());
        }
        let page = plans.store(request.request_revision, rows, directories)?;
        serde_json::to_value(page).map_err(|_| "rename.failed".to_string())    });
    Ok(())
}

/// The next bounded page of a stored preview plan.
#[tauri::command]
pub fn rename_preview_page(
    window: WebviewWindow,
    plans: State<'_, RenamePlans>,
    cursor: String,
) -> Result<RenamePlanPage, String> {
    ensure_main(window.label())?;
    Uuid::parse_str(&cursor).map_err(|_| "rename.bad_request".to_string())?;
    plans.page(&cursor)
}

/// Step 09e execute: revalidate the plan and its exact stamps, then refuse.
/// No path-only rename exists while the handle adapter (T3) is absent.
#[tauri::command]
pub async fn rename_execute_start(
    window: WebviewWindow,
    app: AppHandle,
    request_id: String,
    plan_id: String,
    request_revision: u32,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    let plan_id = Uuid::parse_str(&plan_id).map_err(|_| "rename.bad_request".to_string())?;
    let token = app.state::<Jobs>().begin(&request_id, 1)?;
    spawn_job(app.clone(), request_id, token, move |context| {
        let plans = context.app().state::<RenamePlans>();
        let _lease = plans.begin_execution()?;
        if context.token().load(AtomicOrdering::Relaxed) {
            return Err("rename.cancelled".to_string());
        }
        let plan = plans.plan_for_execute(plan_id, request_revision)?;
        verify_plan_sources(&plan)?;
        Err(RenameExecuteRefusal::HandleAdapterUnavailable
            .code()
            .to_string())
    });
    Ok(())
}

/// Reports exist only after a completed native execution. Until the handle
/// adapter exists no report can be produced, so an unknown cursor is a bad
/// request; a fabricated all-failed report would become false history.
#[tauri::command]
pub fn rename_report_page(
    window: WebviewWindow,
    cursor: String,
) -> Result<RenameReport, String> {
    ensure_main(window.label())?;
    Uuid::parse_str(&cursor).map_err(|_| "rename.bad_request".to_string())?;
    Err("rename.bad_request".to_string())
}

/// Release a plan and its cursors. Idempotent.
#[tauri::command]
pub fn rename_plan_release(
    window: WebviewWindow,
    plans: State<'_, RenamePlans>,
    plan_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    let plan_id = Uuid::parse_str(&plan_id).map_err(|_| "rename.bad_request".to_string())?;
    plans.release(plan_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ready_row() -> RenamePreviewRow {
        RenamePreviewRow {
            input_index: 0,
            source_path: r"C:\fixture\a.txt".to_string(),
            source: SourceStamp {
                path_key: r"c:\fixture\a.txt".to_string(),
                volume_id: "00000001".to_string(),
                file_id: "0000000000000001".to_string(),
                modified_ticks: "133000000000000001".to_string(),
                size_bytes: 1,
            },
            old_name: "a.txt".to_string(),
            new_name: "b.txt".to_string(),
            status: RenameStatus::Ready,
            reason: None,
        }
    }

    #[test]
    fn plan_revision_mismatch_is_refused() {
        let plans = RenamePlans::default();
        let page = plans
            .store(4, vec![ready_row()], vec![false])
            .expect("plan stores");
        assert_eq!(
            plans.plan_for_execute(page.plan_id, 5).err().as_deref(),
            Some("rename.changed")
        );
        assert!(plans.plan_for_execute(page.plan_id, 4).is_ok());
        plans.release(page.plan_id);
        assert_eq!(
            plans.plan_for_execute(page.plan_id, 4).err().as_deref(),
            Some("rename.changed")
        );
    }

    #[test]
    fn expired_plan_is_refused() {
        let plans = RenamePlans::default();
        let plan_id = Uuid::new_v4();
        plans.lock().unwrap().plans.insert(
            plan_id,
            StoredPlan {
                plan_id,
                request_revision: 1,
                rows: vec![ready_row()],
                directories: vec![false],
                expires_unix: 0,
            },
        );
        assert_eq!(
            plans.plan_for_execute(plan_id, 1).err().as_deref(),
            Some("rename.changed")
        );
    }

    #[cfg(windows)]
    #[test]
    fn ordinal_comparison_ignores_case_only() {
        assert!(same_name("Report.TXT", "report.txt").unwrap());
        assert!(!same_name("a.txt", "b.txt").unwrap());
    }
}
