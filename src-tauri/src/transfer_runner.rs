//! Runs one admitted transfer (Step 09f T2-T5 wiring).
//!
//! The coordinator decides *whether* a job may run; this module does the
//! work and reports back through the job's `JobRuntime`. Every disk call is
//! the fs-service engine: metadata-only enumeration, chunked copy through the
//! pause gate, read-back verification, no-replace publication, and the
//! verified source removal of a cross-volume move.
//!
//! The job's result is always its first report page — even when items failed
//! — so an unpolled report is never dropped and the window can show the exact
//! partial result.
#![allow(dead_code)]


use std::path::{Path, PathBuf};
use std::sync::Arc;

use fs_service::conflict_policy::{ApplyAll, ApplyScope, ConflictChoice, ConflictKind};
use fs_service::transfer_conflicts::{
    is_taken, merge_child_action, next_keep_both_name, EntryKind, MergeChild,
};
use fs_service::transfer_copy::{
    copy_file, ensure_destination_dir, entry_stamp, enumerate_source, target_of, CopyError,
    EnumeratedEntry, EnumeratedSource, EnumerationBudget, FileCopyRequest,
};
use fs_service::transfer_decisions::{
    allowed_actions, DecisionAction, DecisionTicket, PendingKind, RetryCounter,
};
use fs_service::transfer_move::{
    mode_for, remove_emptied_dir, remove_source_after_copy, rename_exact, snapshot_source, MoveMode,
};
use fs_service::owned_io::{PinnedDirectory, PinnedSource, SourceIdentity};
use fs_service::transfer_rates::TransferCounters;
use fs_service::{
    CompletedItem, ConflictPolicy, OpProgress, OpReport, SkippedItem, SourceStamp, TransferEffect,
    TransferKind as EffectKind,
};
use tauri::AppHandle;
use uuid::Uuid;

use crate::jobs::{self, JobContext};
use crate::transfer_control::{Answer, JobRuntime, Question, TransferCoordinator};
use crate::transfer_job_types::{
    ResolvedRequest, TransferDecisionRequest, TransferItemResult, TransferItemStatus, TransferKind,
    TransferPhase,
};

/// Start every job the coordinator has just admitted.
pub fn spawn_ready(app: &AppHandle, coordinator: &Arc<TransferCoordinator>) {
    for promoted in coordinator.take_runnable() {
        let Some(token) = promoted.runtime.token() else {
            // The transport entry never appeared: finish the job instead of
            // leaving its volume slot held by a worker that cannot run.
            promoted.runtime.finish();
            coordinator.release(&promoted.job_id);
            continue;
        };
        let worker_app = app.clone();
        let next_app = app.clone();
        let coordinator = Arc::clone(coordinator);
        let runtime = Arc::clone(&promoted.runtime);
        let request = promoted.request;
        let emit_app = app.clone();
        jobs::spawn_job(worker_app, promoted.job_id, token.clone(), move |context| {
            let page = run(context, &runtime, request, &token, &coordinator, &emit_app);
            // A finished slot may let the next queued job start.
            spawn_ready(&next_app, &coordinator);
            Ok(page)
        });
    }
}

/// Execute one job and hand back its first report page.
fn run(
    context: &JobContext,
    runtime: &Arc<JobRuntime>,
    request: ResolvedRequest,
    token: &fs_service::CancellationToken,
    coordinator: &Arc<TransferCoordinator>,
    app: &AppHandle,
) -> serde_json::Value {
    runtime.set_phase(TransferPhase::Running);
    let effects = execute(context, runtime, &request, token);
    emit_identity_effects(app, runtime, &request, &effects);
    if let Some(history) = coordinator.history() {
        match history
            .lock()
            .map_err(|_| "ops.io".to_string())
            .and_then(|mut history| history.finish(&runtime.job_id, effects))
        {
            Ok(Some(transfer_id)) => runtime.set_transfer_id(Some(transfer_id)),
            Ok(None) => {}
            Err(code) => {
                // The files changed but Undo cannot hold them: say so in the
                // report instead of promising an Undo that cannot run.
                runtime.push_item(item_result(
                    Uuid::new_v4(),
                    Path::new(""),
                    None,
                    TransferItemStatus::Failed,
                    Some(code.as_str()),
                    0,
                    false,
                    false,
                    false,
                ));
            }
        }
    }
    runtime.finish();
    coordinator.release(&runtime.job_id);
    let page = coordinator
        .first_page_of(&runtime.job_id)
        .unwrap_or_else(|_| runtime.report_from(0));
    serde_json::to_value(page).unwrap_or(serde_json::Value::Null)
}

