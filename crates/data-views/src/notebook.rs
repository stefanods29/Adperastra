//! Jupyter notebooks (Step 07f algorithm 2): a bounded parse of the saved
//! JSON. Code stays text, outputs stay data, and nothing here can invoke a
//! kernel, a widget, JavaScript or a network request.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ansi::{strip_ansi, truncate_chars};
use crate::markup::{sanitize_fragment, MarkupPolicy};
use crate::viewer_error::ViewerError;

/// The largest notebook source accepted.
pub const MAX_NOTEBOOK_SOURCE_BYTES: u64 = 64 * 1024 * 1024;
/// The most cells one notebook may contain.
pub const MAX_NOTEBOOK_CELLS: usize = 5_000;
/// The most saved outputs one cell may contain.
pub const MAX_NOTEBOOK_OUTPUTS: usize = 64;
/// The most decoded bytes all outputs may hold together.
pub const MAX_NOTEBOOK_OUTPUT_BYTES: u64 = 32 * 1024 * 1024;
/// The most characters one source chunk carries.
pub const MAX_SOURCE_CHARS: usize = 64 * 1024;
/// The most characters one HTML output carries.
pub const MAX_HTML_CHARS: usize = 256 * 1024;
/// The largest decoded image one output may carry.
pub const MAX_IMAGE_BYTES: u64 = 16 * 1024 * 1024;
/// The largest base64 text accepted before decoding one image.
pub const MAX_IMAGE_BASE64_CHARS: usize = 24 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotebookCellKind {
    Markdown,
    Code,
    Raw,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotebookOutputKind {
    Text,
    Html,
    Image,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotebookImage {
    pub mime: String,
    pub bytes: Vec<u8>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct NotebookParsedOutput {
    pub kind: NotebookOutputKind,
    pub text: Option<String>,
    pub html: Option<String>,
    pub image: Option<NotebookImage>,
}

#[derive(Debug, Clone)]
pub struct NotebookParsedCell {
    pub index: u32,
    pub kind: NotebookCellKind,
    pub source: String,
    pub language: String,
    pub outputs: Vec<NotebookParsedOutput>,
    pub next_source_offset: Option<u32>,
}

#[derive(Debug, Clone)]
pub struct NotebookDoc {
    pub cells: Vec<NotebookParsedCell>,
    pub partial: bool,
    pub unsupported_outputs: u32,
}

impl NotebookDoc {
    /// One bounded page of cells. Images are still parser-owned bytes here;
    /// the native session turns them into leases before it answers the UI.
    pub fn page(&self, start: usize, max_records: usize, max_bytes: usize) -> NotebookCellPage {
        let mut cells = Vec::new();
        let mut bytes = 0usize;
        let mut index = start.min(self.cells.len());
        while index < self.cells.len() && cells.len() < max_records {
            let cell = &self.cells[index];
            let size = cell_bytes(cell);
            if !cells.is_empty() && bytes + size > max_bytes {
                break;
            }
            cells.push(cell.clone());
            bytes += size;
            index += 1;
            if bytes > max_bytes {
                break;
            }
        }
        NotebookCellPage {
            cells,
            next_index: if index < self.cells.len() {
                Some(index)
            } else {
                None
            },
            partial: self.partial,
        }
    }
}

#[derive(Debug, Clone)]
pub struct NotebookCellPage {
    pub cells: Vec<NotebookParsedCell>,
    pub next_index: Option<usize>,
    pub partial: bool,
}

fn cell_bytes(cell: &NotebookParsedCell) -> usize {
    let mut total = cell.source.len() + cell.language.len() + 64;
    for output in &cell.outputs {
        total += output.text.as_ref().map(String::len).unwrap_or(0);
        total += output.html.as_ref().map(String::len).unwrap_or(0);
        total += output
            .image
            .as_ref()
            .map(|image| image.bytes.len())
            .unwrap_or(0);
    }
    total
}

/// Parse one notebook. The whole document is never sent to the UI.
pub fn parse_notebook(bytes: &[u8]) -> Result<NotebookDoc, ViewerError> {
    if bytes.len() as u64 > MAX_NOTEBOOK_SOURCE_BYTES {
        return Err(ViewerError::TooLarge);
    }
    let value: Value = serde_json::from_slice(bytes).map_err(|_| ViewerError::Corrupt)?;
    let root = value.as_object().ok_or(ViewerError::Corrupt)?;
    if root.get("nbformat").and_then(Value::as_u64) != Some(4) {
        return Err(ViewerError::Unsupported);
    }
    let cells_value = root
        .get("cells")
        .and_then(Value::as_array)
        .ok_or(ViewerError::Corrupt)?;
    if cells_value.len() > MAX_NOTEBOOK_CELLS {
        return Err(ViewerError::TooLarge);
    }
    let language = notebook_language(root);
    let mut decoded_total = 0u64;
    let mut unsupported_outputs = 0u32;
    let mut partial = false;
    let mut cells = Vec::with_capacity(cells_value.len());
    for (index, cell_value) in cells_value.iter().enumerate() {
        let cell = cell_value.as_object().ok_or(ViewerError::Corrupt)?;
        let kind = match cell.get("cell_type").and_then(Value::as_str) {
            Some("markdown") => NotebookCellKind::Markdown,
            Some("code") => NotebookCellKind::Code,
            Some("raw") => NotebookCellKind::Raw,
            _ => return Err(ViewerError::Corrupt),
        };
        let (source, next_source_offset) = join_source(
            cell.get("source").or_else(|| cell.get("input")),
            MAX_SOURCE_CHARS,
        );
        let outputs_value = cell
            .get("outputs")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        if outputs_value.len() > MAX_NOTEBOOK_OUTPUTS {
            return Err(ViewerError::TooLarge);
        }
        let mut outputs = Vec::new();
        for output in outputs_value {
            let parsed = parse_output(output, &mut decoded_total, &mut partial)?;
            match parsed {
                Some(output) => outputs.push(output),
                None => unsupported_outputs = unsupported_outputs.saturating_add(1),
            }
        }
        cells.push(NotebookParsedCell {
            index: index as u32,
            kind,
            source,
            language: if kind == NotebookCellKind::Code {
                language.clone()
            } else {
                String::new()
            },
            outputs,
            next_source_offset,
        });
    }
    if decoded_total > MAX_NOTEBOOK_OUTPUT_BYTES {
        return Err(ViewerError::TooLarge);
    }
    Ok(NotebookDoc {
        cells,
        partial: partial || unsupported_outputs > 0,
        unsupported_outputs,
    })
}

fn notebook_language(root: &serde_json::Map<String, Value>) -> String {
    let metadata = root.get("metadata").and_then(Value::as_object);
    let name = metadata
        .and_then(|value| value.get("language_info"))
        .and_then(Value::as_object)
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .or_else(|| {
            metadata
                .and_then(|value| value.get("kernelspec"))
                .and_then(Value::as_object)
                .and_then(|value| value.get("language"))
                .and_then(Value::as_str)
        })
        .unwrap_or("");
    name.chars()
        .take(64)
        .collect::<String>()
        .to_ascii_lowercase()
}

/// Jupyter allows a string or a list of strings for source fields.
fn join_source(value: Option<&Value>, max_chars: usize) -> (String, Option<u32>) {
    let mut text = String::new();
    match value {
        Some(Value::String(value)) => text.push_str(value),
        Some(Value::Array(parts)) => {
            for part in parts {
                if let Some(part) = part.as_str() {
                    text.push_str(part);
                }
            }
        }
        _ => {}
    }
    let (text, cut) = truncate_chars(&text, max_chars);
    (text, if cut { Some(max_chars as u32) } else { None })
}

fn parse_output(
    value: &Value,
    decoded_total: &mut u64,
    partial: &mut bool,
) -> Result<Option<NotebookParsedOutput>, ViewerError> {
    let output = value.as_object().ok_or(ViewerError::Corrupt)?;
    let kind = output.get("output_type").and_then(Value::as_str);
    match kind {
        Some("stream") => {
            let text = output.get("text").map(join_text).unwrap_or_default();
            let (text, _) = strip_ansi(&text);
            Ok(Some(NotebookParsedOutput {
                kind: NotebookOutputKind::Text,
                text: Some(cut_text(&text, partial)),
                html: None,
                image: None,
            }))
        }
        Some("error") => {
            let mut text = String::new();
            if let Some(name) = output.get("ename").and_then(Value::as_str) {
                text.push_str(name);
                text.push_str(": ");
            }
            if let Some(value) = output.get("evalue").and_then(Value::as_str) {
                text.push_str(value);
            }
            if let Some(traceback) = output.get("traceback").and_then(Value::as_array) {
                for line in traceback {
                    if let Some(line) = line.as_str() {
                        text.push('\n');
                        text.push_str(line);
                    }
                }
            }
            let (text, _) = strip_ansi(&text);
            Ok(Some(NotebookParsedOutput {
                kind: NotebookOutputKind::Error,
                text: Some(cut_text(&text, partial)),
                html: None,
                image: None,
            }))
        }
        Some("execute_result") | Some("display_data") => {
            let data = output
                .get("data")
                .and_then(Value::as_object)
                .ok_or(ViewerError::Corrupt)?;
            if let Some(text) = data.get("text/plain") {
                let text = join_text(text);
                let (text, _) = strip_ansi(&text);
                return Ok(Some(NotebookParsedOutput {
                    kind: NotebookOutputKind::Text,
                    text: Some(cut_text(&text, partial)),
                    html: None,
                    image: None,
                }));
            }
            if let Some(html) = data.get("text/html") {
                let html = join_text(html);
                let (html, cut) = truncate_chars(&html, MAX_HTML_CHARS);
                if cut {
                    *partial = true;
                }
                let clean = sanitize_fragment(&html, MarkupPolicy::Notebook)
                    .map_err(|_| ViewerError::TooLarge)?;
                return Ok(Some(NotebookParsedOutput {
                    kind: NotebookOutputKind::Html,
                    text: None,
                    html: Some(clean),
                    image: None,
                }));
            }
            for (mime, bytes) in [
                ("image/png", data.get("image/png")),
                ("image/jpeg", data.get("image/jpeg")),
            ] {
                if let Some(value) = bytes {
                    let encoded = join_text(value);
                    if encoded.len() > MAX_IMAGE_BASE64_CHARS {
                        return Err(ViewerError::TooLarge);
                    }
                    let decoded = decode_base64(&encoded)?;
                    if decoded.len() as u64 > MAX_IMAGE_BYTES {
                        return Err(ViewerError::TooLarge);
                    }
                    *decoded_total = decoded_total.saturating_add(decoded.len() as u64);
                    if *decoded_total > MAX_NOTEBOOK_OUTPUT_BYTES {
                        return Err(ViewerError::TooLarge);
                    }
                    let (width, height) = image_size(&decoded, mime);
                    return Ok(Some(NotebookParsedOutput {
                        kind: NotebookOutputKind::Image,
                        text: None,
                        html: None,
                        image: Some(NotebookImage {
                            mime: mime.to_string(),
                            bytes: decoded,
                            width,
                            height,
                        }),
                    }));
                }
            }
            // A widget, JavaScript or interactive output is not executed and
            // is reported as unsupported instead of disappearing silently.
            Ok(None)
        }
        _ => Ok(None),
    }
}

fn join_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(parts) => {
            let mut text = String::new();
            for part in parts {
                if let Some(part) = part.as_str() {
                    text.push_str(part);
                }
            }
            text
        }
        _ => String::new(),
    }
}

fn cut_text(text: &str, partial: &mut bool) -> String {
    let (text, cut) = truncate_chars(text, MAX_SOURCE_CHARS);
    if cut {
        *partial = true;
    }
    text
}

/// Strict, bounded standard base64. Whitespace is allowed; any other
/// character, bad padding or an impossible length is refused.
pub fn decode_base64(input: &str) -> Result<Vec<u8>, ViewerError> {
    let mut output = Vec::with_capacity((input.len() / 4).saturating_mul(3));
    let mut quartet = [0u8; 4];
    let mut count = 0usize;
    let mut padding = 0usize;
    for character in input.chars() {
        if character.is_ascii_whitespace() {
            continue;
        }
        let value = match character {
            'A'..='Z' => character as u8 - b'A',
            'a'..='z' => character as u8 - b'a' + 26,
            '0'..='9' => character as u8 - b'0' + 52,
            '+' => 62,
            '/' => 63,
            '=' => {
                quartet[count] = 0;
                count += 1;
                padding += 1;
                if count == 4 {
                    flush_quartet(&quartet, padding, &mut output)?;
                    count = 0;
                    padding = 0;
                }
                continue;
            }
            _ => return Err(ViewerError::Corrupt),
        };
        if padding > 0 {
            return Err(ViewerError::Corrupt);
        }
        quartet[count] = value;
        count += 1;
        if count == 4 {
            flush_quartet(&quartet, 0, &mut output)?;
            if output.len() as u64 > MAX_IMAGE_BYTES {
                return Err(ViewerError::TooLarge);
            }
            count = 0;
        }
    }
    if count != 0 {
        return Err(ViewerError::Corrupt);
    }
    Ok(output)
}

fn flush_quartet(
    quartet: &[u8; 4],
    padding: usize,
    output: &mut Vec<u8>,
) -> Result<(), ViewerError> {
    if padding > 2 {
        return Err(ViewerError::Corrupt);
    }
    let a = quartet[0];
    let b = quartet[1];
    let c = quartet[2];
    let d = quartet[3];
    output.push((a << 2) | (b >> 4));
    if padding < 2 {
        output.push((b << 4) | (c >> 2));
    }
    if padding == 0 {
        output.push((c << 6) | d);
    }
    Ok(())
}

/// PNG and JPEG dimensions, used only for the lease metadata. A malformed
/// image is rejected by the browser decoder; a missing size stays None.
pub fn image_size(bytes: &[u8], mime: &str) -> (Option<u32>, Option<u32>) {
    if mime == "image/png" && bytes.len() >= 24 && bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        let width = u32::from_be_bytes([bytes[16], bytes[17], bytes[18], bytes[19]]);
        let height = u32::from_be_bytes([bytes[20], bytes[21], bytes[22], bytes[23]]);
        return (Some(width), Some(height));
    }
    if mime == "image/jpeg" {
        let mut index = 2usize;
        while index + 9 < bytes.len() {
            if bytes[index] != 0xFF {
                index += 1;
                continue;
            }
            let marker = bytes[index + 1];
            if (0xC0..=0xC3).contains(&marker) {
                let height = u16::from_be_bytes([bytes[index + 5], bytes[index + 6]]);
                let width = u16::from_be_bytes([bytes[index + 7], bytes[index + 8]]);
                return (Some(u32::from(width)), Some(u32::from(height)));
            }
            if index + 3 >= bytes.len() {
                break;
            }
            let length = u16::from_be_bytes([bytes[index + 2], bytes[index + 3]]) as usize;
            index = index.saturating_add(2 + length.max(2));
        }
    }
    (None, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notebook(cells: Value) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({
            "nbformat": 4,
            "metadata": { "language_info": { "name": "python" } },
            "cells": cells
        }))
        .unwrap()
    }

    #[test]
    fn code_is_text_and_never_a_callback() {
        let bytes = notebook(serde_json::json!([{
            "cell_type": "code",
            "source": ["print('hi')"],
            "outputs": []
        }]));
        let doc = parse_notebook(&bytes).unwrap();
        assert_eq!(doc.cells[0].source, "print('hi')");
        assert_eq!(doc.cells[0].kind, NotebookCellKind::Code);
        assert!(doc.cells[0].outputs.is_empty());
    }

    #[test]
    fn five_thousand_and_one_cells_are_refused() {
        let cells: Vec<Value> = (0..5_001)
            .map(|_| serde_json::json!({ "cell_type": "markdown", "source": "x" }))
            .collect();
        assert_eq!(
            parse_notebook(&notebook(Value::Array(cells))).unwrap_err(),
            ViewerError::TooLarge
        );
    }

    #[test]
    fn widget_outputs_are_counted_not_executed() {
        let bytes = notebook(serde_json::json!([{
            "cell_type": "code",
            "source": "",
            "outputs": [{
                "output_type": "display_data",
                "data": { "application/vnd.jupyter.widget-view+json": { "model_id": "x" } }
            }]
        }]));
        let doc = parse_notebook(&bytes).unwrap();
        assert!(doc.cells[0].outputs.is_empty());
        assert_eq!(doc.unsupported_outputs, 1);
    }

    #[test]
    fn html_is_sanitized() {
        let bytes = notebook(serde_json::json!([{
            "cell_type": "code",
            "source": "",
            "outputs": [{
                "output_type": "display_data",
                "data": { "text/html": "<script>bad()</script><b>ok</b>" }
            }]
        }]));
        let doc = parse_notebook(&bytes).unwrap();
        assert_eq!(doc.cells[0].outputs[0].html.as_deref(), Some("<b>ok</b>"));
    }

    #[test]
    fn oversized_sources_are_cut_explicitly() {
        let source = "x".repeat(MAX_SOURCE_CHARS + 1);
        let bytes = notebook(serde_json::json!([{ "cell_type": "markdown", "source": source }]));
        let doc = parse_notebook(&bytes).unwrap();
        assert_eq!(doc.cells[0].source.chars().count(), MAX_SOURCE_CHARS);
        assert_eq!(
            doc.cells[0].next_source_offset,
            Some(MAX_SOURCE_CHARS as u32)
        );
    }
}
