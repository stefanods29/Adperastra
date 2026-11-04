//! Source preflight before an Office conversion (Step 12b D7).
//!
//! The read-only engine must never be the first thing that looks at a
//! hostile document. This bounded inspection refuses macro projects, external
//! relationships and DDE field codes, and it reports legacy binary formats as
//! "confined only": their internal links cannot be fully inspected, so they
//! are allowed only because the AppContainer gives them nothing to reach.
//!
//! Preflight only reads. The source is never written, and a refusal happens
//! before the file is copied into a job folder.
#![allow(dead_code)]


use std::io::Read;
use std::path::Path;

use crate::engine_types::{EngineError, OfficeFormat};

/// At most 100,000 entries in one container.
pub const MAX_PREFLIGHT_ENTRIES: usize = 100_000;
/// One inspected XML part is at most 8 MiB.
pub const MAX_PART_BYTES: u64 = 8 * 1024 * 1024;
/// All inspected parts together are at most 24 MiB.
pub const MAX_TOTAL_BYTES: u64 = 24 * 1024 * 1024;
/// A legacy or RTF source is scanned up to 4 MiB of text.
pub const MAX_LEGACY_SCAN_BYTES: u64 = 4 * 1024 * 1024;

/// What preflight found. A refused document never reaches this value.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Preflight {
    pub format: OfficeFormat,
    /// A binary format whose internal links cannot be inspected; it may run
    /// only inside the container.
    pub legacy_confined: bool,
    /// A ZIP/XML container that was fully inspected.
    pub zip_inspected: bool,
}

/// Inspect a source copy. `Err(engines.unsupported)` means: do not convert.
pub fn preflight(path: &Path, format: OfficeFormat) -> Result<Preflight, String> {
    if format.is_template() {
        return Err(EngineError::Unsupported.message());
    }
    match format {
        OfficeFormat::Docx
        | OfficeFormat::Xlsx
        | OfficeFormat::Pptx
        | OfficeFormat::Odt
        | OfficeFormat::Ods
        | OfficeFormat::Odp => inspect_zip_container(path, format),
        OfficeFormat::Rtf => inspect_rtf(path, format),
        // Legacy binary formats have no safe structural reader here.
        OfficeFormat::Doc | OfficeFormat::Xls | OfficeFormat::Ppt => Ok(Preflight {
            format,
            legacy_confined: true,
            zip_inspected: false,
        }),
        OfficeFormat::Potx | OfficeFormat::Otp => Err(EngineError::Unsupported.message()),
    }
}

fn inspect_zip_container(path: &Path, format: OfficeFormat) -> Result<Preflight, String> {
    let refused = || EngineError::Unsupported.message();
    let file = std::fs::File::open(path).map_err(|_| EngineError::Changed.message())?;
    let mut archive = zip::ZipArchive::new(std::io::BufReader::new(file)).map_err(|_| refused())?;
    if archive.len() > MAX_PREFLIGHT_ENTRIES {
        return Err(EngineError::Unsupported.message());
    }
    let mut inspected = 0u64;
    for index in 0..archive.len() {
        // Only the metadata of the central directory is read here.
        let entry = archive.by_index(index).map_err(|_| refused())?;
        let name = entry
            .name()
            .map_err(|_| refused())?
            .to_ascii_lowercase();
        if name.ends_with("vbaproject.bin")
            || name.ends_with("vbadata.xml")
            || name.contains("activex")
        {
            return Err(refused());
        }
        let interesting = name == "[content_types].xml"
            || name.ends_with(".rels")
            || name == "word/document.xml"
            || name == "content.xml";
        if !interesting {
            continue;
        }
        drop(entry);
        let mut entry = archive.by_index(index).map_err(|_| refused())?;
        if entry.size() > MAX_PART_BYTES {
            return Err(refused());
        }
        let mut bytes: Vec<u8> = Vec::new();
        entry
            .by_ref()
            .take(MAX_PART_BYTES)
            .read_to_end(&mut bytes)
            .map_err(|_| refused())?;
        inspected = inspected.saturating_add(bytes.len() as u64);
        if inspected > MAX_TOTAL_BYTES {
            return Err(refused());
        }
        let text = String::from_utf8_lossy(&bytes).to_ascii_lowercase();
        if text.contains("targetmode=\"external\"") || text.contains("externalentity") {
            return Err(refused());
        }
        if text.contains("macroenabled") && name == "[content_types].xml" {
            return Err(refused());
        }
        if text.contains("ddeauto") || text.contains("dde ") {
            return Err(refused());
        }
        if text.contains("xlink:href=\"file:")
            || text.contains("xlink:href=\"http:")
            || text.contains("xlink:href=\"https:")
        {
            return Err(refused());
        }
    }
    Ok(Preflight {
        format,
        legacy_confined: false,
        zip_inspected: true,
    })
}