/// A stable operation id for one job, so a repeated emit is recognisable.
fn operation_of(job_id: &str) -> Uuid {
    let hash = blake3::hash(job_id.as_bytes());
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&hash.as_bytes()[..16]);
    Uuid::from_bytes(bytes)
}

/// Tell identity subscribers about every item that really completed.
fn emit_identity_effects(
    app: &AppHandle,
    runtime: &Arc<JobRuntime>,
    request: &ResolvedRequest,
    effects: &[TransferEffect],
) {
    let kind = match request.kind {
        TransferKind::Move => "move",
        TransferKind::Copy => "copy",
    };
    let operation = operation_of(&runtime.job_id);
    let mut receipts = Vec::new();
    for (index, effect) in effects.iter().enumerate() {
        if effect.kind == EffectKind::Directory {
            continue;
        }
        let (Some(before), Some(after)) = (&effect.before_source, &effect.after_destination) else {
            continue;
        };
        if let Some(receipt) =
            crate::identity_effects::new_effect(operation, index as u64, kind, before, after)
        {
            receipts.push(receipt);
        }
    }
    if !receipts.is_empty() {
        crate::identity_effects::emit(app, &receipts);
    }
}

fn publish_progress(runtime: &JobRuntime, counters: &TransferCounters, current: &str) {
    let progress = OpProgress {
        items_done: counters.items_done() as usize,
        items_total: counters.items_total() as usize,
        bytes_done: counters.bytes_done(),
        bytes_total: counters.bytes_total(),
        current: current.to_string(),
    };
    runtime.set_progress(&progress, counters.remaining_bytes());
}

#[allow(clippy::too_many_arguments)]
fn item_result(
    id: Uuid,
    from: &Path,
    to: Option<&Path>,
    status: TransferItemStatus,
    reason: Option<&str>,
    bytes: u64,
    verified: bool,
    source_removed: bool,
    destination_created: bool,
) -> TransferItemResult {
    TransferItemResult {
        item_id: id.to_string(),
        from: from.to_string_lossy().into_owned(),
        to: to.map(|path| path.to_string_lossy().into_owned()),
        status,
        reason: reason.map(str::to_string),
        bytes_written: bytes,
        verified,
        source_removed,
        destination_created,
    }
}

