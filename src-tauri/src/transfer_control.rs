//! The controlled transfer queue (Step 09f E7, `transfer-jobs-1`).
//!
//! One coordinator owns every copy and move: it admits at most 32 registered
//! jobs, lets at most two run and at most one run per destination volume, in
//! arrival order per volume. The job entry and its Undo reservation exist
//! *before* `transfer_start` acknowledges, so an acknowledged job always has
//! a place to put its exact effects and its report.
//!
//! The map lock only ever guards bookkeeping. Every disk operation, every
//! history call and every wait happens outside it (conventions 3.6).
#![allow(dead_code)]


use std::collections::{HashMap, VecDeque};
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use fs_service::transfer_decisions::{
    allowed_actions, DecisionAction, DecisionTicket, PendingKind, RetryCounter, TransferGate,
};
use fs_service::transfer_rates::RateSampler;
use fs_service::{CancellationToken, OpProgress};
use uuid::Uuid;

use crate::transfer_job_types::{
    parse_control, ControlAction, ResolvedRequest, TransferControl, TransferDecision,
    TransferDecisionRequest, TransferError, TransferItemResult, TransferItemStatus, TransferPhase,
    TransferReport, TransferRequest, TransferState, MAX_GLOBAL_TRANSFERS, MAX_PER_VOLUME_TRANSFERS,
    MAX_REGISTERED_JOBS, MAX_REPORT_BYTES, MAX_REPORT_ITEMS, MAX_REPORT_PAGES,
    REPORT_CURSOR_TTL_SECS,
};

/// How many item lines one job keeps for its report (64 pages of 200). The
/// counters stay exact beyond this; the per-item lines stop growing.
pub const MAX_RETAINED_RESULTS: usize = MAX_REPORT_PAGES * MAX_REPORT_ITEMS;

/// One question the window has to answer.
#[derive(Debug, Clone)]
pub struct Question {
    pub request: TransferDecisionRequest,
    pub ticket: DecisionTicket,
    pub kind: PendingKind,
    pub merge_allowed: bool,
    pub retries: RetryCounter,
}

/// The answer that woke the worker.
#[derive(Debug, Clone, Copy)]
pub struct Answer {
    pub decision_id: Uuid,
    pub action: DecisionAction,
    pub apply_to_all: bool,
}

#[derive(Debug)]
struct RuntimeState {
    phase: TransferPhase,
    progress: OpProgress,
    bytes_per_second: Option<f64>,
    eta_seconds: Option<u64>,
    current_item_id: Option<String>,
    question: Option<Question>,
    answer: Option<Answer>,
    generation: u64,
    items: Vec<TransferItemResult>,
    done: u32,
    skipped: u32,
    failed: u32,
    cancelled: bool,
    finished: bool,
    /// The opaque Undo token, once the exact effects are stored.
    transfer_id: Option<String>,
}

/// Everything one job shares between the coordinator and its worker.
#[derive(Debug)]
pub struct JobRuntime {
    pub job_id: String,
    pub report_id: String,
    pub gate: TransferGate,
    token: Mutex<Option<CancellationToken>>,
    rates: Mutex<RateSampler>,
    state: Mutex<RuntimeState>,
    answered: Condvar,
}