fn inspect_rtf(path: &Path, format: OfficeFormat) -> Result<Preflight, String> {
    let refused = || EngineError::Unsupported.message();
    let file = std::fs::File::open(path).map_err(|_| EngineError::Changed.message())?;
    let mut bytes: Vec<u8> = Vec::new();
    std::io::BufReader::new(file)
        .take(MAX_LEGACY_SCAN_BYTES)
        .read_to_end(&mut bytes)
        .map_err(|_| refused())?;
    let text = String::from_utf8_lossy(&bytes).to_ascii_lowercase();
    if text.contains("\\objdata")
        || text.contains("\\objclass")
        || text.contains("dde")
        || text.contains("\\field")
    {
        return Err(refused());
    }
    Ok(Preflight {
        format,
        legacy_confined: false,
        zip_inspected: false,
    })
}

/// True when a produced PDF actually starts with the PDF header. Exit code 0
/// alone is never success (D8).
pub fn looks_like_pdf(bytes: &[u8]) -> bool {
    bytes.starts_with(b"%PDF-")
}

/// Count PDF pages with a bounded structural scan. This is a display count
/// only; the PDF itself is validated by its reader, never by this function.
pub fn count_pdf_pages(bytes: &[u8]) -> u32 {
    let mut pages = 0u32;
    let needle = b"/Type";
    let mut position = 0usize;
    while let Some(found) = find_from(bytes, needle, position) {
        position = found + needle.len();
        let mut rest = position;
        while rest < bytes.len() && bytes[rest].is_ascii_whitespace() {
            rest += 1;
        }
        if bytes.get(rest..rest + 5) == Some(b"/Page".as_slice())
            && bytes
                .get(rest + 5)
                .is_none_or(|byte| !byte.is_ascii_alphanumeric())
        {
            pages = pages.saturating_add(1);
            if pages >= 10_000 {
                return pages;
            }
        }
    }
    pages
}

fn find_from(haystack: &[u8], needle: &[u8], from: usize) -> Option<usize> {
    if from >= haystack.len() {
        return None;
    }
    haystack[from..]
        .windows(needle.len())
        .position(|window| window == needle)
        .map(|position| position + from)
}

#[cfg(test)]
mod tests {
    use super::{count_pdf_pages, looks_like_pdf};

    #[test]
    fn pdf_pages_are_counted_not_guessed() {
        let pdf = b"%PDF-1.7\n1 0 obj << /Type /Pages /Count 2 >> endobj\n\
                      2 0 obj << /Type /Page /Parent 1 0 R >> endobj\n\
                      3 0 obj << /Type /Page /Parent 1 0 R >> endobj\n";
        assert!(looks_like_pdf(pdf));
        assert_eq!(count_pdf_pages(pdf), 2);
        assert!(!looks_like_pdf(b"<html>"));
        assert_eq!(count_pdf_pages(b"not a pdf"), 0);
    }
}