fn execute(
    context: &JobContext,
    runtime: &Arc<JobRuntime>,
    request: &ResolvedRequest,
    token: &fs_service::CancellationToken,
) -> Vec<TransferEffect> {
    let mut effects = Vec::new();
    let mut budget = EnumerationBudget::default();
    // "Do this for the remaining conflicts of this kind" never crosses the
    // job or the conflict kind (guide 09f item 6).
    let mut apply_all = ApplyAll::default();
    let mut plans: Vec<EnumeratedSource> = Vec::new();
    // The same metadata-only preflight the legacy operations use: a move of
    // system files needs the request's explicit `allow_system`, and nothing
    // is enumerated or staged when it is missing.
    let policy = match request.conflict {
        ConflictChoice::Skip => ConflictPolicy::Skip,
        ConflictChoice::KeepBoth => ConflictPolicy::KeepBoth,
        ConflictChoice::Merge => ConflictPolicy::Merge,
    };
    let mut quiet = |_progress: &OpProgress| {};
    let preflight = crate::operation_safety::check(
        request.kind.as_code(),
        &request.sources,
        Some(request.dest_dir.as_path()),
        policy,
        request.allow_system,
        token,
        &mut quiet,
    );
    let sources: Vec<(PathBuf, Option<SourceStamp>)> = match preflight {
        Err(code) => {
            for path in &request.sources {
                runtime.push_item(item_result(
                    Uuid::new_v4(),
                    path,
                    None,
                    TransferItemStatus::Failed,
                    Some(code.as_str()),
                    0,
                    false,
                    false,
                    false,
                ));
            }
            return effects;
        }
        Ok(outcome) => {
            if outcome.cancelled {
                runtime.mark_cancelled();
                return effects;
            }
            for skipped in outcome.skipped {
                runtime.push_item(item_result(
                    Uuid::new_v4(),
                    &skipped.path,
                    None,
                    TransferItemStatus::Skipped,
                    Some(skipped.reason.as_str()),
                    0,
                    false,
                    false,
                    false,
                ));
            }
            outcome
                .sources
                .into_iter()
                .map(|path| {
                    // Keep the reviewed stamp of this exact source even when
                    // the preflight dropped an earlier one.
                    let index = request.sources.iter().position(|named| *named == path);
                    let expected = index.and_then(|index| {
                        request
                            .expected
                            .as_ref()
                            .and_then(|list| list.get(index))
                            .cloned()
                    });
                    (path, expected)
                })
                .collect()
        }
    };
    for (path, expected) in &sources {
        // A reviewed source is an exact object, not a path: when the file at
        // that path is no longer the stamp the user approved, nothing is
        // copied and the item is reported (`ops.source_changed`).
        if let Some(expected) = expected {
            if !entry_stamp(path).is_ok_and(|current| current == *expected) {
                runtime.push_item(item_result(
                    Uuid::new_v4(),
                    path,
                    None,
                    TransferItemStatus::Failed,
                    Some("ops.source_changed"),
                    0,
                    false,
                    false,
                    false,
                ));
                continue;
            }
        }
        match enumerate_source(path, &mut budget) {
            Ok(plan) => plans.push(plan),
            Err(error) => runtime.push_item(item_result(
                Uuid::new_v4(),
                path,
                None,
                TransferItemStatus::Failed,
                Some(error.code()),
                0,
                false,
                false,
                false,
            )),
        }
    }
    if plans.is_empty() {
        return effects;
    }
    let online: Vec<PathBuf> = plans
        .iter()
        .flat_map(|plan| plan.online_only.clone())
        .collect();
    let mut allow_hydration = false;
    if !online.is_empty() {
        match ask_cloud(runtime, &online) {
            Some(Answer {
                action: DecisionAction::Retry,
                ..
            }) => allow_hydration = true,
            Some(Answer {
                action: DecisionAction::Cancel,
                ..
            }) => {
                runtime.cancel_from_outside();
                runtime.mark_cancelled();
                return effects;
            }
            _ => {}
        }
    }
    let items_total: u64 = plans.iter().map(|plan| plan.entries.len() as u64).sum();
    let bytes_total: u64 = plans.iter().map(|plan| plan.total_bytes).sum();
    let mut counters = TransferCounters::new(items_total, bytes_total);
    let directory = match PinnedDirectory::open(&request.dest_dir) {
        Ok(directory) => directory,
        Err(_) => {
            runtime.push_item(item_result(
                Uuid::new_v4(),
                &request.dest_dir,
                None,
                TransferItemStatus::Failed,
                Some("ops.not_found"),
                0,
                false,
                false,
                false,
            ));
            return effects;
        }
    };
    for plan in &plans {
        if runtime.gate.is_cancelled() {
            break;
        }
        let top_is_online = plan.entries.first().is_some_and(|entry| entry.online_only);
        if top_is_online && !allow_hydration {
            counters.finish_item().ok();
            runtime.push_item(item_result(
                Uuid::new_v4(),
                &plan.root,
                None,
                TransferItemStatus::Skipped,
                Some("ops.cloud_placeholder"),
                0,
                false,
                false,
                false,
            ));
            continue;
        }
        copy_source(
            context,
            runtime,
            request,
            plan,
            &directory,
            &mut counters,
            &mut apply_all,
            token,
            &mut effects,
        );
    }
    publish_progress(runtime, &counters, "");
    if runtime.gate.is_cancelled() {
        runtime.mark_cancelled();
    }
    effects
}

