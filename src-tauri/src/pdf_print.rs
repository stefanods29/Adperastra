#![allow(dead_code)] // Public producer API; consumed from Step 07e onward.
//! PDF printing (Step 07d T6, E6).
//!
//! Printing is a user action with a bounded range: at most 100 pages, only
//! when the document allows printing, and never in a quick preview. The print
//! view lives in the helper; the page images it builds are bounded, released
//! one after another, and removed when the system print window closes. No
//! file is written and no PDF content is changed.

use tauri::{AppHandle, State, WebviewWindow};
use uuid::Uuid;

use crate::jobs::{spawn_job, Jobs};
use crate::pdf_jobs;
use crate::pdf_types::PDF_MAX_PRINT_PAGES;
use crate::{ensure_main, valid_request_id};

/// Start printing a range (E6).
#[tauri::command]
pub fn pdf_print_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    session_id: String,
    first_page: u32,
    last_page: u32,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id).map_err(|_| "pdf.bad_request".to_string())?;
    let session = Uuid::parse_str(&session_id).map_err(|_| "pdf.bad_request".to_string())?;
    if first_page < 1 || last_page < first_page || last_page - first_page + 1 > PDF_MAX_PRINT_PAGES
    {
        return Err("pdf.bad_request".to_string());
    }
    let token = jobs
        .begin(&request_id, 1)
        .map_err(|_| "pdf.bad_request".to_string())?;
    let work_app = app.clone();
    let work_token = token.clone();
    spawn_job(app, request_id, token, move |_ctx| {
        pdf_jobs::print(&work_app, &work_token, session, first_page, last_page)?;
        Ok(serde_json::Value::Null)
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The same rule as `pdfPrintRangeError` in src/services/pdf.ts.
    fn range_error(
        first: u32,
        last: u32,
        page_count: u32,
        can_print: bool,
    ) -> Option<&'static str> {
        if !can_print {
            return Some("pdf.permissions");
        }
        if first < 1 || last < first || last > page_count {
            return Some("pdf.bad_request");
        }
        if last - first + 1 > PDF_MAX_PRINT_PAGES {
            return Some("pdf.too_large");
        }
        None
    }

    #[test]
    fn a_range_over_one_hundred_pages_is_refused() {
        assert_eq!(range_error(1, 101, 500, true), Some("pdf.too_large"));
        assert_eq!(range_error(1, 100, 500, true), None);
    }

    #[test]
    fn a_document_without_print_permission_is_refused() {
        assert_eq!(range_error(1, 1, 1, false), Some("pdf.permissions"));
    }

    #[test]
    fn an_out_of_bounds_range_is_refused() {
        assert_eq!(range_error(0, 1, 3, true), Some("pdf.bad_request"));
        assert_eq!(range_error(2, 1, 3, true), Some("pdf.bad_request"));
        assert_eq!(range_error(1, 4, 3, true), Some("pdf.bad_request"));
    }
}
