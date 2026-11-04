//! Two-phase no-replace cycle algorithm, with an injected handle adapter.
//! Native wiring is deliberately separate; no path-only rename fallback exists.
use crate::{
    journal::*,
    operations::{source_keys_overlap, source_path_key, validate_source_stamp, RenameResult},
    types::*,
};
use std::collections::HashSet;
use std::path::Path;
use uuid::Uuid;

pub trait GuardedRename {
    /// Native implementation must hold all pinned parents and READ-only-shared,
    /// DELETE-capable mutation handles until this value drops. No DELETE-on-close.
    /// Identity/size/full-precision time are verified on these same handles.
    /// The returned spelling must match the source path the plan recorded.
    fn current_path(&self, input_index: usize) -> RenameResult<String>;
    /// Atomic SetFileInformationByHandle, ReplaceIfExists=false. Target must be a
    /// sibling of that source's pinned parent; no path-based source reopen.
    /// Err must mean the adapter proved the source was not renamed; if the
    /// outcome is unknown it must stop the operation and surface recovery
    /// rather than report a rename failure this executor could roll back.
    fn rename_no_replace(&mut self, input_index: usize, target: &str) -> RenameResult<()>;
}
pub trait RenameFilesystem {
    type Guards: GuardedRename;
    /// Validate all sources, protected roots, reparses, ancestor/descendant pairs,
    /// stable identities and targets before returning. Any error means no mutation.
    fn guard_all(&mut self, effects: &[RenameEffect]) -> RenameResult<Self::Guards>;
}

fn sibling(path: &str) -> RenameResult<String> {
    let parent = Path::new(path).parent().ok_or("rename.bad_request")?;
    let candidate = parent.join(format!("~adp-rename-{}", Uuid::new_v4()));
    fs_service::path_key_of(&candidate).map_err(|_| "rename.bad_request")?;
    let target = candidate.to_str().ok_or("rename.bad_request")?.to_owned();
    fs_service::validate_path_input(&target).map_err(|_| "rename.too_large")?;
    Ok(target)
}

/// Every effect must describe a unique, pinned source and a valid sibling
/// target before native handles are opened. Anything ambiguous is refused
/// without a journal write or a filesystem call.
fn validate_effects(effects: &[RenameEffect]) -> RenameResult<()> {
    if effects.len() > MAX_SOURCES {
        return Err("rename.too_large".into());
    }
    let mut sources = HashSet::with_capacity(effects.len());
    let mut targets = HashSet::with_capacity(effects.len());
    let mut identities = HashSet::with_capacity(effects.len());
    let mut source_keys = Vec::with_capacity(effects.len());
    for effect in effects {
        if effect.current_path != effect.original_path {
            return Err("rename.bad_request".into());
        }
        validate_source_stamp(&effect.source, &effect.original_path)?;
        if !identities.insert((
            effect.source.volume_id.clone(),
            effect.source.file_id.clone(),
        )) {
            return Err("rename.bad_request".into());
        }
        let source_key = source_path_key(&effect.original_path)?;
        let target_key = source_path_key(&effect.target_path)?;
        if effect.original_path == effect.target_path {
            return Err("rename.bad_request".into());
        }
        if !sources.insert(source_key.clone()) {
            return Err("rename.bad_request".into());
        }
        if !targets.insert(target_key) {
            return Err("rename.conflict".into());
        }
        let source_parent = Path::new(&effect.original_path)
            .parent()
            .ok_or("rename.bad_request")?;
        let target_parent = Path::new(&effect.target_path)
            .parent()
            .ok_or("rename.bad_request")?;
        let source_parent_key =
            fs_service::path_key_of(source_parent).map_err(|_| "rename.bad_request")?;
        let target_parent_key =
            fs_service::path_key_of(target_parent).map_err(|_| "rename.bad_request")?;
        if source_parent_key != target_parent_key {
            return Err("rename.bad_request".into());
        }
        let target_name = Path::new(&effect.target_path)
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or("rename.bad_request")?;
        fs_service::validate_new_name(target_name).map_err(|_| "rename.invalid_name".to_owned())?;
        source_keys.push(source_key);
    }
    if source_keys_overlap(&source_keys) {
        return Err("rename.bad_request".into());
    }
    Ok(())
}

fn status_for(effect: &RenameEffect, committed: bool) -> RenameEffectStatus {
    if committed && effect.current_path == effect.target_path {
        RenameEffectStatus::Renamed
    } else if effect.current_path == effect.original_path {
        RenameEffectStatus::RolledBack
    } else {
        RenameEffectStatus::RecoveryRequired
    }
}

fn settle_statuses(journal: &mut RenameJournal, committed: bool) {
    for effect in &mut journal.effects {
        let status = status_for(effect, committed);
        effect.status = status;
        if committed {
            effect.reason = None;
        }
    }
}

fn effect_report(
    journal: &RenameJournal,
    excluded: u32,
    cancelled: bool,
    committed: bool,
) -> RenameReport {
    let mut effects = journal.effects.clone();
    for effect in &mut effects {
        let status = status_for(effect, committed);
        effect.status = status;
    }
    let done = effects
        .iter()
        .filter(|e| e.status == RenameEffectStatus::Renamed)
        .count() as u32;
    let recovery_required = journal.state == JournalState::RecoveryRequired
        || effects
            .iter()
            .any(|e| e.status == RenameEffectStatus::RecoveryRequired);
    RenameReport {
        receipt_id: journal.receipt_id,
        failed: effects.len() as u32 - done,
        done,
        excluded,
        cancelled,
        recovery_required,
        effects,
        next_cursor: None,
        complete: true,
    }
}

