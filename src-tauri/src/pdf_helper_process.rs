#![allow(dead_code)] // Public producer API; consumed from Step 07e onward.
//! The parent's persistent PDF helper (Step 07d D2/D3/D5).
//!
//! One PDF is loaded per child. The session is kept across requests, so the
//! document is parsed once and later pages are cheap. Every answer is
//! revalidated here: the page and revision in the reply must match the
//! request, the PNG must be a PNG of the announced size, and its length must
//! stay inside the per-page cap.

use std::path::PathBuf;
use std::sync::Arc;

use fs_service::CancellationToken;
use uuid::Uuid;

use crate::pdf_helper_types::{
    outline_nodes_within, PdfHelperOpenReply, PdfHelperOpenRequest, PdfHelperOutlineReply,
    PdfHelperOutlineRequest, PdfHelperPrintReply, PdfHelperPrintRequest, PdfHelperRenderReply,
    PdfHelperRenderRequest, PdfHelperSearchReply, PdfHelperSearchRequest, PdfHelperTextReply,
    PdfHelperTextRequest,
};
use crate::pdf_types::{
    PdfPageInfo, PdfPermissions, PdfRasterSpec, PdfRotation, PdfSourceIdentity, PdfTextDirection,
    PDF_MAX_PNG_BYTES, PDF_MAX_PRINT_PAGES, PDF_PRINT_DPI,
};
use crate::webview_helper::WebviewHelperSession;
use crate::webview_helper_types::{
    HelperAction, HelperInputGrant, HelperOutputSpec, HelperOutputStorage, WebviewHelperRequest,
};

/// Where a verified page body lives: an owned staging file for an ordinary
/// document, zeroizing memory for a sensitive one (E8).
pub enum RenderedBytes {
    File(fs_service::owned_io::OwnedOutput),
    Memory(zeroize::Zeroizing<Vec<u8>>),
}

impl RenderedBytes {
    pub fn length(&mut self) -> u64 {
        match self {
            RenderedBytes::File(output) => {
                output.file_mut().metadata().map(|m| m.len()).unwrap_or(0)
            }
            RenderedBytes::Memory(bytes) => bytes.len() as u64,
        }
    }

    /// The owned file, for a cache publication that must not reopen a path.
    pub fn as_file(&mut self) -> Option<&std::fs::File> {
        match self {
            RenderedBytes::File(output) => Some(output.file_mut()),
            RenderedBytes::Memory(_) => None,
        }
    }

    /// The bytes themselves (memory leases and PNG validation).
    pub fn read_vec(&mut self) -> Result<Vec<u8>, String> {
        match self {
            RenderedBytes::File(output) => {
                use std::io::{Read, Seek, SeekFrom};
                let file = output.file_mut();
                file.seek(SeekFrom::Start(0))
                    .map_err(|_| "helper.failed".to_string())?;
                let mut bytes = Vec::new();
                file.take(PDF_MAX_PNG_BYTES + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|_| "helper.failed".to_string())?;
                Ok(bytes)
            }
            RenderedBytes::Memory(bytes) => Ok(bytes.to_vec()),
        }
    }
}

/// One verified page render, ready for the cache or a memory lease.
pub struct RenderedPage {
    pub info: PdfPageInfo,
    pub png: RenderedBytes,
    pub width: u32,
    pub height: u32,
    pub scale: f64,
    pub rotation: PdfRotation,
    pub request_revision: u32,
}

/// One open PDF child.
pub struct PdfHelperProcess {
    session: WebviewHelperSession,
    pub identity: PdfSourceIdentity,
    pub page_count: u32,
    pub permissions: PdfPermissions,
    /// Keeps an immutable snapshot alive until this child closes (E9).
    _retention: Option<Arc<dyn crate::pdf_snapshot_resolver::PdfSnapshotRetention>>,
}