/// Ask once before downloading cloud placeholders.
fn ask_cloud(runtime: &Arc<JobRuntime>, online: &[PathBuf]) -> Option<Answer> {
    let source = online.first()?;
    let stamp = entry_stamp(source).ok()?;
    let decision_id = Uuid::new_v4();
    runtime.ask(Question {
        request: TransferDecisionRequest {
            decision_id: decision_id.to_string(),
            item_id: Uuid::new_v4().to_string(),
            kind: "error".to_string(),
            source_path: source.to_string_lossy().into_owned(),
            target_path: None,
            source: Some(stamp.clone()),
            target: None,
            source_kind: Some(EntryKind::File.as_code().to_string()),
            target_kind: None,
            error_code: Some("ops.cloud_placeholder".to_string()),
            attempt: 0,
            allowed: vec!["retry".to_string(), "skip".to_string(), "cancel".to_string()],
            replace_available: false,
        },
        ticket: DecisionTicket {
            decision_id,
            item_id: Uuid::new_v4(),
            generation: runtime.generation(),
            source: stamp,
            target: None,
        },
        kind: PendingKind::Error,
        merge_allowed: false,
        retries: RetryCounter::default(),
    })
}

#[allow(clippy::too_many_arguments)]
fn copy_source(
    context: &JobContext,
    runtime: &Arc<JobRuntime>,
    request: &ResolvedRequest,
    plan: &EnumeratedSource,
    directory: &PinnedDirectory,
    counters: &mut TransferCounters,
    apply_all: &mut ApplyAll,
    token: &fs_service::CancellationToken,
    effects: &mut Vec<TransferEffect>,
) {
    let item_id = Uuid::new_v4();
    runtime.set_current_item(Some(item_id.to_string()));
    publish_progress(runtime, counters, &plan.root.to_string_lossy());
    let target = directory.path().join(&plan.name);
    let taken = is_taken(&target);
    let source_is_folder = plan.entries.first().is_some_and(|entry| entry.is_dir);
    let target_is_folder = target.symlink_metadata().is_ok_and(|metadata| metadata.is_dir());
    let mut choice = request.conflict;
    if taken {
        let scope = ApplyScope {
            job_generation: 0,
            conflict_kind: ConflictKind::Name,
        };
        if let Some(remembered) = apply_all.for_scope(scope) {
            // The remembered answer still faces a freshly probed destination:
            // a name that appeared in the meantime keeps its bytes.
            choice = remembered;
            if remembered == ConflictChoice::Skip {
                counters.finish_item().ok();
                runtime.push_item(item_result(
                    item_id,
                    &plan.root,
                    None,
                    TransferItemStatus::Skipped,
                    Some("ops.exists"),
                    0,
                    false,
                    false,
                    false,
                ));
                return;
            }
        } else {
            match decide_name(runtime, plan, &target, source_is_folder, target_is_folder) {
                Some(answer) => {
                    let chosen = match answer.action {
                        DecisionAction::KeepBoth => Some(ConflictChoice::KeepBoth),
                        DecisionAction::Merge => Some(ConflictChoice::Merge),
                        DecisionAction::Skip => Some(ConflictChoice::Skip),
                        _ => None,
                    };
                    if answer.apply_to_all {
                        if let Some(chosen) = chosen {
                            apply_all.remember(scope, chosen);
                        }
                    }
                    match answer.action {
                        DecisionAction::KeepBoth => choice = ConflictChoice::KeepBoth,
                        DecisionAction::Merge => choice = ConflictChoice::Merge,
                        DecisionAction::Skip => {
                            counters.finish_item().ok();
                            runtime.push_item(item_result(
                                item_id,
                                &plan.root,
                                None,
                                TransferItemStatus::Skipped,
                                Some("ops.exists"),
                                0,
                                false,
                                false,
                                false,
                            ));
                            return;
                        }
                        DecisionAction::Cancel => {
                            // Cancel stops the whole job, like the button in
                            // the transfer window; completed items stay.
                            runtime.cancel_from_outside();
                            return;
                        }
                        _ => return,
                    }
                }
                None => {
                    // No answer (cancel) or an object that could not be
                    // stamped: keep what is already there and report the item
                    // instead of leaving it silently absent from the report.
                    counters.finish_item().ok();
                    runtime.push_item(item_result(
                        item_id,
                        &plan.root,
                        None,
                        TransferItemStatus::Skipped,
                        Some("ops.exists"),
                        0,
                        false,
                        false,
                        false,
                    ));
                    return;
                }
            }
        }
    }
    // Same-volume move: one no-replace rename of the exact object.
    if request.kind == TransferKind::Move && !taken {
        let identity = plan.entries.first().and_then(|entry| entry.identity);
        if let Some(identity) = identity {
            if mode_for(&plan.root, directory.path()) == MoveMode::Rename {
                let before = entry_stamp(&plan.root).ok();
                match rename_exact(&plan.root, identity.volume, identity.index, directory, &plan.name)
                {
                    Ok(landed) => {
                        effects.push(effect(
                            &plan.root,
                            &landed,
                            if plan.entries.len() > 1 {
                                EffectKind::Tree
                            } else {
                                EffectKind::File
                            },
                            true,
                            true,
                            before,
                            entry_stamp(&landed).ok(),
                            None,
                        ));
                        counters.finish_item().ok();
                        runtime.push_item(item_result(
                            item_id,
                            &plan.root,
                            Some(landed.as_path()),
                            TransferItemStatus::Done,
                            None,
                            0,
                            false,
                            true,
                            true,
                        ));
                        return;
                    }
                    Err(error) if !error.is_retryable() => {
                        counters.finish_item().ok();
                        runtime.push_item(item_result(
                            item_id,
                            &plan.root,
                            None,
                            TransferItemStatus::Failed,
                            Some(error.code()),
                            0,
                            false,
                            false,
                            false,
                        ));
                        return;
                    }
                    // A retryable rename failure falls through to the copy
                    // path, which reports the real reason per file.
                    Err(_) => {}
                }
            }
        }
    }
    let mut written = 0u64;
    let mut all_verified = request.verify;
    let mut created = false;
    let mut reason: Option<&'static str> = None;
    // The exact object each finished copy really landed on. A "keep both"
    // name is not known before publication, and a move must remove only the
    // source whose bytes were published under exactly that name.
    let mut landed_files: Vec<(PathBuf, PathBuf)> = Vec::new();
    for entry in &plan.entries {
        if runtime.gate.is_cancelled() {
            return;
        }
        let destination = target_of(directory.path(), &plan.name, &entry.rel);
        if entry.is_dir {
            let existed = destination.symlink_metadata().is_ok();
            match ensure_destination_dir(&destination) {
                Ok(()) => {
                    effects.push(effect(
                        &entry.from,
                        &destination,
                        EffectKind::Directory,
                        false,
                        !existed,
                        None,
                        entry_stamp(&destination).ok(),
                        None,
                    ));
                    created |= !existed;
                }
                Err(error) => {
                    reason = Some(error.code());
                    break;
                }
            }
            continue;
        }
        let target_path = if is_taken(&destination) {
            match choice {
                ConflictChoice::KeepBoth => {
                    match next_keep_both_name(directory.path(), &entry_name(&destination), 1) {
                        Ok(name) => destination.with_file_name(name),
                        Err(error) => {
                            reason = Some(error.code());
                            break;
                        }
                    }
                }
                ConflictChoice::Merge => {
                    match merge_child_action(true, false, target_is_folder) {
                        MergeChild::SkipSameNamed | MergeChild::SkipKindMismatch => {
                            counters.skip_remaining(entry.size).ok();
                            continue;
                        }
                        MergeChild::Copy | MergeChild::RecurseFolder => destination,
                    }
                }
                ConflictChoice::Skip => {
                    counters.skip_remaining(entry.size).ok();
                    continue;
                }
            }
        } else {
            destination
        };
        match copy_one(
            context, runtime, entry, &target_path, directory, request, counters, token,
        ) {
            Ok((bytes, hash, landed)) => {
                written = written.saturating_add(bytes);
                all_verified &= hash.is_some();
                created = true;
                landed_files.push((entry.from.clone(), landed.clone()));
                effects.push(effect(
                    &entry.from,
                    &landed,
                    EffectKind::File,
                    false,
                    true,
                    entry_stamp(&entry.from).ok(),
                    entry_stamp(&landed).ok(),
                    hash,
                ));
            }
            Err(CopyError::Skipped) => {
                counters.skip_remaining(entry.size).ok();
                continue;
            }
            Err(error) => {
                reason = Some(error.code());
                break;
            }
        }
    }
    let moving = request.kind == TransferKind::Move;
    let mut all_sources_removed = true;
    if moving && reason.is_none() {
        all_sources_removed = remove_sources(runtime, plan, &landed_files, effects, token);
    }
    counters.finish_item().ok();
    runtime.push_item(item_result(
        item_id,
        &plan.root,
        Some(target.as_path()),
        if reason.is_some() {
            TransferItemStatus::Failed
        } else {
            TransferItemStatus::Done
        },
        reason,
        written,
        all_verified,
        moving && all_sources_removed,
        created,
    ));
}

