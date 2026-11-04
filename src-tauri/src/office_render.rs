//! One-shot, isolated Office rendering (Step 12b E4).
//!
//! A one-shot render is a single confined `soffice.com` run (E3) whose output
//! is validated independently of the child's exit code (D8): the expected
//! file must exist, carry the target MIME, start with the real format header
//! and stay inside the size bound. A zero exit code with no PDF, or with an
//! HTML file named like a PDF, is a failure and no artifact is handed out.
//!
//! Editing is out of scope. 13's warm viewer uses `EngineSession` (E7), not
//! this function.

use std::io::{Read, Seek, SeekFrom};

use fs_service::owned_io::PinnedDirectory;
use uuid::Uuid;

use crate::engine_process::EngineHost;
use crate::engine_types::{
    EngineAction, EngineError, EngineInput, EngineOutput, EngineRequest, EngineResult,
    OfficeRenderRequest, OfficeRenderTarget, OfficeRenderedArtifact, RenderedOffice,
    OFFICE_RENDER_TIMEOUT_MS,
};
use crate::jobs::JobContext;

/// The only section ID a one-shot render produces: the whole document.
pub const DOCUMENT_SECTION_ID: &str = "document";
/// How many bytes of an artifact are read to detect its format.
pub const HEADER_BYTES: usize = 1024;

/// Render one document into owned PDF/HTML/text artifacts.
///
/// The guide's E4 signature names the request and the job context; the native
/// host and the request's private work root are passed explicitly because a
/// free function cannot reach managed native state. Nothing else differs.
pub fn render_office(
    host: &EngineHost,
    request: &OfficeRenderRequest,
    input: EngineInput,
    work_dir: PinnedDirectory,
    context: &JobContext,
) -> Result<RenderedOffice, String> {
    request.validate().map_err(|error| error.message())?;
    // The rendered pages belong to the exact source the caller authorized: a
    // snapshot keeps its revision, an unedited disk file is revision 1.
    let source_revision = input.source_revision();
    let engine_request = EngineRequest {
        request_id: Uuid::new_v4(),
        timeout_ms: OFFICE_RENDER_TIMEOUT_MS,
        work_dir,
        action: EngineAction::RenderOffice {
            inputs: vec![input],
            options: request.clone(),
        },
    };
    let run = host.run_capture(&engine_request, context)?;
    validate_one_shot_result(request, run.result, run.engine_version, source_revision)
}

/// Check what the child actually produced. Exit code 0 alone is not success.
pub fn validate_one_shot_result(
    request: &OfficeRenderRequest,
    result: EngineResult,
    engine_version: String,
    source_revision: u64,
) -> Result<RenderedOffice, String> {
    if result.exit_code != 0 {
        return Err(EngineError::Failed.message());
    }
    let mut outputs = result.outputs;
    if outputs.len() != 1 {
        // Missing or extra artifacts: no HTML mislabelled as a PDF either.
        return Err(EngineError::Failed.message());
    }
    let mut output = outputs.remove(0);
    if output.mime != request.target.mime() {
        return Err(EngineError::Failed.message());
    }
    if !output
        .relative_name
        .to_ascii_lowercase()
        .ends_with(&format!(".{}", request.target.extension()))
    {
        return Err(EngineError::Failed.message());
    }
    let prefix = read_prefix(&mut output)?;
    let page_count = match request.target {
        OfficeRenderTarget::Pdf => {
            if prefix.len() < 5 || &prefix[..5] != b"%PDF-" {
                // The child claimed success but wrote no PDF.
                return Err(EngineError::Failed.message());
            }
            crate::office_preflight::count_pdf_pages(&read_all(&mut output)?)
        }
        OfficeRenderTarget::Html => {
            if !looks_like_html(&prefix) {
                // A text or binary payload named `.html` is not an HTML render.
                return Err(EngineError::Failed.message());
            }
            1
        }
        OfficeRenderTarget::Txt => {
            if prefix.contains(&0) {
                // Plain text never contains NUL; a binary payload named
                // `.txt` is not a text render.
                return Err(EngineError::Failed.message());
            }
            1
        }
    };
    if page_count == 0 || page_count > 10_000 {
        return Err(EngineError::Failed.message());
    }
    let mut rendered = RenderedOffice {
        artifacts: vec![OfficeRenderedArtifact {
            output,
            section_id: DOCUMENT_SECTION_ID.to_string(),
            format: request.target,
            page_count,
        }],
        engine_version,
        source_revision,
    };
    rendered.validate().map_err(|error| error.message())?;
    Ok(rendered)
}

/// True when the bounded prefix is an HTML document, not an arbitrary file
/// with an `.html` name. LibreOffice emits a doctype or an `<html>` root.
fn looks_like_html(prefix: &[u8]) -> bool {
    let text = String::from_utf8_lossy(prefix);
    let text = text.trim_start_matches('\u{feff}').trim_start();
    let lowered = text.to_ascii_lowercase();
    lowered.starts_with("<!doctype html")
        || lowered.starts_with("<html")
        || lowered.starts_with("<head")
}

/// Read the first bytes of an owned output and leave the file at byte 0.
fn read_prefix(output: &mut EngineOutput) -> Result<Vec<u8>, String> {
    let file = output.owned_output.file_mut();
    file.seek(SeekFrom::Start(0))
        .map_err(|_| EngineError::Failed.message())?;
    let mut prefix = vec![0u8; HEADER_BYTES];
    let mut read_total = 0usize;
    loop {
        let read = file
            .read(&mut prefix[read_total..])
            .map_err(|_| EngineError::Failed.message())?;
        if read == 0 {
            break;
        }
        read_total += read;
        if read_total == prefix.len() {
            break;
        }
    }
    prefix.truncate(read_total);
    file.seek(SeekFrom::Start(0))
        .map_err(|_| EngineError::Failed.message())?;
    Ok(prefix)
}

/// Read a whole bounded PDF for the page count, then leave it at byte 0.
fn read_all(output: &mut EngineOutput) -> Result<Vec<u8>, String> {
    if output.byte_len > crate::engine_types::OFFICE_MAX_OUTPUT_BYTES {
        return Err(EngineError::Failed.message());
    }
    let file = output.owned_output.file_mut();
    file.seek(SeekFrom::Start(0))
        .map_err(|_| EngineError::Failed.message())?;
    let mut bytes = Vec::with_capacity(output.byte_len as usize);
    file.read_to_end(&mut bytes)
        .map_err(|_| EngineError::Failed.message())?;
    file.seek(SeekFrom::Start(0))
        .map_err(|_| EngineError::Failed.message())?;
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::{DOCUMENT_SECTION_ID, HEADER_BYTES};

    #[test]
    #[allow(clippy::assertions_on_constants)]
    fn the_only_section_of_a_one_shot_render_is_the_document() {
        assert_eq!(DOCUMENT_SECTION_ID, "document");
        assert!(HEADER_BYTES >= 5, "a PDF header needs five bytes");
    }
}