impl PdfHelperProcess {
    /// Open the granted PDF and keep the child for later pages.
    pub fn start(
        grant: HelperInputGrant,
        identity: PdfSourceIdentity,
        data_dir: PathBuf,
        password: Option<String>,
        retention: Option<Arc<dyn crate::pdf_snapshot_resolver::PdfSnapshotRetention>>,
        cancel: CancellationToken,
    ) -> Result<PdfHelperProcess, String> {
        let config = crate::pdf_helper::helper_config(data_dir);
        let mut session = crate::webview_helper::start_webview_helper(
            config,
            vec![grant.clone()],
            cancel.clone(),
        )?;
        let open = PdfHelperOpenRequest {
            grant_id: grant.grant_id,
            password,
        };
        if !open.is_valid() {
            let _ = session.close();
            return Err("pdf.bad_request".to_string());
        }
        let request = WebviewHelperRequest {
            request_id: Uuid::new_v4(),
            action: HelperAction::PdfOpen,
            payload: serde_json::to_value(&open).map_err(|_| "pdf.bad_request".to_string())?,
            output_specs: Vec::new(),
        };
        let answer = match session.request(request, cancel) {
            Ok(answer) => answer,
            Err(error) => {
                let _ = session.close();
                return Err(map_open_error(&error));
            }
        };
        let reply: PdfHelperOpenReply =
            serde_json::from_value(answer.reply).map_err(|_| "pdf.corrupt".to_string())?;
        if reply.page_count == 0 || reply.page_count > crate::pdf_types::PDF_MAX_PAGES {
            let _ = session.close();
            return Err("pdf.too_large".to_string());
        }
        let sensitive = identity.is_sensitive();
        Ok(PdfHelperProcess {
            session,
            identity,
            page_count: reply.page_count,
            permissions: PdfPermissions {
                // A sensitive snapshot never offers clipboard or printer.
                can_copy: reply.can_copy && !sensitive,
                can_print: reply.can_print && !sensitive,
            },
            _retention: retention,
        })
    }

    pub fn is_closed(&self) -> bool {
        self.session.is_closed()
    }

    pub fn is_sensitive(&self) -> bool {
        self.identity.is_sensitive()
    }

    /// Render one page; the PNG is validated before the caller sees it.
    pub fn render(
        &mut self,
        page: u32,
        raster: PdfRasterSpec,
        rotation: PdfRotation,
        request_revision: u32,
        cancel: CancellationToken,
    ) -> Result<RenderedPage, String> {
        if page < 1 || page > self.page_count || !raster.is_valid() || request_revision == 0 {
            return Err("pdf.bad_request".to_string());
        }
        let request = WebviewHelperRequest {
            request_id: Uuid::new_v4(),
            action: HelperAction::PdfRender,
            payload: serde_json::to_value(PdfHelperRenderRequest {
                page,
                raster,
                rotation,
                request_revision,
            })
            .map_err(|_| "pdf.bad_request".to_string())?,
            output_specs: vec![HelperOutputSpec {
                mime: "image/png".to_string(),
                max_bytes: PDF_MAX_PNG_BYTES,
            }],
        };
        let answer = self.session.request(request, cancel)?;
        let reply: PdfHelperRenderReply =
            serde_json::from_value(answer.reply).map_err(|_| "pdf.corrupt".to_string())?;
        if reply.info.page != page
            || reply.request_revision != request_revision
            || reply.rendered_rotation != rotation
            || !reply.info.is_valid()
            || reply.render_width == 0
            || reply.render_height == 0
            || !reply.resolved_scale.is_finite()
            || reply.resolved_scale <= 0.0
        {
            return Err("pdf.changed".to_string());
        }
        // The helper's own size math must equal the parent's.
        let expected = crate::pdf_types::raster_size(&reply.info, raster, rotation)?;
        if expected.width != reply.render_width || expected.height != reply.render_height {
            return Err("pdf.changed".to_string());
        }
        let mut outputs = answer.outputs;
        let Some(output) = outputs.pop() else {
            return Err("helper.failed".to_string());
        };
        if !outputs.is_empty() || output.mime != "image/png" {
            return Err("helper.failed".to_string());
        }
        let mut png = match output.storage {
            HelperOutputStorage::Memory(bytes) => RenderedBytes::Memory(bytes),
            HelperOutputStorage::OwnedFile(file) => RenderedBytes::File(file),
        };
        let bytes_for_check = png.read_vec()?;
        if bytes_for_check.len() as u64 > PDF_MAX_PNG_BYTES {
            return Err("pdf.too_large".to_string());
        }
        match png_dimensions(&bytes_for_check) {
            Some((width, height))
                if width == reply.render_width && height == reply.render_height => {}
            _ => return Err("pdf.corrupt".to_string()),
        }
        Ok(RenderedPage {
            info: PdfPageInfo {
                page,
                rotation: reply.info.rotation,
                ..reply.info
            },
            png,
            width: reply.render_width,
            height: reply.render_height,
            scale: reply.resolved_scale,
            rotation: reply.rendered_rotation,
            request_revision: reply.request_revision,
        })
    }