fn entry_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// Ask which conflict choice to use for this top-level item.
fn decide_name(
    runtime: &Arc<JobRuntime>,
    plan: &EnumeratedSource,
    target: &Path,
    source_is_folder: bool,
    target_is_folder: bool,
) -> Option<Answer> {
    let source_stamp = entry_stamp(&plan.root).ok()?;
    let target_stamp = entry_stamp(target).ok()?;
    let merge_allowed = source_is_folder && target_is_folder;
    let decision_id = Uuid::new_v4();
    let item_id = Uuid::new_v4();
    runtime.ask(Question {
        request: TransferDecisionRequest {
            decision_id: decision_id.to_string(),
            item_id: item_id.to_string(),
            kind: "conflict".to_string(),
            source_path: plan.root.to_string_lossy().into_owned(),
            target_path: Some(target.to_string_lossy().into_owned()),
            source: Some(source_stamp.clone()),
            target: Some(target_stamp.clone()),
            source_kind: Some(
                if source_is_folder {
                    EntryKind::Folder
                } else {
                    EntryKind::File
                }
                .as_code()
                .to_string(),
            ),
            target_kind: Some(
                if target_is_folder {
                    EntryKind::Folder
                } else {
                    EntryKind::File
                }
                .as_code()
                .to_string(),
            ),
            error_code: None,
            attempt: 0,
            allowed: allowed_actions(PendingKind::Name, merge_allowed, 0)
                .iter()
                .map(|action| action.as_code().to_string())
                .collect(),
            replace_available: false,
        },
        ticket: DecisionTicket {
            decision_id,
            item_id,
            generation: runtime.generation(),
            source: source_stamp,
            target: Some(target_stamp),
        },
        kind: PendingKind::Name,
        merge_allowed,
        retries: RetryCounter::default(),
    })
}

