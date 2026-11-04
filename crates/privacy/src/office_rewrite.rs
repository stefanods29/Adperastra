//! Bounded Office container surgery (Step 12b T6).
//!
//! Office documents are ZIP containers of XML parts. Cleaning rewrites the
//! container entry by entry: unrelated parts are copied byte for byte (their
//! compression and timestamps are preserved by `raw_copy_file`), and only the
//! exact part an operation must change is re-serialized. Nothing here ever
//! produces a document from a template or drops a part that was not selected.
//!
//! All work is bounded: entry count, each part size, the total rewrite size
//! and the XML nesting depth. An unknown structure is refused, never guessed.

use std::io::{Cursor, Read, Seek, SeekFrom, Write};

use convert::ReadSeek;

use crate::error::PrivacyError;

/// At most 100,000 entries in one Office container.
pub const MAX_ENTRIES: usize = 100_000;
/// One XML part is at most 32 MiB.
pub const MAX_PART_BYTES: u64 = 32 * 1024 * 1024;
/// The whole rewrite stays in memory; larger documents are refused.
pub const MAX_REWRITE_BYTES: usize = 256 * 1024 * 1024;
/// XML nesting deeper than this is refused as unknown.
pub const MAX_XML_DEPTH: usize = 64;

/// A read-only view of the caller's source for the ZIP reader.
struct SourceRef<'a>(&'a mut dyn ReadSeek);

impl Read for SourceRef<'_> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        self.0.read(buffer)
    }
}

impl Seek for SourceRef<'_> {
    fn seek(&mut self, position: SeekFrom) -> std::io::Result<u64> {
        self.0.seek(position)
    }
}

/// One entry of a container, read into memory with its name.
pub struct Part {
    pub name: String,
    pub bytes: Vec<u8>,
    /// The source entry, so an unchanged part can be copied raw.
    pub index: usize,
}

/// Every entry of the container, bounded.
pub fn read_parts(source: &mut dyn ReadSeek) -> Result<Vec<Part>, PrivacyError> {
    source
        .seek(SeekFrom::Start(0))
        .map_err(|_| PrivacyError::Failed)?;
    let mut archive =
        zip::ZipArchive::new(SourceRef(source)).map_err(|_| PrivacyError::BadRequest)?;
    if archive.len() > MAX_ENTRIES {
        return Err(PrivacyError::TooLarge);
    }
    let mut parts = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|_| PrivacyError::BadRequest)?;
        if entry.size() > MAX_PART_BYTES {
            return Err(PrivacyError::TooLarge);
        }
        let name = entry
            .name()
            .map_err(|_| PrivacyError::BadRequest)?
            .into_owned();
        if name.is_empty() || name.len() > 512 {
            return Err(PrivacyError::BadRequest);
        }
        let mut bytes = Vec::new();
        entry
            .by_ref()
            .take(MAX_PART_BYTES)
            .read_to_end(&mut bytes)
            .map_err(|_| PrivacyError::Failed)?;
        parts.push(Part { name, bytes, index });
    }
    Ok(parts)
}

/// True when the part is an XML document we may edit at all.
pub fn is_editable_xml(part: &Part) -> bool {
    part.name.to_ascii_lowercase().ends_with(".xml")
        || part.name.to_ascii_lowercase().ends_with(".rels")
}

/// Rewrite the container with changed parts replaced and dropped parts gone.
///
/// `changes` maps a part name to its new bytes; `dropped` names parts that are
/// removed entirely. Everything else is copied unchanged.
pub fn rewrite(
    source: &mut dyn ReadSeek,
    changes: &[(String, Vec<u8>)],
    dropped: &[String],
) -> Result<Vec<u8>, PrivacyError> {
    source
        .seek(SeekFrom::Start(0))
        .map_err(|_| PrivacyError::Failed)?;
    let mut archive =
        zip::ZipArchive::new(SourceRef(source)).map_err(|_| PrivacyError::BadRequest)?;
    if archive.len() > MAX_ENTRIES {
        return Err(PrivacyError::TooLarge);
    }
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|_| PrivacyError::BadRequest)?;
        let name = entry
            .name()
            .map_err(|_| PrivacyError::BadRequest)?
            .into_owned();
        if dropped.iter().any(|dropped_name| dropped_name == &name) {
            continue;
        }
        if let Some((_, bytes)) = changes.iter().find(|(changed, _)| changed == &name) {
            writer
                .start_file(name, options)
                .map_err(|_| PrivacyError::Failed)?;
            writer.write_all(bytes).map_err(|_| PrivacyError::Failed)?;
        } else {
            writer
                .raw_copy_file(entry)
                .map_err(|_| PrivacyError::Failed)?;
        }
    }
    let cursor = writer.finish().map_err(|_| PrivacyError::Failed)?;
    let bytes = cursor.into_inner();
    if bytes.len() > MAX_REWRITE_BYTES {
        return Err(PrivacyError::TooLarge);
    }
    Ok(bytes)
}

/// Remove every `<name ...>...</name>` element, including nested ones.
pub fn remove_elements(xml: &str, name: &str) -> Result<String, PrivacyError> {
    let spans = element_spans(xml, name)?;
    if spans.is_empty() {
        return Ok(xml.to_string());
    }
    let mut result = String::with_capacity(xml.len());
    let mut position = 0usize;
    for (start, end) in spans {
        if start < position {
            continue;
        }
        result.push_str(&xml[position..start]);
        position = end;
    }
    result.push_str(&xml[position..]);
    Ok(result)
}