    pub fn text(
        &mut self,
        page: u32,
        after_run: Option<u32>,
        cancel: CancellationToken,
    ) -> Result<PdfHelperTextReply, String> {
        if page < 1 || page > self.page_count {
            return Err("pdf.bad_request".to_string());
        }
        let request = WebviewHelperRequest {
            request_id: Uuid::new_v4(),
            action: HelperAction::PdfText,
            payload: serde_json::to_value(PdfHelperTextRequest { page, after_run })
                .map_err(|_| "pdf.bad_request".to_string())?,
            output_specs: Vec::new(),
        };
        let answer = self.session.request(request, cancel)?;
        let reply: PdfHelperTextReply =
            serde_json::from_value(answer.reply).map_err(|_| "pdf.corrupt".to_string())?;
        if reply.page != page || !reply.is_valid() {
            return Err("pdf.changed".to_string());
        }
        Ok(normalize_text_reply(reply))
    }

    pub fn outline(
        &mut self,
        offset: u32,
        cancel: CancellationToken,
    ) -> Result<PdfHelperOutlineReply, String> {
        let request = WebviewHelperRequest {
            request_id: Uuid::new_v4(),
            action: HelperAction::PdfOutline,
            payload: serde_json::to_value(PdfHelperOutlineRequest { offset })
                .map_err(|_| "pdf.bad_request".to_string())?,
            output_specs: Vec::new(),
        };
        let answer = self.session.request(request, cancel)?;
        let reply: PdfHelperOutlineReply =
            serde_json::from_value(answer.reply).map_err(|_| "pdf.corrupt".to_string())?;
        if !outline_nodes_within(&reply, crate::pdf_types::PDF_MAX_OUTLINE_NODES) {
            return Err("pdf.too_large".to_string());
        }
        Ok(reply)
    }

    pub fn search(
        &mut self,
        query: String,
        match_case: bool,
        position: (u32, u32, u32),
        cancel: CancellationToken,
    ) -> Result<PdfHelperSearchReply, String> {
        let request_payload = PdfHelperSearchRequest {
            query,
            match_case,
            page: position.0,
            run: position.1,
            offset: position.2,
        };
        if !request_payload.is_valid() {
            return Err("pdf.bad_request".to_string());
        }
        let request = WebviewHelperRequest {
            request_id: Uuid::new_v4(),
            action: HelperAction::PdfSearch,
            payload: serde_json::to_value(&request_payload)
                .map_err(|_| "pdf.bad_request".to_string())?,
            output_specs: Vec::new(),
        };
        let answer = self.session.request(request, cancel)?;
        let reply: PdfHelperSearchReply =
            serde_json::from_value(answer.reply).map_err(|_| "pdf.corrupt".to_string())?;
        if !reply.is_valid()
            || reply
                .matches
                .iter()
                .any(|entry| entry.page < 1 || entry.page > self.page_count)
        {
            return Err("pdf.changed".to_string());
        }
        Ok(reply)
    }