/// Internal full report (up to 1000 effects). Native must page it before IPC.
pub fn execute(
    receipt_id: Uuid,
    effects: Vec<RenameEffect>,
    excluded: u32,
    fs: &mut impl RenameFilesystem,
    store: &mut impl JournalStore,
    cancelled: impl Fn() -> bool,
) -> RenameResult<RenameReport> {
    if receipt_id.is_nil() {
        return Err("rename.bad_request".into());
    }
    validate_effects(&effects)?;
    if cancelled() {
        return Err("rename.cancelled".into());
    }
    // The guards stay in this stack frame through every flush and recovery report.
    let mut guards = fs.guard_all(&effects)?;
    let mut journal = RenameJournal {
        schema_version: 1,
        receipt_id,
        state: JournalState::Prepared,
        effects,
        intents: vec![],
    };
    for (index, effect) in journal.effects.iter_mut().enumerate() {
        if guards.current_path(index)? != effect.original_path {
            return Err("rename.changed".into());
        }
        effect.current_path = effect.original_path.clone();
        effect.reason = None;
    }
    // Preselect all intermediate names before the first syscall. Never clean them.
    let intermediates = journal
        .effects
        .iter()
        .map(|e| sibling(&e.original_path))
        .collect::<RenameResult<Vec<_>>>()?;
    ensure_capacity(&journal, &intermediates)?;
    store
        .reserve(receipt_id, MAX_PLAN_BYTES)
        .map_err(|_| "rename.journal_failed")?;
    flush(store, &journal)?;
    let mut completed = Vec::new();
    let mut failure = None;
    let mut journal_writable = true;
    'phases: for final_phase in [false, true] {
        for (index, intermediate) in intermediates.iter().enumerate() {
            if cancelled() {
                failure = Some("rename.cancelled".to_owned());
                break 'phases;
            }
            let target = if final_phase {
                journal.effects[index].target_path.clone()
            } else {
                intermediate.clone()
            };
            let old = journal.effects[index].current_path.clone();
            match rename_one(&mut guards, store, &mut journal, index, &target) {
                Ok(()) => completed.push((index, old)),
                Err((error, writable, mutated)) => {
                    if mutated {
                        completed.push((index, old));
                    }
                    failure = Some(error);
                    journal_writable = writable;
                    break 'phases;
                }
            }
        }
    }
    if let Some(error) = failure {
        // A failed completion write leaves a durable pending intent. Do not make
        // unjournaled rollback mutations when further durable writes are uncertain.
        if journal_writable {
            for (index, old) in completed.into_iter().rev() {
                if let Err((reason, writable, _)) =
                    rename_one(&mut guards, store, &mut journal, index, &old)
                {
                    journal.effects[index].reason = Some(reason);
                    if !writable {
                        journal_writable = false;
                        break;
                    }
                }
            }
        }
        let report_reason = if error == "rename.journal_failed"
            && journal
                .effects
                .iter()
                .any(|e| e.current_path != e.original_path)
        {
            "rename.recovery_required"
        } else {
            &error
        };
        for effect in &mut journal.effects {
            if effect.reason.is_none() {
                effect.reason = Some(report_reason.to_owned());
            }
        }
        journal.state = if !journal_writable
            || journal
                .effects
                .iter()
                .any(|e| e.current_path != e.original_path)
        {
            JournalState::RecoveryRequired
        } else {
            JournalState::RolledBack
        };
        settle_statuses(&mut journal, false);
        if flush(store, &journal).is_err() {
            journal.state = JournalState::RecoveryRequired;
        }
        return Ok(effect_report(
            &journal,
            excluded,
            error == "rename.cancelled",
            false,
        ));
    }
    journal.state = JournalState::Committed;
    settle_statuses(&mut journal, true);
    if flush(store, &journal).is_err() {
        journal.state = JournalState::RecoveryRequired;
    }
    Ok(effect_report(&journal, excluded, false, true))
}

/// Error tuple: reason, journal still writable, syscall changed the source.
fn rename_one(
    guards: &mut impl GuardedRename,
    store: &mut impl JournalStore,
    journal: &mut RenameJournal,
    index: usize,
    target: &str,
) -> Result<(), (String, bool, bool)> {
    let effect = &journal.effects[index];
    let old_path = effect.current_path.clone();
    journal.state = JournalState::Renaming;
    journal.intents.push(RenameIntent {
        sequence: journal.intents.len() as u32,
        input_index: index as u32,
        old_path,
        new_path: target.into(),
        volume_id: effect.source.volume_id.clone(),
        file_id: effect.source.file_id.clone(),
        state: IntentState::Intent,
    });
    flush(store, journal).map_err(|error| (error, false, false))?;
    guards
        .rename_no_replace(index, target)
        .map_err(|error| (error, true, false))?;
    // A successful handle syscall has exactly this destination. The native guard
    // retains that same object and parent; no probe/reopen guesses the source.
    journal.effects[index].current_path = target.into();
    journal.intents.last_mut().expect("intent exists").state = IntentState::Completed;
    flush(store, journal).map_err(|error| (error, false, true))?;
    Ok(())
}