impl JobRuntime {
    pub fn new(job_id: &str, items_total: usize) -> Arc<Self> {
        Arc::new(Self {
            job_id: job_id.to_string(),
            report_id: Uuid::new_v4().to_string(),
            gate: TransferGate::new(),
            token: Mutex::new(None),
            rates: Mutex::new(RateSampler::new()),
            state: Mutex::new(RuntimeState {
                phase: TransferPhase::Queued,
                progress: OpProgress {
                    items_done: 0,
                    items_total,
                    bytes_done: 0,
                    bytes_total: 0,
                    current: String::new(),
                },
                bytes_per_second: None,
                eta_seconds: None,
                current_item_id: None,
                question: None,
                answer: None,
                generation: 0,
                items: Vec::new(),
                done: 0,
                skipped: 0,
                failed: 0,
                cancelled: false,
                finished: false,
                transfer_id: None,
            }),
            answered: Condvar::new(),
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, RuntimeState> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn attach_token(&self, token: CancellationToken) {
        *self.token.lock().unwrap_or_else(|p| p.into_inner()) = Some(token);
    }

    /// The shared job's cancellation token, for the worker.
    pub fn token(&self) -> Option<CancellationToken> {
        self.token.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }

    /// Remember the opaque Undo token of the stored effects.
    pub fn set_transfer_id(&self, transfer_id: Option<String>) {
        self.lock().transfer_id = transfer_id;
    }

    pub fn transfer_id(&self) -> Option<String> {
        self.lock().transfer_id.clone()
    }

    fn token_flag(&self) -> bool {
        self.token
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
            .is_some_and(|token| token.load(Ordering::Relaxed))
    }

    /// Ask the job to stop from outside the gate (`cancel_all`, shutdown).
    pub fn cancel_from_outside(&self) {
        if let Some(token) = self
            .token
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
        {
            token.store(true, Ordering::Relaxed);
        }
        self.gate.cancel();
    }

    pub fn generation(&self) -> u64 {
        self.lock().generation
    }

    pub fn phase(&self) -> TransferPhase {
        self.lock().phase
    }

    /// A finished job accepts no further control or answer.
    pub fn is_finished(&self) -> bool {
        self.lock().finished
    }

    pub fn set_phase(&self, phase: TransferPhase) {
        let mut state = self.lock();
        state.phase = phase;
        state.generation = state.generation.wrapping_add(1);
    }

    pub fn set_progress(&self, progress: &OpProgress, remaining_bytes: u64) {
        let (per_second, eta) = {
            let rate = self.rates.lock().unwrap_or_else(|p| p.into_inner());
            (rate.bytes_per_second(), rate.eta_seconds(remaining_bytes))
        };
        let mut state = self.lock();
        state.progress = progress.clone();
        state.bytes_per_second = per_second;
        state.eta_seconds = eta;
    }

    /// The sampler the copy engine records into.
    pub fn rates(&self) -> std::sync::MutexGuard<'_, RateSampler> {
        self.rates.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn set_current_item(&self, item_id: Option<String>) {
        self.lock().current_item_id = item_id;
    }

    /// Add one finished item to the report and count it.
    pub fn push_item(&self, item: TransferItemResult) {
        let mut state = self.lock();
        match item.status {
            TransferItemStatus::Done => state.done = state.done.saturating_add(1),
            TransferItemStatus::Skipped => state.skipped = state.skipped.saturating_add(1),
            TransferItemStatus::Failed => state.failed = state.failed.saturating_add(1),
            TransferItemStatus::Cancelled => state.cancelled = true,
        }
        if state.items.len() < MAX_RETAINED_RESULTS {
            state.items.push(item);
        }
    }

    pub fn mark_cancelled(&self) {
        self.lock().cancelled = true;
    }

    pub fn finish(&self) {
        let mut state = self.lock();
        state.finished = true;
        state.phase = TransferPhase::Done;
        state.question = None;
        state.generation = state.generation.wrapping_add(1);
        drop(state);
        self.answered.notify_all();
    }

    /// Put a question on screen and wait for its answer. `None` means the
    /// job was cancelled while the question was open.
    ///
    /// The ticket is bound to the generation the question is *shown* under,
    /// not the one the caller read before asking: the snapshot that carries
    /// the question also carries this generation, and `submit` accepts only
    /// an answer for exactly that pair.
    pub fn ask(&self, mut question: Question) -> Option<Answer> {
        {
            let mut state = self.lock();
            state.phase = match question.kind {
                PendingKind::Error => TransferPhase::AwaitingError,
                PendingKind::Name => TransferPhase::AwaitingConflict,
            };
            state.generation = state.generation.wrapping_add(1);
            question.ticket.generation = state.generation;
            state.question = Some(question);
            state.answer = None;
        }
        loop {
            {
                let mut state = self.lock();
                if let Some(answer) = state.answer.take() {
                    state.question = None;
                    state.phase = TransferPhase::Running;
                    state.generation = state.generation.wrapping_add(1);
                    return Some(answer);
                }
                if state.cancelled || self.gate.is_cancelled() {
                    state.question = None;
                    return None;
                }
            }
            if self.token_flag() {
                let mut state = self.lock();
                state.question = None;
                return None;
            }
            // Bounded wait: a cancellation from outside the gate never
            // leaves the worker sleeping on this condvar.
            let state = self.lock();
            let _ = self
                .answered
                .wait_timeout(state, Duration::from_millis(50))
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
    }

    /// Accept an answer only for the question that is on screen now.
    pub fn submit(&self, decision: &TransferDecision) -> Result<TransferState, TransferError> {
        let action =
            DecisionAction::parse(&decision.action).map_err(|_| TransferError::InvalidRequest)?;
        let decision_id =
            Uuid::parse_str(&decision.decision_id).map_err(|_| TransferError::InvalidRequest)?;
        let mut state = self.lock();
        let Some(question) = state.question.as_ref() else {
            return Err(TransferError::DecisionStale);
        };
        if state.answer.is_some() {
            // One answer per question; a second click changes nothing.
            return Err(TransferError::DecisionStale);
        }
        // The id must be the question on screen and the generation must be
        // the current one. Pause/Resume bump the generation while a question
        // stays open, so the window's latest snapshot is what counts.
        if question.ticket.decision_id != decision_id
            || decision.generation != state.generation
        {
            return Err(TransferError::DecisionStale);
        }
        if !allowed_actions(question.kind, question.merge_allowed, question.retries.used())
            .contains(&action)
        {
            return Err(TransferError::InvalidRequest);
        }
        state.answer = Some(Answer {
            decision_id,
            action,
            apply_to_all: decision.apply_to_all,
        });
        drop(state);
        self.answered.notify_all();
        Ok(self.snapshot())
    }

    pub fn state_snapshot(&self) -> TransferState {
        self.snapshot()
    }

    fn snapshot(&self) -> TransferState {
        let state = self.lock();
        TransferState {
            job_id: self.job_id.clone(),
            state: state.phase,
            progress: state.progress.clone(),
            bytes_per_second: state.bytes_per_second,
            eta_seconds: state.eta_seconds,
            current_item_id: state.current_item_id.clone(),
            decision: state.question.as_ref().map(|q| q.request.clone()),
            generation: state.generation,
        }
    }

    /// One page of the report, starting at item line `start`.
    ///
    /// Both page bounds hold: at most `MAX_REPORT_ITEMS` lines and at most
    /// `MAX_REPORT_BYTES` of paths, so a page stays inside one IPC reply even
    /// when the sources have very long paths. `complete` is true only when
    /// this page reached the last retained line.
    pub fn report_from(&self, start: usize) -> TransferReport {
        let state = self.lock();
        let mut items: Vec<TransferItemResult> = Vec::new();
        let mut bytes = 0usize;
        let mut next = start;
        while next < state.items.len() && items.len() < MAX_REPORT_ITEMS {
            let item = &state.items[next];
            let size = item.from.len() + item.to.as_deref().map_or(0, str::len) + 128;
            if !items.is_empty() && bytes.saturating_add(size) > MAX_REPORT_BYTES {
                break;
            }
            bytes = bytes.saturating_add(size);
            items.push(item.clone());
            next += 1;
        }
        TransferReport {
            report_id: self.report_id.clone(),
            transfer_id: state.transfer_id.clone(),
            items,
            next_cursor: None,
            done: state.done,
            skipped: state.skipped,
            failed: state.failed,
            cancelled: state.cancelled,
            job_finished: state.finished,
            complete: next >= state.items.len() && start <= state.items.len(),
            replace_available: false,
        }
    }

    pub fn retained_results(&self) -> usize {
        self.lock().items.len()
    }
}

/// One report cursor, valid for five minutes and one job.
struct Cursor {
    job_id: String,
    start: usize,
    issued: Instant,
}

/// A job admitted to one destination volume.
struct RegisteredJob {
    runtime: Arc<JobRuntime>,
    volume_key: String,
    request: ResolvedRequest,
    running: bool,
    finished: bool,
}

/// Finished jobs whose report is still reachable (newest kept).
const MAX_FINISHED_JOBS: usize = 32;

#[derive(Default)]
struct Inner {
    jobs: HashMap<String, RegisteredJob>,
    order: VecDeque<String>,
    per_volume: HashMap<String, usize>,
    running: usize,
}

impl Inner {
    /// Jobs that have not finished yet; finished ones keep their report.
    fn unfinished(&self) -> usize {
        self.jobs.values().filter(|job| !job.finished).count()
    }

    /// Keep a bounded number of finished reports, oldest first.
    fn prune_finished(&mut self) {
        let finished: Vec<String> = self
            .order
            .iter()
            .filter(|id| {
                self.jobs
                    .get(*id)
                    .is_some_and(|job| job.finished)
            })
            .cloned()
            .collect();
        if finished.len() <= MAX_FINISHED_JOBS {
            return;
        }
        for id in finished {
            let still_too_many = self
                .jobs
                .values()
                .filter(|job| job.finished)
                .count()
                > MAX_FINISHED_JOBS;
            if !still_too_many {
                break;
            }
            self.jobs.remove(&id);
            self.order.retain(|kept| kept != &id);
        }
    }
}

/// A job that may start its worker now.
pub struct Promoted {
    pub job_id: String,
    pub request: ResolvedRequest,
    pub runtime: Arc<JobRuntime>,
}

fn volume_key(job_id: &str, destination: &Path) -> String {
    if let Some(root) = unc_share(destination) {
        return format!("net:{root}");
    }
    match fs_service::transfer_move::volume_of(destination) {
        Some(serial) => format!("vol:{serial:08x}"),
        // An identity we cannot read never guesses: the job gets a private
        // key, so two unreadable destinations never look like one volume.
        None => format!("exclusive:{job_id}"),
    }
}

/// `\\server\share` in lower case, or `None` for a local path.
fn unc_share(path: &Path) -> Option<String> {
    let text = path.to_string_lossy();
    let rest = text.strip_prefix(r"\\")?;
    let mut parts = rest.split('\\');
    let server = parts.next()?;
    let share = parts.next()?;
    if server.is_empty() || share.is_empty() {
        return None;
    }
    Some(format!("{server}\\{share}").to_lowercase())
}

/// Pick the jobs that may start: oldest queued per volume, within the two
/// global slots and the one slot per volume. Pure bookkeeping.
fn promote(inner: &mut Inner) -> Vec<Promoted> {
    let mut promoted = Vec::new();
    loop {
        if inner.running >= MAX_GLOBAL_TRANSFERS {
            break;
        }
        let next = inner.order.iter().find_map(|id| {
            let job = inner.jobs.get(id)?;
            if job.running || job.finished {
                return None;
            }
            let used = inner.per_volume.get(&job.volume_key).copied().unwrap_or(0);
            if used >= MAX_PER_VOLUME_TRANSFERS {
                return None;
            }
            Some(id.clone())
        });
        let Some(id) = next else { break };
        let admitted = {
            let Some(job) = inner.jobs.get_mut(&id) else {
                break;
            };
            job.running = true;
            (
                job.volume_key.clone(),
                job.request.clone(),
                Arc::clone(&job.runtime),
            )
        };
        let (volume_key, request, runtime) = admitted;
        *inner.per_volume.entry(volume_key).or_insert(0) += 1;
        inner.running += 1;
        promoted.push(Promoted {
            job_id: id,
            request,
            runtime,
        });
    }
    promoted
}

/// The app's transfer coordinator (managed state).
#[derive(Default)]
pub struct TransferCoordinator {
    inner: Mutex<Inner>,
    cursors: Mutex<HashMap<String, Cursor>>,
    history: Mutex<Option<Arc<Mutex<crate::transfer_history::TransferHistory>>>>,
}

impl TransferCoordinator {
    pub fn set_history(&self, history: Arc<Mutex<crate::transfer_history::TransferHistory>>) {
        *self.history.lock().unwrap_or_else(|p| p.into_inner()) = Some(history);
    }

    /// The Undo history, when the app has attached one.
    pub fn history(&self) -> Option<Arc<Mutex<crate::transfer_history::TransferHistory>>> {
        self.history
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clone()
    }

    /// Release the Undo reservation of a job that will not finish.
    pub fn abort(&self, job_id: &str) {
        if let Some(history) = self
            .history
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
        {
            if let Ok(mut history) = history.lock() {
                history.abort(job_id);
            }
        }
    }

    /// Register a job. The entry, its report room and its Undo reservation
    /// all exist before this returns, so a later failure cannot leave
    /// completed items with nowhere to be recorded.
    pub fn enqueue(
        &self,
        job_id: &str,
        request: TransferRequest,
        verify_default: bool,
    ) -> Result<Arc<JobRuntime>, TransferError> {
        let resolved = crate::transfer_job_types::resolve_request(request, verify_default)?;
        let key = volume_key(job_id, &resolved.dest_dir);
        // Memory only, never held across disk work.
        if let Some(history) = self
            .history
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .as_ref()
        {
            history
                .lock()
                .map_err(|_| TransferError::Io)?
                .reserve(job_id, None)
                .map_err(|code| match code.as_str() {
                    "ops.undo_limit" => TransferError::UndoLimit,
                    _ => TransferError::InvalidRequest,
                })?;
        }
        let runtime = JobRuntime::new(job_id, resolved.sources.len());
        let mut inner = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        let duplicate = inner.jobs.contains_key(job_id);
        let full = inner.unfinished() >= MAX_REGISTERED_JOBS;
        if duplicate || full {
            drop(inner);
            self.abort(job_id);
            return Err(if duplicate {
                TransferError::InvalidRequest
            } else {
                TransferError::QueueFull
            });
        }
        inner.jobs.insert(
            job_id.to_string(),
            RegisteredJob {
                runtime: Arc::clone(&runtime),
                volume_key: key,
                request: resolved,
                running: false,
                finished: false,
            },
        );
        inner.order.push_back(job_id.to_string());
        inner.prune_finished();
        Ok(runtime)
    }

    /// Drop a job that never started (its transport entry could not be
    /// created), together with its Undo reservation.
    pub fn forget(&self, job_id: &str) {
        {
            let mut inner = self.inner.lock().unwrap_or_else(|p| p.into_inner());
            if let Some(job) = inner.jobs.remove(job_id) {
                inner.order.retain(|id| id != job_id);
                if job.running {
                    inner.running = inner.running.saturating_sub(1);
                    if let Some(used) = inner.per_volume.get_mut(&job.volume_key) {
                        *used = used.saturating_sub(1);
                    }
                }
            }
        }
        self.abort(job_id);
    }

    /// Jobs that may start now.
    pub fn take_runnable(&self) -> Vec<Promoted> {
        let mut inner = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        promote(&mut inner)
    }

    /// A worker finished (or failed): free its slots. The finished job keeps
    /// its report reachable through `state` and `report_page`.
    pub fn release(&self, job_id: &str) {
        let mut inner = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        let mut freed: Option<String> = None;
        if let Some(job) = inner.jobs.get_mut(job_id) {
            job.finished = true;
            if job.running {
                job.running = false;
                freed = Some(job.volume_key.clone());
            }
        }
        if let Some(volume_key) = freed {
            inner.running = inner.running.saturating_sub(1);
            if let Some(used) = inner.per_volume.get_mut(&volume_key) {
                *used = used.saturating_sub(1);
            }
        }
    }

    fn runtime(&self, job_id: &str) -> Result<Arc<JobRuntime>, TransferError> {
        let inner = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        inner
            .jobs
            .get(job_id)
            .map(|job| Arc::clone(&job.runtime))
            .ok_or(TransferError::InvalidRequest)
    }

    pub fn state(&self, job_id: &str) -> Result<TransferState, TransferError> {
        Ok(self.runtime(job_id)?.state_snapshot())
    }

    pub fn control(
        &self,
        job_id: &str,
        control: &TransferControl,
    ) -> Result<TransferState, TransferError> {
        let action = parse_control(&control.action)?;
        let runtime = self.runtime(job_id)?;
        if runtime.is_finished() {
            return Err(TransferError::Changed);
        }
        if control.expected_generation != runtime.generation() {
            return Err(TransferError::Changed);
        }
        match action {
            ControlAction::Pause => {
                runtime.gate.pause();
                runtime.set_phase(TransferPhase::Paused);
            }
            ControlAction::Resume => {
                runtime.gate.resume();
                runtime.set_phase(TransferPhase::Running);
            }
            ControlAction::SkipCurrent => {
                // A question that is already on screen is answered, not left
                // waiting for a second click.
                let state = runtime.state_snapshot();
                if let Some(question) = state.decision {
                    let decision = TransferDecision {
                        decision_id: question.decision_id,
                        generation: state.generation,
                        action: "skip".to_string(),
                        apply_to_all: false,
                    };
                    runtime.submit(&decision)?;
                }
                runtime.gate.skip_current();
            }
            ControlAction::Cancel => {
                runtime.gate.cancel();
                runtime.set_phase(TransferPhase::Cancelling);
            }
        }
        Ok(runtime.state_snapshot())
    }

    pub fn decide(
        &self,
        job_id: &str,
        decision: &TransferDecision,
    ) -> Result<TransferState, TransferError> {
        self.runtime(job_id)?.submit(decision)
    }

    /// The first page of a job's report, with its cursor when more follow.
    pub fn first_page_of(&self, job_id: &str) -> Result<TransferReport, TransferError> {
        let runtime = self.runtime(job_id)?;
        let mut page = runtime.report_from(0);
        if !page.complete {
            page.next_cursor = self.issue_cursor(job_id, page.items.len());
        }
        Ok(page)
    }

    /// One page without a cursor; the legacy `file_op_poll` adapter uses it.
    pub fn report_page(&self, job_id: &str, start: usize) -> Result<TransferReport, TransferError> {
        Ok(self.runtime(job_id)?.report_from(start))
    }

    /// Remember where a page ended and return its cursor.
    fn issue_cursor(&self, job_id: &str, start: usize) -> Option<String> {
        let mut cursors = self.cursors.lock().unwrap_or_else(|p| p.into_inner());
        let ttl = Duration::from_secs(REPORT_CURSOR_TTL_SECS);
        cursors.retain(|_, cursor| cursor.issued.elapsed() < ttl);
        if cursors.len() >= MAX_REPORT_PAGES * MAX_REGISTERED_JOBS {
            return None;
        }
        let id = Uuid::new_v4().to_string();
        cursors.insert(
            id.clone(),
            Cursor {
                job_id: job_id.to_string(),
                start,
                issued: Instant::now(),
            },
        );
        Some(id)
    }

    /// The page a cursor names, or `ops.invalid_request` when it expired.
    pub fn page_for_cursor(&self, cursor_id: &str) -> Result<TransferReport, TransferError> {
        let cursor = {
            let mut cursors = self.cursors.lock().unwrap_or_else(|p| p.into_inner());
            let ttl = Duration::from_secs(REPORT_CURSOR_TTL_SECS);
            cursors.retain(|_, cursor| cursor.issued.elapsed() < ttl);
            cursors.remove(cursor_id)
        }
        .ok_or(TransferError::InvalidRequest)?;
        let runtime = self.runtime(&cursor.job_id)?;
        let mut page = runtime.report_from(cursor.start);
        if !page.complete {
            page.next_cursor =
                self.issue_cursor(&cursor.job_id, cursor.start + page.items.len());
        }
        Ok(page)
    }

    /// Cancel every running and queued transfer (app shutdown).
    pub fn cancel_all(&self) {
        let runtimes: Vec<Arc<JobRuntime>> = {
            let inner = self.inner.lock().unwrap_or_else(|p| p.into_inner());
            inner
                .jobs
                .values()
                .map(|job| Arc::clone(&job.runtime))
                .collect()
        };
        for runtime in runtimes {
            runtime.cancel_from_outside();
        }
    }

    pub fn registered(&self) -> usize {
        self.inner
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .unfinished()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transfer_job_types::TransferPriority;
    use fs_service::SourceStamp;

    fn request(destination: &str) -> TransferRequest {
        TransferRequest {
            kind: crate::transfer_job_types::TransferKind::Copy,
            sources: vec![r"C:\A\a.txt".to_string()],
            expected_sources: None,
            dest_dir: destination.to_string(),
            conflict: "skip".to_string(),
            verify: None,
            allow_system: false,
            priority: TransferPriority::Normal,
        }
    }

    fn resolved(destination: &str) -> ResolvedRequest {
        crate::transfer_job_types::resolve_request(request(destination), false).unwrap()
    }

    #[test]
    fn a_network_destination_keys_on_server_and_share() {
        assert_eq!(
            unc_share(Path::new(r"\\Server\Share\folder\file.txt")),
            Some(r"server\share".to_string())
        );
        assert_eq!(unc_share(Path::new(r"C:\folder")), None);
    }

    #[test]
    fn thirty_three_registered_jobs_are_refused() {
        let coordinator = TransferCoordinator::default();
        for index in 0..MAX_REGISTERED_JOBS {
            coordinator
                .enqueue(&format!("job-{index}"), request(r"C:\B"), false)
                .unwrap();
        }
        assert_eq!(
            coordinator
                .enqueue("one-more", request(r"C:\B"), false)
                .unwrap_err(),
            TransferError::QueueFull
        );
        assert_eq!(TransferError::QueueFull.code(), "ops.queue_full");
        assert_eq!(coordinator.registered(), MAX_REGISTERED_JOBS);
    }

    #[test]
    fn a_job_exists_as_soon_as_it_is_acknowledged() {
        let coordinator = TransferCoordinator::default();
        coordinator
            .enqueue("job-1", request(r"C:\B"), false)
            .unwrap();
        let state = coordinator.state("job-1").unwrap();
        assert_eq!(state.state, TransferPhase::Queued);
        assert_eq!(state.progress.items_total, 1);
        assert!(state.decision.is_none());
        assert!(state.bytes_per_second.is_none());
        assert!(state.eta_seconds.is_none());
    }

    #[test]
    fn a_refused_replace_reserves_no_history_and_creates_no_job() {
        let history = Arc::new(Mutex::new(crate::transfer_history::TransferHistory::default()));
        let coordinator = TransferCoordinator::default();
        coordinator.set_history(Arc::clone(&history));
        let mut ask = request(r"C:\B");
        ask.conflict = "replace".to_string();
        assert_eq!(
            coordinator.enqueue("job-1", ask, false).unwrap_err(),
            TransferError::ReplaceUnavailable
        );
        assert_eq!(coordinator.registered(), 0);
        // The reservation slot is still free, so a normal job can take it.
        coordinator
            .enqueue("job-2", request(r"C:\B"), false)
            .unwrap();
    }

    #[test]
    fn only_one_job_per_volume_and_two_in_total_may_run() {
        let mut inner = Inner::default();
        for (index, key) in ["vol:00000001", "vol:00000001", "vol:00000002", "vol:00000003"]
            .iter()
            .enumerate()
        {
            let id = format!("job-{index}");
            inner.jobs.insert(
                id.clone(),
                RegisteredJob {
                    runtime: JobRuntime::new(&id, 1),
                    volume_key: (*key).to_string(),
                    request: resolved(r"C:\B"),
                    running: false,
                    finished: false,
                },
            );
            inner.order.push_back(id);
        }
        let promoted = promote(&mut inner);
        assert_eq!(promoted.len(), MAX_GLOBAL_TRANSFERS);
        assert_eq!(promoted[0].job_id, "job-0");
        // The second job on volume 1 waits; volume 2 goes next.
        assert_eq!(promoted[1].job_id, "job-2");
        assert_eq!(inner.running, MAX_GLOBAL_TRANSFERS);
    }

    #[test]
    fn a_stale_generation_changes_nothing() {
        let coordinator = TransferCoordinator::default();
        let runtime = coordinator
            .enqueue("job-1", request(r"C:\B"), false)
            .unwrap();
        let bad = TransferControl {
            action: "pause".to_string(),
            expected_generation: runtime.generation() + 9,
        };
        assert_eq!(
            coordinator.control("job-1", &bad).unwrap_err(),
            TransferError::Changed
        );
        assert_eq!(runtime.phase(), TransferPhase::Queued);
    }

    fn stamp(key: &str) -> SourceStamp {
        SourceStamp {
            path_key: key.to_string(),
            volume_id: "1a2b3c4d".to_string(),
            file_id: "00000000000000ff".to_string(),
            modified_ticks: "133500000000000000".to_string(),
            size_bytes: 4,
        }
    }

    fn question(decision_id: Uuid, generation: u64) -> Question {
        Question {
            request: TransferDecisionRequest {
                decision_id: decision_id.to_string(),
                item_id: Uuid::new_v4().to_string(),
                kind: "conflict".to_string(),
                source_path: r"C:\A\a.txt".to_string(),
                target_path: Some(r"C:\B\a.txt".to_string()),
                source: Some(stamp(r"C:\A\a.txt")),
                target: Some(stamp(r"C:\B\a.txt")),
                source_kind: Some("file".to_string()),
                target_kind: Some("file".to_string()),
                error_code: None,
                attempt: 0,
                allowed: vec!["skip".to_string(), "cancel".to_string()],
                replace_available: false,
            },
            ticket: DecisionTicket {
                decision_id,
                item_id: Uuid::new_v4(),
                generation,
                source: stamp(r"C:\A\a.txt"),
                target: Some(stamp(r"C:\B\a.txt")),
            },
            kind: PendingKind::Name,
            merge_allowed: false,
            retries: RetryCounter::default(),
        }
    }

    #[test]
    fn an_open_question_accepts_only_the_generation_the_window_sees() {
        let runtime = JobRuntime::new("job-1", 1);
        let worker = Arc::clone(&runtime);
        let decision_id = Uuid::new_v4();
        let handle = std::thread::spawn(move || {
            // The caller's ticket generation is deliberately stale.
            worker.ask(question(decision_id, 0))
        });
        let shown = loop {
            let snapshot = runtime.state_snapshot();
            if let Some(decision) = snapshot.decision {
                break (snapshot.generation, decision);
            }
            std::thread::sleep(Duration::from_millis(2));
        };
        let (generation, shown) = shown;
        assert_eq!(shown.decision_id, decision_id.to_string());
        assert_eq!(
            runtime
                .submit(&TransferDecision {
                    decision_id: decision_id.to_string(),
                    generation: generation.wrapping_sub(1),
                    action: "skip".to_string(),
                    apply_to_all: false,
                })
                .unwrap_err(),
            TransferError::DecisionStale
        );
        let state = runtime
            .submit(&TransferDecision {
                decision_id: decision_id.to_string(),
                generation,
                action: "skip".to_string(),
                apply_to_all: false,
            })
            .unwrap();
        // The window sees the accepted answer; the worker closes the
        // question on its next wake-up.
        assert!(state.decision.is_some() || state.state == TransferPhase::Running);
        let answer = handle.join().unwrap().expect("the question was answered");
        assert_eq!(answer.decision_id, decision_id);
        assert_eq!(answer.action, DecisionAction::Skip);
    }

    #[test]
    fn a_finished_job_refuses_further_control() {
        let coordinator = TransferCoordinator::default();
        let runtime = coordinator
            .enqueue("job-1", request(r"C:\B"), false)
            .unwrap();
        runtime.finish();
        let control = TransferControl {
            action: "pause".to_string(),
            expected_generation: runtime.generation(),
        };
        assert_eq!(
            coordinator.control("job-1", &control).unwrap_err(),
            TransferError::Changed
        );
    }

    #[test]
    fn pausing_while_a_question_is_open_keeps_the_answer_valid() {
        let runtime = JobRuntime::new("job-1", 1);
        let worker = Arc::clone(&runtime);
        let decision_id = Uuid::new_v4();
        let handle = std::thread::spawn(move || worker.ask(question(decision_id, 0)));
        let shown = loop {
            let snapshot = runtime.state_snapshot();
            if snapshot.decision.is_some() {
                break snapshot;
            }
            std::thread::sleep(Duration::from_millis(2));
        };
        // Pause and Resume grow the state generation without closing the
        // question; the window's next snapshot carries the new number.
        runtime.gate.pause();
        runtime.set_phase(TransferPhase::Paused);
        let latest = runtime.state_snapshot();
        assert!(latest.generation > shown.generation);
        assert!(latest.decision.is_some());
        runtime
            .submit(&TransferDecision {
                decision_id: decision_id.to_string(),
                generation: latest.generation,
                action: "skip".to_string(),
                apply_to_all: false,
            })
            .expect("the answer belongs to the question on screen");
        let answer = handle.join().unwrap().expect("answered");
        assert_eq!(answer.action, DecisionAction::Skip);
    }
}
