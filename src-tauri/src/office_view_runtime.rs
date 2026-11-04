//! Injected producers for a read-only Office session.
#![allow(dead_code)]

use uuid::Uuid;

use crate::office_view_types::{OfficeCellPage, OfficeCommentPage, OfficePage};

/// Work signals available to a runtime without exposing a Tauri `JobContext`
/// inside the pure registry tests. The production adapter supplies the real
/// job context through `job_context()`.
pub trait OfficeWork: Send + Sync {
    fn cancelled(&self) -> bool;
    fn progress(&self, done: usize, total: usize);
    fn job_context(&self) -> Option<&crate::jobs::JobContext> {
        None
    }
}

/// A no-op context for shutdown/idle paths only.
pub struct NoOfficeWork;

impl OfficeWork for NoOfficeWork {
    fn cancelled(&self) -> bool {
        false
    }

    fn progress(&self, _done: usize, _total: usize) {}
}

/// The per-session page, comment and cell provider. T4 implements this with
/// T2's quick helper and T3's accurate pool.
pub trait OfficeViewRuntime: Send + Sync {
    fn text(
        &self,
        _section: &str,
        _page: u32,
        _work: &dyn OfficeWork,
    ) -> Result<crate::office_view_types::OfficeLayoutText, String> {
        Err("office.unsupported".into())
    }
    fn page(
        &self,
        section_id: &str,
        page: u32,
        scale: f64,
        work: &dyn OfficeWork,
    ) -> Result<OfficePage, String>;
    fn comments(&self, section_id: &str, cursor: Option<Uuid>)
        -> Result<OfficeCommentPage, String>;
    fn cells(
        &self,
        section_id: &str,
        row_start: u32,
        row_count: u32,
        column_start: u32,
        column_count: u32,
    ) -> Result<OfficeCellPage, String>;
    fn close(&self);
}

/// The engine/document lifetime retained by one viewer session.
pub trait OfficeDocumentLease: Send + Sync {
    fn close(&self);
}