/// Copy one file, asking Retry / Skip / Cancel when it cannot be read.
#[allow(clippy::too_many_arguments)]
fn copy_one(
    context: &JobContext,
    runtime: &Arc<JobRuntime>,
    entry: &EnumeratedEntry,
    destination: &Path,
    directory: &PinnedDirectory,
    request: &ResolvedRequest,
    counters: &mut TransferCounters,
    token: &fs_service::CancellationToken,
) -> Result<(u64, Option<String>, PathBuf), CopyError> {
    let mut retries = RetryCounter::default();
    loop {
        let captured = SourceIdentity::capture(&entry.from).map_err(CopyError::from)?;
        let mut pinned = PinnedSource::open(&entry.from, &captured).map_err(CopyError::from)?;
        let mut rates = runtime.rates();
        let mut on_chunk = |_bytes: u64| {};
        let result = copy_file(
            FileCopyRequest {
                source: &mut pinned,
                directory,
                hint: &entry_name(&entry.from),
                verify: request.verify,
                token,
                gate: &runtime.gate,
                on_chunk: &mut on_chunk,
            },
            counters,
            &mut rates,
        );
        drop(rates);
        match result {
            Ok(mut staged) => {
                let bytes = staged.bytes_written;
                let verified = staged.verified.map(|hash| hash.to_hex());
                let landed = publish(&mut staged, destination)?;
                return Ok((bytes, verified, landed));
            }
            // A different object at the path is not the file the user
            // approved: it needs a fresh review, never a silent retry.
            Err(CopyError::SourceChanged) => return Err(CopyError::SourceChanged),
            Err(error) if error.is_retryable() => {
                let _ = context;
                let Some(answer) = ask_retry(runtime, entry, error, retries) else {
                    return Err(CopyError::Cancelled);
                };
                match answer.action {
                    DecisionAction::Retry => {
                        retries.retry().map_err(|_| CopyError::Io)?;
                        continue;
                    }
                    DecisionAction::Skip => return Err(CopyError::Skipped),
                    DecisionAction::Cancel => {
                        runtime.cancel_from_outside();
                        return Err(CopyError::Cancelled);
                    }
                    _ => return Err(CopyError::Cancelled),
                }
            }
            Err(error) => return Err(error),
        }
    }
}

