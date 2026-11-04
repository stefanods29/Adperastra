//! Warm confined Office read pool (Step 13 T3).
//!
//! The pool is the only place that admits/retains an Office read document.
//! It delegates every actor call to 12b's single `EngineSession`; this module
//! never spawns a process, resolves a pack path or speaks UNO. The C++ bridge
//! in `tools/office-bridge` implements the fixed `office_read_v1` wire.
//!
//! The document table is bounded at four. A fifth open closes the oldest
//! document only when it has no viewer or render lease; otherwise it returns
//! `engines.busy`. Idle expiry is fixed at 60 s by `EngineSessionStart`; the
//! viewer setting is validated rather than used to invent another value.
#![allow(dead_code)]


use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use uuid::Uuid;

use crate::engine_session_types::{EngineReadDocument, OfficeSessionRenderRequest};
use crate::engine_types::{EngineInput, OfficeFormat, RenderedOffice};
use crate::jobs::JobContext;
use crate::office_pool_leases::{Admission, DerivedPdfIdentity, OfficeLeaseTable};
use crate::office_view_sessions::OfficeDocumentLease;
use crate::office_view_runtime::OfficeWork;

pub use crate::office_pool_actor::{
    JobContextWork, OfficeReadActor, OfficeReadSessionFactory,
    OFFICE_BRIDGE_TRANSPORT, OFFICE_READ_IDLE_SECONDS,
};

/// Settings the coordinator validates before building a pool.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OfficeWarmOptions {
    pub keep_warm: bool,
    pub idle_seconds: u16,
}

impl OfficeWarmOptions {
    /// The UI exposes only the fixed 60 s diagnostic value.
    pub fn new(keep_warm: bool, idle_seconds: u16) -> Result<Self, String> {
        if idle_seconds != OFFICE_READ_IDLE_SECONDS {
            return Err("office.bad_request".to_string());
        }
        Ok(Self {
            keep_warm,
            idle_seconds,
        })
    }

    pub fn default_options() -> Self {
        Self {
            keep_warm: true,
            idle_seconds: OFFICE_READ_IDLE_SECONDS,
        }
    }
}

struct PoolState {
    actor: Option<Box<dyn OfficeReadActor>>,
    table: OfficeLeaseTable,
    idle_since: Option<u64>,
}

/// The app-wide warm pool. One instance exists per `EngineHost`; the engine
/// itself enforces the global actor count.
pub struct OfficeReadPool {
    factory: Arc<dyn OfficeReadSessionFactory>,
    state: Mutex<PoolState>,
    keep_warm: bool,
    idle_seconds: u16,
}

impl OfficeReadPool {
    pub fn new(
        factory: Arc<dyn OfficeReadSessionFactory>,
        options: OfficeWarmOptions,
    ) -> Result<Self, String> {
        let options = OfficeWarmOptions::new(options.keep_warm, options.idle_seconds)?;
        Ok(Self {
            factory,
            state: Mutex::new(PoolState {
                actor: None,
                table: OfficeLeaseTable::default(),
                idle_since: None,
            }),
            keep_warm: options.keep_warm,
            idle_seconds: options.idle_seconds,
        })
    }

    /// Open one read-only document. The caller keeps the returned document ID
    /// as this viewer's lease.
    pub fn open(
        &self,
        input: EngineInput,
        format: OfficeFormat,
        context: &JobContext,
    ) -> Result<EngineReadDocument, String> {
        self.open_with_work(input, format, &JobContextWork(context))
    }

