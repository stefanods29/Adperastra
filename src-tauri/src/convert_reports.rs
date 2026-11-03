//! Bounded, cursor-paged conversion reports (Step 08a T4).
//!
//! A report never travels in one response: at most 256 item rows, 256 output
//! rows and roughly 768 KiB per page. The cursor privately holds both row
//! offsets; the UI sees only an opaque UUID.

use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, MutexGuard};

use convert::{ConversionOutput, ConversionReport, WorkItemResult, WorkItemStatus};
use uuid::Uuid;

const MAX_REPORTS: usize = 16;
const MAX_CURSORS: usize = 64;
const PAGE_ROWS: usize = 256;
const PAGE_BYTES: usize = 700 * 1024;

pub struct StoredReport {
    pub report_id: String,
    pub items: Vec<WorkItemResult>,
    pub outputs: Vec<ConversionOutput>,
    pub input_total: u32,
    pub done_count: u32,
    pub failed_count: u32,
    pub skipped_count: u32,
    pub cancelled_count: u32,
    pub outputs_created: u32,
    pub cancelled: bool,
}

impl StoredReport {
    pub fn new(
        items: Vec<WorkItemResult>,
        outputs: Vec<ConversionOutput>,
        cancelled: bool,
    ) -> Self {
        let done_count = items
            .iter()
            .filter(|item| item.status == WorkItemStatus::Done)
            .count() as u32;
        let failed_count = items
            .iter()
            .filter(|item| item.status == WorkItemStatus::Failed)
            .count() as u32;
        let skipped_count = items
            .iter()
            .filter(|item| item.status == WorkItemStatus::Skipped)
            .count() as u32;
        let cancelled_count = items
            .iter()
            .filter(|item| item.status == WorkItemStatus::Cancelled)
            .count() as u32;
        let input_total = items.len() as u32;
        let outputs_created = outputs.len() as u32;
        Self {
            report_id: Uuid::new_v4().to_string(),
            items,
            outputs,
            input_total,
            done_count,
            failed_count,
            skipped_count,
            cancelled_count,
            outputs_created,
            cancelled,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct CursorPos {
    report: Uuid,
    item_offset: usize,
    output_offset: usize,
}

/// The managed report store.
#[derive(Default)]
pub struct ConversionReports {
    order: Mutex<VecDeque<Uuid>>,
    reports: Mutex<HashMap<Uuid, StoredReport>>,
    cursors: Mutex<HashMap<Uuid, CursorPos>>,
}

impl ConversionReports {
    fn order_lock(&self) -> Result<MutexGuard<'_, VecDeque<Uuid>>, String> {
        self.order.lock().map_err(|_| "convert.io".to_string())
    }

    fn reports_lock(&self) -> Result<MutexGuard<'_, HashMap<Uuid, StoredReport>>, String> {
        self.reports.lock().map_err(|_| "convert.io".to_string())
    }

    fn cursors_lock(&self) -> Result<MutexGuard<'_, HashMap<Uuid, CursorPos>>, String> {
        self.cursors.lock().map_err(|_| "convert.io".to_string())
    }

    /// Store one finished report and return its first page.
    pub fn insert(&self, report: StoredReport) -> Result<ConversionReport, String> {
        let id = Uuid::parse_str(&report.report_id).map_err(|_| "convert.io".to_string())?;
        {
            let mut reports = self.reports_lock()?;
            reports.insert(id, report);
            let mut order = self.order_lock()?;
            order.push_back(id);
            while order.len() > MAX_REPORTS {
                if let Some(oldest) = order.pop_front() {
                    reports.remove(&oldest);
                }
            }
        }
        self.page_for(id, 0, 0)
    }

    /// The next page of a report.
    pub fn page(&self, cursor: &str) -> Result<ConversionReport, String> {
        let cursor_id = Uuid::parse_str(cursor).map_err(|_| "convert.bad_request".to_string())?;
        let position = self
            .cursors_lock()?
            .get(&cursor_id)
            .copied()
            .ok_or_else(|| "convert.bad_request".to_string())?;
        self.page_for(
            position.report,
            position.item_offset,
            position.output_offset,
        )
    }

    fn page_for(
        &self,
        id: Uuid,
        item_offset: usize,
        output_offset: usize,
    ) -> Result<ConversionReport, String> {
        let report = self
            .reports_lock()?
            .get(&id)
            .map(StoredReportPage::from)
            .ok_or_else(|| "convert.bad_request".to_string())?;
        let mut items = Vec::new();
        let mut bytes = 0usize;
        let mut next_item = item_offset;
        while next_item < report.items.len() && items.len() < PAGE_ROWS {
            let row = &report.items[next_item];
            let size = serde_json::to_vec(row)
                .map(|value| value.len())
                .unwrap_or(0);
            if !items.is_empty() && bytes + size > PAGE_BYTES {
                break;
            }
            bytes += size;
            items.push(row.clone());
            next_item += 1;
        }
        let mut outputs = Vec::new();
        let mut next_output = output_offset;
        while next_output < report.outputs.len() && outputs.len() < PAGE_ROWS {
            let row = &report.outputs[next_output];
            let size = serde_json::to_vec(row)
                .map(|value| value.len())
                .unwrap_or(0);
            if !outputs.is_empty() && bytes + size > PAGE_BYTES {
                break;
            }
            bytes += size;
            outputs.push(row.clone());
            next_output += 1;
        }
        let more = next_item < report.items.len() || next_output < report.outputs.len();
        let next_cursor = if more {
            Some(self.new_cursor(id, next_item, next_output)?)
        } else {
            None
        };
        Ok(ConversionReport {
            report_id: report.report_id.clone(),
            items,
            outputs,
            next_cursor,
            created_paths: report
                .outputs
                .iter()
                .skip(output_offset)
                .take(next_output - output_offset)
                .map(|row| row.path.clone())
                .collect(),
            history_id: Some(report.report_id.clone()),
            input_total: report.input_total,
            done_count: report.done_count,
            failed_count: report.failed_count,
            skipped_count: report.skipped_count,
            cancelled_count: report.cancelled_count,
            outputs_created: report.outputs_created,
            cancelled: report.cancelled,
            job_finished: true,
            complete: !more,
        })
    }

    fn new_cursor(
        &self,
        report: Uuid,
        item_offset: usize,
        output_offset: usize,
    ) -> Result<String, String> {
        let mut cursors = self.cursors_lock()?;
        if cursors.len() >= MAX_CURSORS {
            if let Some(oldest) = cursors.keys().next().copied() {
                cursors.remove(&oldest);
            }
        }
        let id = Uuid::new_v4();
        cursors.insert(
            id,
            CursorPos {
                report,
                item_offset,
                output_offset,
            },
        );
        Ok(id.to_string())
    }
}

/// A cloned view so the page builder never holds the store lock.
struct StoredReportPage {
    report_id: String,
    items: Vec<WorkItemResult>,
    outputs: Vec<ConversionOutput>,
    input_total: u32,
    done_count: u32,
    failed_count: u32,
    skipped_count: u32,
    cancelled_count: u32,
    outputs_created: u32,
    cancelled: bool,
}

impl From<&StoredReport> for StoredReportPage {
    fn from(report: &StoredReport) -> Self {
        Self {
            report_id: report.report_id.clone(),
            items: report.items.clone(),
            outputs: report.outputs.clone(),
            input_total: report.input_total,
            done_count: report.done_count,
            failed_count: report.failed_count,
            skipped_count: report.skipped_count,
            cancelled_count: report.cancelled_count,
            outputs_created: report.outputs_created,
            cancelled: report.cancelled,
        }
    }
}