/// Publish under `destination`'s name; a name that appeared meanwhile gets
/// the next numbered name instead of replacing the winner.
fn publish(
    staged: &mut fs_service::transfer_copy::StagedFile,
    destination: &Path,
) -> Result<PathBuf, CopyError> {
    let parent = destination.parent().unwrap_or(destination);
    let name = entry_name(destination);
    let mut number = 0;
    for _ in 0..4 {
        let candidate = if number == 0 {
            name.clone()
        } else {
            next_keep_both_name(parent, &name, number).map_err(|_| CopyError::TargetExists)?
        };
        match staged.publish(&candidate) {
            Ok(path) => return Ok(path),
            Err(CopyError::TargetExists) => number += 1,
            Err(error) => return Err(error),
        }
    }
    Err(CopyError::TargetExists)
}

fn ask_retry(
    runtime: &Arc<JobRuntime>,
    entry: &EnumeratedEntry,
    error: CopyError,
    retries: RetryCounter,
) -> Option<Answer> {
    let stamp = entry_stamp(&entry.from).ok()?;
    let decision_id = Uuid::new_v4();
    let item_id = Uuid::new_v4();
    runtime.ask(Question {
        request: TransferDecisionRequest {
            decision_id: decision_id.to_string(),
            item_id: item_id.to_string(),
            kind: "error".to_string(),
            source_path: entry.from.to_string_lossy().into_owned(),
            target_path: None,
            source: Some(stamp.clone()),
            target: None,
            source_kind: Some(EntryKind::File.as_code().to_string()),
            target_kind: None,
            error_code: Some(error.code().to_string()),
            attempt: retries.used(),
            allowed: allowed_actions(PendingKind::Error, false, retries.used())
                .iter()
                .map(|action| action.as_code().to_string())
                .collect(),
            replace_available: false,
        },
        ticket: DecisionTicket {
            decision_id,
            item_id,
            generation: runtime.generation(),
            source: stamp,
            target: None,
        },
        kind: PendingKind::Error,
        merge_allowed: false,
        retries,
    })
}

