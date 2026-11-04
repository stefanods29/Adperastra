//! The fixed 12b actor/factory seam used by the warm Office pool.
//!
//! This module does not spawn a process. It forwards `EngineHost.start_session`
//! and the exact `EngineSession` methods; the native parent keeps the one
//! AppContainer/pack-lease authority.
#![allow(dead_code)]


use std::sync::atomic::Ordering;
use std::sync::Arc;

use uuid::Uuid;

use crate::engine_process::EngineHost;
use crate::engine_session_types::{
    EngineReadDocument, EngineSessionStart, OfficeSessionRenderRequest, SessionProtocol,
};
use crate::engine_sessions::EngineSession;
use crate::engine_types::{EngineInput, OfficeFormat, RenderedOffice};
use crate::jobs::JobContext;
use crate::office_view_runtime::OfficeWork;
use crate::office_pool_leases::OFFICE_POOL_MAX_DOCUMENTS;

pub const OFFICE_READ_PROTOCOL: &str = "office_read_v1";
pub const OFFICE_READ_IDLE_SECONDS: u16 = 60;
pub const OFFICE_READ_MEMORY_BYTES: u64 = 1_073_741_824;
pub const OFFICE_BRIDGE_TRANSPORT: &str = "stdio-private";

pub struct JobContextWork<'a>(pub &'a JobContext);

impl OfficeWork for JobContextWork<'_> {
    fn cancelled(&self) -> bool {
        self.0.token().load(Ordering::Relaxed)
    }

    fn progress(&self, done: usize, total: usize) {
        self.0.set_progress(&fs_service::OpProgress {
            items_done: done,
            items_total: total,
            bytes_done: 0,
            bytes_total: 0,
            current: String::new(),
        });
    }

    fn job_context(&self) -> Option<&JobContext> {
        Some(self.0)
    }
}

pub trait OfficeReadActor: Send {
    fn open_document(
        &mut self,
        input: EngineInput,
        format: OfficeFormat,
        work: &dyn OfficeWork,
    ) -> Result<EngineReadDocument, String>;
    fn render_document(
        &mut self,
        request: &OfficeSessionRenderRequest,
        work: &dyn OfficeWork,
    ) -> Result<RenderedOffice, String>;
    fn close_document(&mut self, document_id: Uuid, work: &dyn OfficeWork) -> Result<(), String>;
    fn close(&mut self) -> Result<(), String>;
}

pub trait OfficeReadSessionFactory: Send + Sync {
    fn start(&self, work: &dyn OfficeWork) -> Result<Box<dyn OfficeReadActor>, String>;
}

pub struct EngineHostSessionFactory {
    host: Arc<EngineHost>,
}

impl EngineHostSessionFactory {
    pub fn new(host: Arc<EngineHost>) -> Self {
        Self { host }
    }

    pub fn fixed_start() -> EngineSessionStart {
        EngineSessionStart {
            protocol: SessionProtocol::OfficeReadV1,
            max_documents: OFFICE_POOL_MAX_DOCUMENTS as u8,
            idle_seconds: OFFICE_READ_IDLE_SECONDS,
            memory_bytes: OFFICE_READ_MEMORY_BYTES,
        }
    }
}

struct EngineSessionActor {
    session: EngineSession,
}

impl OfficeReadActor for EngineSessionActor {
    fn open_document(
        &mut self,
        input: EngineInput,
        format: OfficeFormat,
        work: &dyn OfficeWork,
    ) -> Result<EngineReadDocument, String> {
        let context = work
            .job_context()
            .ok_or_else(|| "office.engine_failed".to_string())?;
        self.session.open_document(input, format, context)
    }

    fn render_document(
        &mut self,
        request: &OfficeSessionRenderRequest,
        work: &dyn OfficeWork,
    ) -> Result<RenderedOffice, String> {
        let context = work
            .job_context()
            .ok_or_else(|| "office.engine_failed".to_string())?;
        self.session.render_document(request, context)
    }

    fn close_document(&mut self, document_id: Uuid, work: &dyn OfficeWork) -> Result<(), String> {
        let context = work
            .job_context()
            .ok_or_else(|| "office.engine_failed".to_string())?;
        self.session.close_document(document_id, context)
    }

    fn close(&mut self) -> Result<(), String> {
        self.session.close()
    }
}

impl OfficeReadSessionFactory for EngineHostSessionFactory {
    fn start(&self, work: &dyn OfficeWork) -> Result<Box<dyn OfficeReadActor>, String> {
        let context = work
            .job_context()
            .ok_or_else(|| "office.engine_failed".to_string())?;
        let session = self
            .host
            .start_session(EngineHostSessionFactory::fixed_start(), context)?;
        Ok(Box::new(EngineSessionActor { session }))
    }
}
