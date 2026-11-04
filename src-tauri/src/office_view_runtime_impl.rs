//! The small quick/accurate producer seam used by the Office commands.

use std::path::PathBuf;
use std::sync::Arc;

use uuid::Uuid;

use crate::office_view_runtime::{OfficeViewRuntime, OfficeWork};
use crate::office_view_types::{
    OfficeCellPage, OfficeCommentPage, OfficePage, OfficeSection, OfficeSectionKind,
};

pub trait OfficeQuickPageSource: Send + Sync {
    fn page(&self, section_id: &str, page: u32, scale: f64) -> Result<OfficePage, String>;
    fn comments(&self, section_id: &str, cursor: Option<Uuid>)
        -> Result<OfficeCommentPage, String>;
    fn close(&self);
}

pub trait OfficeAccuratePageSource: Send + Sync {
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
    fn close(&self);
}

pub struct OfficeRuntimeImpl {
    pub section_list: Vec<OfficeSection>,
    pub sheet_path: Option<PathBuf>,
    pub quick: Option<Arc<dyn OfficeQuickPageSource>>,
    pub accurate: Option<Arc<dyn OfficeAccuratePageSource>>,
}

impl OfficeRuntimeImpl {
    pub fn new(
        section_list: Vec<OfficeSection>,
        sheet_path: Option<PathBuf>,
        quick: Option<Arc<dyn OfficeQuickPageSource>>,
        accurate: Option<Arc<dyn OfficeAccuratePageSource>>,
    ) -> Self {
        Self {
            section_list,
            sheet_path,
            quick,
            accurate,
        }
    }

    fn page_from_quick(
        &self,
        section_id: &str,
        page: u32,
        scale: f64,
    ) -> Result<OfficePage, String> {
        self.quick
            .as_ref()
            .ok_or_else(|| "office.pack_missing".to_string())?
            .page(section_id, page, scale)
    }

    fn page_from_accurate(
        &self,
        section_id: &str,
        page: u32,
        scale: f64,
        work: &dyn OfficeWork,
    ) -> Result<OfficePage, String> {
        self.accurate
            .as_ref()
            .ok_or_else(|| "office.pack_missing".to_string())?
            .page(section_id, page, scale, work)
    }
}

impl OfficeViewRuntime for OfficeRuntimeImpl {
    fn text(
        &self,
        section: &str,
        page: u32,
        work: &dyn OfficeWork,
    ) -> Result<crate::office_view_types::OfficeLayoutText, String> {
        self.accurate
            .as_ref()
            .ok_or("office.pack_missing")?
            .text(section, page, work)
    }
    fn page(
        &self,
        section_id: &str,
        page: u32,
        scale: f64,
        work: &dyn OfficeWork,
    ) -> Result<OfficePage, String> {
        match self.page_from_accurate(section_id, page, scale, work) {
            Ok(page) => Ok(page),
            Err(error) if error == "office.pack_missing" => {
                self.page_from_quick(section_id, page, scale)
            }
            Err(error) => Err(error),
        }
    }

    fn comments(
        &self,
        section_id: &str,
        cursor: Option<Uuid>,
    ) -> Result<OfficeCommentPage, String> {
        if let Some(quick) = &self.quick {
            return quick.comments(section_id, cursor);
        }
        Ok(OfficeCommentPage {
            items: Vec::new(),
            next_cursor: None,
            complete: true,
        })
    }

    fn cells(
        &self,
        section_id: &str,
        row_start: u32,
        row_count: u32,
        column_start: u32,
        column_count: u32,
    ) -> Result<OfficeCellPage, String> {
        let section = self
            .section_list
            .iter()
            .find(|section| section.id == section_id)
            .ok_or_else(|| "office.bad_request".to_string())?;
        if section.kind != OfficeSectionKind::Sheet {
            return Err("office.bad_request".to_string());
        }
        let Some(path) = &self.sheet_path else {
            return Err("office.pack_missing".to_string());
        };
        crate::office_sheet::read_sheet_page_via_helper(
            path,
            section.index,
            row_start,
            row_count,
            column_start,
            column_count,
        )
    }

    fn close(&self) {
        if let Some(quick) = &self.quick {
            quick.close();
        }
        if let Some(accurate) = &self.accurate {
            accurate.close();
        }
    }
}