    /// Testable form: all slow work runs outside the state lock except the
    /// actor call itself, which is the actor's serialized boundary.
    pub fn open_with_work(
        &self,
        input: EngineInput,
        format: OfficeFormat,
        work: &dyn OfficeWork,
    ) -> Result<EngineReadDocument, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "office.engine_failed".to_string())?;
        self.ensure_actor(&mut state, work)?;
        loop {
            match state.table.admission() {
                Admission::Admitted => break,
                Admission::NeedsEviction(id) => {
                    let actor = state
                        .actor
                        .as_mut()
                        .ok_or_else(|| "office.engine_failed".to_string())?;
                    actor.close_document(id, work)?;
                    state.table.remove(id);
                }
                Admission::Busy => return Err("engines.busy".to_string()),
            }
        }
        let actor = state
            .actor
            .as_mut()
            .ok_or_else(|| "office.engine_failed".to_string())?;
        let document = actor.open_document(input, format, work)?;
        state
            .table
            .insert(document.clone(), unix_now())
            .map_err(|error| error.to_string())?;
        state.idle_since = None;
        Ok(document)
    }

    pub fn render(
        &self,
        request: &OfficeSessionRenderRequest,
        context: &JobContext,
    ) -> Result<RenderedOffice, String> {
        self.render_with_work(request, &JobContextWork(context))
    }

    pub fn render_with_work(
        &self,
        request: &OfficeSessionRenderRequest,
        work: &dyn OfficeWork,
    ) -> Result<RenderedOffice, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "office.engine_failed".to_string())?;
        self.ensure_actor(&mut state, work)?;
        state
            .table
            .retain(request.document_id, unix_now())
            .map_err(|error| error.to_string())?;
        let actor = state
            .actor
            .as_mut()
            .ok_or_else(|| "office.engine_failed".to_string())?;
        let result = actor.render_document(request, work);
        let _ = state.table.release(request.document_id, unix_now());
        if result.is_err() {
            // A dead/invalid actor invalidates every handle it owned. The
            // viewer sessions will answer office.changed and reopen normally.
            state.table = OfficeLeaseTable::default();
            state.actor = None;
        }
        result
    }

    /// Idempotent close of one viewer/document. Unknown IDs are already
    /// closed. The actor document closes only after the last lease.
    pub fn close_document(
        &self,
        document_id: Uuid,
        context: &JobContext,
    ) -> Result<(), String> {
        self.close_document_with_work(document_id, &JobContextWork(context))
    }

    pub fn close_document_with_work(
        &self,
        document_id: Uuid,
        work: &dyn OfficeWork,
    ) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "office.engine_failed".to_string())?;
        let zero = match state.table.release(document_id, unix_now()) {
            Ok(zero) => zero,
            Err(_) => return Ok(()),
        };
        if !zero {
            return Ok(());
        }
        if let Some(actor) = state.actor.as_mut() {
            if let Err(error) = actor.close_document(document_id, work) {
                state.table = OfficeLeaseTable::default();
                state.actor = None;
                return Err(error);
            }
        }
        state.table.remove(document_id);
        if state.table.is_empty() {
            state.idle_since = Some(unix_now());
            if !self.keep_warm {
                self.close_actor(&mut state)?;
            }
        }
        Ok(())
    }

    /// Shutdown adapter used by the viewer session lease. If no work context
    /// is available it closes the whole actor when no documents remain; an
    /// unleased document that shares a live actor remains bounded and is
    /// closed by the next fifth-open eviction or the actor's own close.
    pub fn close_document_detached(&self, document_id: Uuid) {
        let mut state = match self.state.lock() {
            Ok(state) => state,
            Err(_) => return,
        };
        if let Ok(true) = state.table.release(document_id, unix_now()) {
            state.table.remove(document_id);
            if state.table.is_empty() {
                state.idle_since = Some(unix_now());
                if !self.keep_warm {
                    let _ = self.close_actor(&mut state);
                }
            }
        }
    }

    /// Close documents idle for at least the fixed 60 s. The caller invokes
    /// this from a bounded maintenance tick.
    pub fn sweep_idle(&self) -> Result<usize, String> {
        self.sweep_idle_at(unix_now())
    }

    /// Testable idle sweep with an injected monotonic clock value.
    pub fn sweep_idle_at(&self, now: u64) -> Result<usize, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "office.engine_failed".to_string())?;
        if !self.keep_warm || !state.table.is_empty() {
            return Ok(0);
        }
        let Some(since) = state.idle_since else {
            return Ok(0);
        };
        if now.saturating_sub(since) < self.idle_seconds as u64 {
            return Ok(0);
        }
        self.close_actor(&mut state)?;
        Ok(1)
    }

    /// Test seam for the lease/admission rules. Production always obtains a
    /// document from the actor; this never substitutes for a real open.
    #[cfg(test)]
    pub fn admit_prepared_for_test(
        &self,
        document: EngineReadDocument,
        work: &dyn OfficeWork,
    ) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "office.engine_failed".to_string())?;
        self.ensure_actor(&mut state, work)?;
        match state.table.admission() {
            Admission::Admitted => {}
            Admission::NeedsEviction(id) => {
                let actor = state
                    .actor
                    .as_mut()
                    .ok_or_else(|| "office.engine_failed".to_string())?;
                actor.close_document(id, work)?;
                state.table.remove(id);
            }
            Admission::Busy => return Err("engines.busy".to_string()),
        }
        state.table.insert(document, unix_now())
    }

    pub fn close_all(&self) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "office.engine_failed".to_string())?;
        self.close_actor(&mut state)
    }

    pub fn document_count(&self) -> usize {
        self.state.lock().map(|state| state.table.len()).unwrap_or(0)
    }
    #[cfg(test)]
    pub fn idle_since_for_test(&self) -> Option<u64> {
        self.state.lock().ok().and_then(|state| state.idle_since)
    }
    pub fn source_identity(&self, document_id: Uuid) -> Option<(u64, Option<Uuid>)> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.table.source_identity(document_id))
    }

    pub fn derived_pdf_identity(
        &self,
        document: &EngineReadDocument,
        fallback: Uuid,
    ) -> DerivedPdfIdentity {
        DerivedPdfIdentity::from_read_document(document, fallback)
    }

    pub fn bridge_transport() -> &'static str {
        OFFICE_BRIDGE_TRANSPORT
    }

    fn ensure_actor(&self, state: &mut PoolState, work: &dyn OfficeWork) -> Result<(), String> {
        if state.actor.is_none() {
            state.actor = Some(self.factory.start(work)?);
        }
        Ok(())
    }

    fn close_actor(&self, state: &mut PoolState) -> Result<(), String> {
        let Some(mut actor) = state.actor.take() else {
            state.idle_since = None;
            return Ok(());
        };
        let result = actor.close();
        state.table = OfficeLeaseTable::default();
        state.idle_since = None;
        result
    }
}

impl Drop for OfficeReadPool {
    fn drop(&mut self) {
        if let Ok(mut state) = self.state.lock() {
            let _ = self.close_actor(&mut state);
        }
    }
}

/// A viewer's retained pool lease. It is separate from T1's registry so the
/// registry can be tested without an engine.
pub struct OfficePoolLease {
    pool: Arc<OfficeReadPool>,
    document_id: Uuid,
    closed: AtomicBool,
}

impl OfficePoolLease {
    pub fn new(pool: Arc<OfficeReadPool>, document_id: Uuid) -> Self {
        Self {
            pool,
            document_id,
            closed: AtomicBool::new(false),
        }
    }

    pub fn document_id(&self) -> Uuid {
        self.document_id
    }
}

impl OfficeDocumentLease for OfficePoolLease {
    fn close(&self) {
        if !self.closed.swap(true, Ordering::SeqCst) {
            self.pool.close_document_detached(self.document_id);
        }
    }
}


fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|age| age.as_secs())
        .unwrap_or(0)
}

#[cfg(test)]
#[path = "office_pool_step13_tests.rs"]
mod step13_tests;