/// Replace `<open ...>inner</open>` with `inner` (used to accept insertions).
pub fn unwrap_elements(xml: &str, name: &str) -> Result<String, PrivacyError> {
    let spans = element_spans(xml, name)?;
    if spans.is_empty() {
        return Ok(xml.to_string());
    }
    let mut result = String::with_capacity(xml.len());
    let mut position = 0usize;
    for (start, end) in spans {
        if start < position {
            continue;
        }
        result.push_str(&xml[position..start]);
        let element = &xml[start..end];
        if let (Some(open_end), Some(close_start)) = (element.find('>'), element.rfind("</")) {
            if open_end < close_start {
                result.push_str(&element[open_end + 1..close_start]);
            }
        }
        position = end;
    }
    result.push_str(&xml[position..]);
    Ok(result)
}

/// Count the elements with this qualified name.
pub fn count_elements(xml: &str, name: &str) -> Result<usize, PrivacyError> {
    Ok(element_spans(xml, name)?.len())
}

/// True when the part declares or uses a forbidden construct.
pub fn refuses_active_content(xml: &str) -> bool {
    let lowered = xml.to_ascii_lowercase();
    lowered.contains("<!doctype") || lowered.contains("<!entity")
}

/// The next `<name` at a token boundary, so `<w:insxyz` and `<w:delText`
/// are not mistaken for `w:ins` and `w:del`.
fn find_open(xml: &str, open: &str, from: usize) -> Result<Option<usize>, PrivacyError> {
    let mut position = from;
    while let Some(found) = xml[position..].find(open) {
        let start = position + found;
        let after = xml[start + open.len()..].chars().next();
        if matches!(after, Some(' ' | '>' | '/' | '\n' | '\r' | '\t') | None) {
            return Ok(Some(start));
        }
        position = start + open.len();
    }
    Ok(None)
}

/// The byte ranges of every complete `<name ...>...</name>` element.
fn element_spans(xml: &str, name: &str) -> Result<Vec<(usize, usize)>, PrivacyError> {
    let open = format!("<{name}");
    let close = format!("</{name}>");
    let bytes = xml.as_bytes();
    let mut spans = Vec::new();
    let mut position = 0usize;
    while let Some(found) = xml[position..].find(&open) {
        let start = position + found;
        // `<w:insxyz` is a different element.
        let after = xml[start + open.len()..].chars().next();
        if !matches!(after, Some(' ' | '>' | '/' | '\n' | '\r' | '\t') | None) {
            position = start + open.len();
            continue;
        }
        let Some(open_end) = xml[start..].find('>').map(|offset| start + offset) else {
            return Err(PrivacyError::Unverified);
        };
        if xml.as_bytes()[open_end - 1] == b'/' {
            // Self-closing element: its own span.
            spans.push((start, open_end + 1));
            position = open_end + 1;
            continue;
        }
        // Walk nested elements of the same name to find the matching close.
        let mut depth = 1usize;
        let mut cursor = open_end + 1;
        loop {
            let next_open = find_open(xml, &open, cursor)?;
            let next_close = xml[cursor..].find(&close).map(|offset| cursor + offset);
            match (next_open, next_close) {
                (_, None) => return Err(PrivacyError::Unverified),
                (Some(open_at), Some(close_at)) if open_at < close_at => {
                    depth += 1;
                    if depth > MAX_XML_DEPTH {
                        return Err(PrivacyError::Unverified);
                    }
                    cursor = open_at + open.len();
                }
                (_, Some(close_at)) => {
                    depth -= 1;
                    cursor = close_at + close.len();
                    if depth == 0 {
                        spans.push((start, cursor));
                        break;
                    }
                }
            }
            if cursor >= bytes.len() {
                return Err(PrivacyError::Unverified);
            }
        }
        position = cursor;
    }
    Ok(spans)
}

/// The text content of the first element with this qualified name.
pub fn element_text(xml: &str, name: &str) -> Option<String> {
    let spans = element_spans(xml, name).ok()?;
    let (start, end) = *spans.first()?;
    let element = &xml[start..end];
    let open_end = element.find('>')?;
    let close_start = element.rfind("</")?;
    if open_end + 1 > close_start {
        return None;
    }
    let text = element[open_end + 1..close_start].trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{count_elements, element_text, remove_elements, unwrap_elements};

    const DOCUMENT: &str = "<w:body><w:p><w:ins w:id=\"1\"><w:r><w:t>kept</w:t></w:r></w:ins>\
<w:del w:id=\"2\"><w:r><w:delText>removed</w:delText></w:r></w:del></w:p></w:body>";

    #[test]
    fn deletions_are_removed_and_insertions_are_kept() {
        let without_deletions = remove_elements(DOCUMENT, "w:del").unwrap();
        assert!(!without_deletions.contains("removed"));
        let accepted = unwrap_elements(&without_deletions, "w:ins").unwrap();
        assert!(accepted.contains("<w:t>kept</w:t>"));
        assert!(!accepted.contains("<w:ins"));
        assert_eq!(count_elements(&accepted, "w:p").unwrap(), 1);
    }

    #[test]
    fn nested_elements_are_matched_exactly() {
        let xml = "<a><a>inner</a>outer</a><b/>";
        let spans = super::element_spans(xml, "a").unwrap();
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0], (0, xml.find("<b/>").unwrap()));
    }

    #[test]
    fn element_text_is_escaped_content_only() {
        let xml = "<dc:creator>Ada &amp; friends</dc:creator>";
        assert_eq!(
            element_text(xml, "dc:creator").as_deref(),
            Some("Ada &amp; friends")
        );
    }

    #[test]
    fn unclosed_elements_are_unverified() {
        assert!(remove_elements("<w:del><w:r>x", "w:del").is_err());
    }
}