    /// Print through the helper's trusted print view; no file is written.
    pub fn print(
        &mut self,
        first_page: u32,
        last_page: u32,
        cancel: CancellationToken,
    ) -> Result<bool, String> {
        if first_page < 1
            || last_page < first_page
            || last_page > self.page_count
            || last_page - first_page + 1 > PDF_MAX_PRINT_PAGES
        {
            return Err("pdf.bad_request".to_string());
        }
        if !self.permissions.can_print {
            return Err("pdf.permissions".to_string());
        }
        let request = WebviewHelperRequest {
            request_id: Uuid::new_v4(),
            action: HelperAction::PdfPrint,
            payload: serde_json::to_value(PdfHelperPrintRequest {
                first_page,
                last_page,
                dpi: PDF_PRINT_DPI,
            })
            .map_err(|_| "pdf.bad_request".to_string())?,
            output_specs: Vec::new(),
        };
        let answer = self.session.request(request, cancel)?;
        let reply: PdfHelperPrintReply =
            serde_json::from_value(answer.reply).map_err(|_| "pdf.corrupt".to_string())?;
        Ok(reply.completed)
    }

    pub fn close(mut self) {
        let _ = self.session.close();
    }
}

fn map_open_error(code: &str) -> String {
    match code {
        "helper.sensitive_unsupported" => "helper.sensitive_unsupported".to_string(),
        "helper.timeout" => "pdf.unavailable".to_string(),
        "helper.failed" => "pdf.corrupt".to_string(),
        other => other.to_string(),
    }
}

fn normalize_text_reply(mut reply: PdfHelperTextReply) -> PdfHelperTextReply {
    let mut order = 0u32;
    for run in &mut reply.runs {
        // The helper's order is already the reading order; keep it stable and
        // bounded even if a broken producer repeated one.
        if run.order == 0 && order > 0 {
            run.order = order;
        }
        if !matches!(run.direction, PdfTextDirection::Ltr | PdfTextDirection::Rtl) {
            run.direction = PdfTextDirection::Ltr;
        }
        order = run.order.saturating_add(1);
    }
    reply
}

/// PNG signature check plus IHDR width/height.
pub fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 {
        return None;
    }
    if &bytes[0..8] != b"\x89PNG\r\n\x1a\n" || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
    let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
    if width == 0 || height == 0 {
        return None;
    }
    Some((width, height))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"\x89PNG\r\n\x1a\n");
        bytes.extend_from_slice(&13u32.to_be_bytes());
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.push(8);
        bytes.push(6);
        bytes
    }

    #[test]
    fn png_dimensions_read_the_ihdr() {
        assert_eq!(png_dimensions(&png(512, 256)), Some((512, 256)));
        assert_eq!(png_dimensions(b"not a png at all"), None);
        let mut broken = png(512, 256);
        broken[12] = b'X';
        assert_eq!(png_dimensions(&broken), None);
        assert_eq!(png_dimensions(&png(0, 256)), None);
    }

    #[test]
    fn open_errors_map_to_pdf_codes() {
        assert_eq!(
            map_open_error("pdf.password_required"),
            "pdf.password_required"
        );
        assert_eq!(map_open_error("pdf.bad_password"), "pdf.bad_password");
        assert_eq!(map_open_error("helper.timeout"), "pdf.unavailable");
        assert_eq!(map_open_error("helper.failed"), "pdf.corrupt");
        assert_eq!(
            map_open_error("helper.sensitive_unsupported"),
            "helper.sensitive_unsupported"
        );
    }

    #[test]
    fn text_runs_keep_a_positive_order() {
        let reply = PdfHelperTextReply {
            page: 1,
            runs: vec![
                crate::pdf_types::PdfTextRun {
                    text: "a".to_string(),
                    x: 0.0,
                    y: 0.0,
                    width: 1.0,
                    height: 1.0,
                    direction: PdfTextDirection::Rtl,
                    font_size: 10.0,
                    order: 0,
                },
                crate::pdf_types::PdfTextRun {
                    text: "b".to_string(),
                    x: 0.0,
                    y: 0.0,
                    width: 1.0,
                    height: 1.0,
                    direction: PdfTextDirection::Ltr,
                    font_size: 10.0,
                    order: 0,
                },
            ],
            next_run: None,
            complete: true,
        };
        let normalized = normalize_text_reply(reply);
        assert_eq!(normalized.runs[0].order, 0);
        assert_eq!(normalized.runs[1].order, 1);
    }
}