/// Remove the source files of a cross-volume move, each only after the copy
/// of that exact object is complete, verified and published under the name
/// recorded in its effect. A source that changed, is in use or differs from
/// the published copy stays where it is.
///
/// Returns `true` only when every copied file's source was removed; effects
/// whose removal really happened carry `source_removed: true`, so a later
/// Undo is bound to an object that actually moved.
fn remove_sources(
    runtime: &Arc<JobRuntime>,
    plan: &EnumeratedSource,
    landed_files: &[(PathBuf, PathBuf)],
    effects: &mut [TransferEffect],
    token: &fs_service::CancellationToken,
) -> bool {
    let mut all_removed = true;
    for (from, landed) in landed_files {
        if runtime.gate.is_cancelled() {
            all_removed = false;
            break;
        }
        let Ok(captured) = SourceIdentity::capture(from) else {
            all_removed = false;
            continue;
        };
        let Ok(pinned) = PinnedSource::open(from, &captured) else {
            all_removed = false;
            continue;
        };
        let Ok(verification) = snapshot_source(&pinned) else {
            all_removed = false;
            continue;
        };
        drop(pinned);
        if remove_source_after_copy(&verification, from, landed, token).is_err() {
            all_removed = false;
            continue;
        }
        for effect in effects.iter_mut() {
            if effect.from == *from && effect.to == *landed {
                effect.source_removed = true;
            }
        }
    }
    // Folders go only when this move emptied them; `remove_dir` fails on a
    // folder that still holds anything, so nothing foreign is ever deleted.
    let mut folders: Vec<&EnumeratedEntry> =
        plan.entries.iter().filter(|entry| entry.is_dir).collect();
    folders.sort_by_key(|entry| std::cmp::Reverse(entry.rel.components().count()));
    for entry in folders {
        let _ = remove_emptied_dir(&entry.from);
    }
    all_removed
}

#[allow(clippy::too_many_arguments)]
fn effect(
    from: &Path,
    to: &Path,
    kind: EffectKind,
    source_removed: bool,
    destination_created: bool,
    before_source: Option<SourceStamp>,
    after_destination: Option<SourceStamp>,
    verified_hash: Option<String>,
) -> TransferEffect {
    TransferEffect {
        from: from.to_path_buf(),
        to: to.to_path_buf(),
        kind,
        source_removed,
        destination_created,
        before_source,
        after_destination,
        verified_hash,
    }
}

/// The legacy `OpReport` shape built from actual receipts only.
pub fn legacy_report(items: &[TransferItemResult], transfer_id: Option<String>) -> OpReport {
    let mut report = OpReport::default();
    for item in items {
        match item.status {
            TransferItemStatus::Done => {
                if let Some(to) = &item.to {
                    report.completed.push(CompletedItem {
                        from: PathBuf::from(&item.from),
                        to: PathBuf::from(to),
                    });
                    if item.destination_created {
                        report.created.push(CompletedItem {
                            from: PathBuf::from(&item.from),
                            to: PathBuf::from(to),
                        });
                    }
                }
            }
            TransferItemStatus::Skipped | TransferItemStatus::Failed => {
                report.skipped.push(SkippedItem {
                    path: PathBuf::from(&item.from),
                    reason: item
                        .reason
                        .clone()
                        .unwrap_or_else(|| "other".to_string()),
                });
            }
            TransferItemStatus::Cancelled => report.cancelled = true,
        }
    }
    report.transfer_id = transfer_id;
    report
}
