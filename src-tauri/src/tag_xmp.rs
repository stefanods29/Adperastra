//! Optional embedded tag keywords (Step 11b, decision 5).
//!
//! Only an explicit action writes keywords, and only into a new copy. JPEG
//! and PNG carry the tag names in the XMP `dc:subject` RDF Bag, through the
//! Step 08c E5 packet rewriter. Every other segment/chunk (EXIF, IPTC, ICC,
//! comments, unknown XMP namespaces) is copied byte for byte, the encoded
//! pixel payload is hashed before and after, and the published copy is
//! reopened and verified before its tags are inherited. An existing file is
//! never rewritten: that route fails `tags.write_unavailable` before a read.
#![allow(dead_code)]


use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use convert::{ConversionOutput, WorkItemResult, WorkItemStatus};
use fs_service::owned_io::{OwnedIoError, OwnedOutput, PinnedDirectory};
use fs_service::transfer_conflicts::next_keep_both_name;
use fs_service::FileIdentityKey;
use privacy::image_fields::{
    detect_format, image_payload_hash, jpeg_segments, png_chunks, write_png_chunk, ImageFormat,
    MAX_IMAGE_BYTES,
};
use privacy::xmp_rules::MAX_XMP_BYTES;
use privacy::PrivacyError;

use crate::convert_reports::StoredReport;
use crate::jobs::JobContext;
use crate::privacy_xmp::{rewrite_xmp, XmpEdit};
use crate::tag_store::TagStore;
use crate::tag_transactions::{FsIdentitySource, TagHistory, TagTransaction};
use crate::tag_transfer::{TransferJob, MAX_WRITE_PATHS};
use crate::tag_types::{TagMutation, MAX_ASSIGNMENT_TAGS};

/// Largest XMP packet a JPEG APP1 segment can carry (the length field counts
/// itself).
const MAX_JPEG_XMP_SEGMENT: usize = u16::MAX as usize - 2;
/// How many `(n)` names one publication may try.
const MAX_NAME_ATTEMPTS: u32 = 10_000;

const JPEG_XMP_PREFIX: &[u8] = b"http://ns.adobe.com/xap/1.0/\0";
const PNG_XMP_KEYWORD: &[u8] = b"XML:com.adobe.xmp\0";

const NS_RDF: &str = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const NS_DC: &str = "http://purl.org/dc/elements/1.1/";

/// A minimal packet that already carries `dc:subject`, used when the image
/// has no XMP yet.
const BASE_PACKET: &[u8] = concat!(
    "<?xpacket begin=\"\u{feff}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>",
    "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\">",
    "<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">",
    "<rdf:Description rdf:about=\"\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\">",
    "<dc:subject><rdf:Bag/></dc:subject>",
    "</rdf:Description></rdf:RDF></x:xmpmeta>",
    "<?xpacket end=\"w\"?>"
)
.as_bytes();

/// What a keyword write may touch. Only a new copy is supported; tags are
/// never written into a file the user already has.
pub enum EmbeddedWriteMode<'a> {
    /// Publish a new copy next to the source, or in `dest_dir`.
    NewCopy { dest_dir: Option<&'a Path> },
    /// Refused: writing into the existing file is not offered.
    Existing { dest_dir: &'a Path },
}

/// One `dc:subject` rewriter. Production goes through the isolated Step 08c
/// helper; tests use the pure rules directly.
pub trait XmpKeywordWriter {
    fn set_keywords(&self, packet: &[u8], keywords: &[String]) -> Result<Vec<u8>, String>;
}

/// The trusted-host writer of Step 08c E5.
pub struct JobXmpWriter<'a> {
    pub context: &'a JobContext,
}

impl XmpKeywordWriter for JobXmpWriter<'_> {
    fn set_keywords(&self, packet: &[u8], keywords: &[String]) -> Result<Vec<u8>, String> {
        rewrite_xmp(
            packet,
            &XmpEdit::SetKeywords {
                keywords: keywords.to_vec(),
            },
            self.context,
        )
        .map_err(|code| map_helper_error(&code))
    }
}

/// Write the tags of every source as XMP keywords into a new copy. Sources
/// without tags are skipped and never copied. The result is the bounded
/// Step 08a report the UI polls.
pub fn write_embedded_copies(
    sources: &[String],
    mode: EmbeddedWriteMode<'_>,
    store: &TagStore,
    history: &TagHistory,
    writer: &dyn XmpKeywordWriter,
    job: &dyn TransferJob,
) -> Result<StoredReport, String> {
    let dest_dir = match mode {
        // An existing file is never rewritten; refuse before reading or
        // writing anything.
        EmbeddedWriteMode::Existing { .. } => {
            return Err("tags.write_unavailable".to_string());
        }
        EmbeddedWriteMode::NewCopy { dest_dir } => dest_dir,
    };
    if sources.is_empty() || sources.len() > MAX_WRITE_PATHS {
        return Err("tags.invalid".to_string());
    }
    for source in sources {
        let path = Path::new(source);
        if !path.is_absolute() {
            return Err("tags.invalid".to_string());
        }
    }
    let catalog = store.catalog()?;
    let names: HashMap<String, String> = catalog
        .tags
        .into_iter()
        .map(|tag| (tag.id, tag.name))
        .collect();
    let mut items = Vec::with_capacity(sources.len());
    let mut outputs = Vec::new();
    let mut cancelled = false;
    for (index, source) in sources.iter().enumerate() {
        if job.cancelled() {
            cancelled = true;
            for (rest, remaining) in sources.iter().enumerate().skip(index) {
                items.push(cancelled_item(rest as u32, remaining));
            }
            break;
        }
        job.progress(index, sources.len(), source);
        let outcome = copy_one(
            source,
            index as u32,
            dest_dir,
            store,
            history,
            &names,
            writer,
        );
        items.push(outcome.item);
        if let Some(output) = outcome.output {
            outputs.push(output);
        }
    }
    job.progress(sources.len(), sources.len(), "");
    Ok(StoredReport::new(items, outputs, cancelled))
}

struct CopyOutcome {
    item: WorkItemResult,
    output: Option<ConversionOutput>,
}

fn copy_one(
    source: &str,
    input_index: u32,
    dest_dir: Option<&Path>,
    store: &TagStore,
    history: &TagHistory,
    names: &HashMap<String, String>,
    writer: &dyn XmpKeywordWriter,
) -> CopyOutcome {
    let fail = |code: &str| CopyOutcome {
        item: item(input_index, source, WorkItemStatus::Failed, Some(code), 0, 0),
        output: None,
    };
    let key = match fs_service::capture_file_identity(Path::new(source)) {
        Ok(key) => key,
        Err(_) => return fail("tags.io"),
    };
    let tag_ids = match read_tag_ids(store, &key) {
        Ok(ids) => ids,
        Err(code) => return fail(&code),
    };
    if tag_ids.is_empty() {
        return CopyOutcome {
            item: item(
                input_index,
                source,
                WorkItemStatus::Skipped,
                Some("tags.empty"),
                0,
                0,
            ),
            output: None,
        };
    }
    if tag_ids.len() > MAX_ASSIGNMENT_TAGS {
        return fail("tags.limit");
    }
    // Every tag ID must still have its catalog name. Silently embedding a
    // subset would produce a copy whose keywords disagree with its tags.
    let mut keywords: Vec<String> = Vec::with_capacity(tag_ids.len());
    for id in &tag_ids {
        let Some(name) = names.get(id) else {
            return fail("tags.changed");
        };
        keywords.push(name.clone());
    }
    if keywords.is_empty() {
        return fail("tags.empty");
    }
    let source_path = Path::new(source);
    let Ok(metadata) = fs::metadata(source_path) else {
        return fail("tags.io");
    };
    if metadata.len() > MAX_IMAGE_BYTES as u64 {
        return fail("tags.limit");
    }
    let bytes = match fs::read(source_path) {
        Ok(bytes) => bytes,
        Err(_) => return fail("tags.io"),
    };
    let Some(format) = detect_format(&bytes) else {
        return fail("tags.unsupported");
    };
    if !matches!(format, ImageFormat::Jpeg | ImageFormat::Png) {
        return fail("tags.unsupported");
    }
    // Prove the source pixel payload can be hashed before anything is
    // published; a failure here must not leave an unreported copy.
    let before_hash = match image_payload_hash(format, &bytes) {
        Ok(hash) => hash,
        Err(code) => return fail(&privacy_error_code(code)),
    };
    let patched = match embed_keywords(format, &bytes, &keywords, writer) {
        Ok(patched) => patched,
        Err(code) => return fail(&code),
    };
    let Some(parent) = dest_dir.or_else(|| source_path.parent()) else {
        return fail("tags.io");
    };
    let directory = match PinnedDirectory::open(parent) {
        Ok(directory) => directory,
        Err(_) => return fail("tags.io"),
    };
    let base_name = source_path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "tagged".to_string());
    let mut output = match OwnedOutput::create(&directory, &base_name) {
        Ok(output) => output,
        Err(_) => return fail("tags.io"),
    };
    if output.file_mut().write_all(&patched).is_err() || output.flush_sync().is_err() {
        return fail("tags.io");
    }
    let published = match publish(&mut output, &directory, &base_name) {
        Ok(path) => path,
        Err(code) => return fail(&code),
    };
    // The published handle stays open until the owned output is dropped; a
    // verification read must not race that exclusive staging handle.
    drop(output);
    let published_display = display_path(&published);
    let output_row = ConversionOutput {
        output_id: uuid(),
        input_indices: vec![input_index],
        output_index: 0,
        path: published_display.clone(),
        byte_len: patched.len() as u64,
    };
    let reopened = match fs::read(&published) {
        Ok(bytes) => bytes,
        Err(_) => {
            return CopyOutcome {
                item: item_with_output(
                    input_index,
                    source,
                    "tags.io",
                    patched.len() as u64,
                ),
                output: Some(output_row),
            };
        }
    };
    if let Err(code) = verify_copy(format, before_hash, &reopened, &keywords) {
        return CopyOutcome {
            item: item_with_output(input_index, source, &code, patched.len() as u64),
            output: Some(output_row),
        };
    }
    // The copy exists and carries the keywords; only now inherit the tag
    // keys. A failure keeps the copy and reports it instead of hiding it.
    if let Err(code) = inherit_tags(store, history, &published, &tag_ids) {
        return CopyOutcome {
            item: item_with_output(input_index, source, &code, patched.len() as u64),
            output: Some(output_row),
        };
    }
    CopyOutcome {
        item: item(
            input_index,
            source,
            WorkItemStatus::Done,
            None,
            1,
            patched.len() as u64,
        ),
        output: Some(output_row),
    }
}

fn item(
    input_index: u32,
    source: &str,
    status: WorkItemStatus,
    reason: Option<&str>,
    output_count: u32,
    bytes_written: u64,
) -> WorkItemResult {
    WorkItemResult {
        input_index,
        source_path: Some(source.to_string()),
        output_count,
        status,
        reason: reason.map(str::to_string),
        metadata_lost: Vec::new(),
        bytes_written,
    }
}

fn item_with_output(
    input_index: u32,
    source: &str,
    reason: &str,
    bytes_written: u64,
) -> WorkItemResult {
    item(
        input_index,
        source,
        WorkItemStatus::Failed,
        Some(reason),
        1,
        bytes_written,
    )
}

fn cancelled_item(input_index: u32, source: &str) -> WorkItemResult {
    item(
        input_index,
        source,
        WorkItemStatus::Cancelled,
        Some("tags.cancelled"),
        0,
        0,
    )
}

fn read_tag_ids(store: &TagStore, key: &FileIdentityKey) -> Result<Vec<String>, String> {
    let mut rows = store.assignments(std::slice::from_ref(key))?;
    let Some(row) = rows.pop() else {
        return Ok(Vec::new());
    };
    let mut ids = row.tag_ids;
    ids.sort();
    ids.dedup();
    Ok(ids)
}

fn inherit_tags(
    store: &TagStore,
    history: &TagHistory,
    published: &Path,
    tag_ids: &[String],
) -> Result<(), String> {
    let key = fs_service::capture_file_identity(published).map_err(|_| "tags.io".to_string())?;
    let result = TagTransaction::execute(
        store,
        history,
        &FsIdentitySource,
        &TagMutation {
            keys: vec![key],
            paths: vec![display_path(published)],
            add: tag_ids.to_vec(),
            remove: Vec::new(),
            expected_revisions: vec![0],
        },
    )
    .map_err(|code| {
        if code == "tags.invalid" {
            "tags.changed".to_string()
        } else {
            code
        }
    })?;
    if result.changed_count != 1 || !result.complete {
        return Err("tags.changed".to_string());
    }
    Ok(())
}

fn publish(
    output: &mut OwnedOutput,
    directory: &PinnedDirectory,
    name: &str,
) -> Result<PathBuf, String> {
    let mut from = 0u32;
    for _ in 0..MAX_NAME_ATTEMPTS {
        let candidate = next_keep_both_name(directory.path(), name, from)
            .map_err(|_| "tags.limit".to_string())?;
        match output.publish_name(&candidate) {
            Ok(path) => return Ok(path),
            Err(OwnedIoError::TargetExists) => from = from.saturating_add(1),
            Err(_) => return Err("tags.io".to_string()),
        }
    }
    Err("tags.limit".to_string())
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy()
        .trim_start_matches(r"\\?\")
        .to_string()
}

fn uuid() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Rewrite only the XMP packet inside a JPEG or PNG, then prove the encoded
/// pixels did not change. Other containers are not promised.
fn embed_keywords(
    format: ImageFormat,
    bytes: &[u8],
    keywords: &[String],
    writer: &dyn XmpKeywordWriter,
) -> Result<Vec<u8>, String> {
    validate_keywords(keywords)?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("tags.limit".to_string());
    }
    let before = image_payload_hash(format, bytes).map_err(privacy_error_code)?;
    let output = match format {
        ImageFormat::Jpeg => embed_jpeg(bytes, keywords, writer)?,
        ImageFormat::Png => embed_png(bytes, keywords, writer)?,
        _ => return Err("tags.unsupported".to_string()),
    };
    let after = image_payload_hash(format, &output).map_err(privacy_error_code)?;
    if before != after {
        return Err("tags.changed".to_string());
    }
    Ok(output)
}

fn validate_keywords(keywords: &[String]) -> Result<(), String> {
    if keywords.is_empty() || keywords.len() > 1_000 {
        return Err("tags.invalid".to_string());
    }
    for keyword in keywords {
        if keyword.is_empty()
            || keyword.chars().count() > 60
            || keyword.chars().any(char::is_control)
        {
            return Err("tags.invalid".to_string());
        }
    }
    Ok(())
}

fn embed_jpeg(
    bytes: &[u8],
    keywords: &[String],
    writer: &dyn XmpKeywordWriter,
) -> Result<Vec<u8>, String> {
    let segments = jpeg_segments(bytes).map_err(privacy_error_code)?;
    let existing: Vec<&privacy::image_fields::JpegSegment> = segments
        .iter()
        .filter(|segment| {
            segment.marker == 0xe1
                && segment.payload_start <= segment.end
                && bytes[segment.payload_start..segment.end].starts_with(JPEG_XMP_PREFIX)
        })
        .collect();
    let packet = match existing.first() {
        Some(segment) => {
            &bytes[segment.payload_start + JPEG_XMP_PREFIX.len()..segment.end]
        }
        None => BASE_PACKET,
    };
    let packet = ensure_subject(packet)?;
    let rewritten = writer.set_keywords(&packet, keywords)?;
    if rewritten.is_empty() || rewritten.len() > MAX_XMP_BYTES {
        return Err("tags.limit".to_string());
    }
    let mut payload = Vec::with_capacity(JPEG_XMP_PREFIX.len() + rewritten.len());
    payload.extend_from_slice(JPEG_XMP_PREFIX);
    payload.extend_from_slice(&rewritten);
    if payload.len() > MAX_JPEG_XMP_SEGMENT {
        return Err("tags.limit".to_string());
    }
    let mut segment_bytes = Vec::with_capacity(payload.len() + 4);
    segment_bytes.extend_from_slice(&[0xff, 0xe1]);
    segment_bytes.extend_from_slice(&((payload.len() + 2) as u16).to_be_bytes());
    segment_bytes.extend_from_slice(&payload);
    // Every APP1 XMP segment is replaced by this one; EXIF APP1, APP13,
    // APP2/ICC and every other segment are untouched.
    let insert_at = existing
        .first()
        .map(|segment| segment.start)
        .unwrap_or_else(|| {
            segments
                .iter()
                .find(|segment| segment.marker != 0xe0)
                .map(|segment| segment.start)
                .unwrap_or(2)
        });
    let mut output = Vec::with_capacity(bytes.len() + segment_bytes.len());
    output.extend_from_slice(&bytes[..insert_at]);
    output.extend_from_slice(&segment_bytes);
    let mut copied_to = insert_at;
    for segment in existing {
        if segment.start < copied_to {
            continue;
        }
        output.extend_from_slice(&bytes[copied_to..segment.start]);
        copied_to = segment.end;
    }
    output.extend_from_slice(&bytes[copied_to..]);
    Ok(output)
}

fn embed_png(
    bytes: &[u8],
    keywords: &[String],
    writer: &dyn XmpKeywordWriter,
) -> Result<Vec<u8>, String> {
    let chunks = png_chunks(bytes).map_err(privacy_error_code)?;
    let mut packet: Option<Vec<u8>> = None;
    for chunk in &chunks {
        let data = &bytes[chunk.data_start..chunk.data_end];
        if &chunk.kind == b"iTXt" && data.starts_with(PNG_XMP_KEYWORD) {
            let rest = &data[PNG_XMP_KEYWORD.len()..];
            if rest.len() > 2 && rest[0] == 0 && rest[1] == 0 {
                packet = Some(xmp_itxt_body(&rest[2..]));
            }
        } else if &chunk.kind == b"tEXt" && data.starts_with(PNG_XMP_KEYWORD) {
            packet = Some(data[PNG_XMP_KEYWORD.len()..].to_vec());
        }
    }
    let packet = match packet {
        Some(packet) => ensure_subject(&packet)?,
        None => BASE_PACKET.to_vec(),
    };
    let rewritten = writer.set_keywords(&packet, keywords)?;
    if rewritten.is_empty() || rewritten.len() > MAX_XMP_BYTES {
        return Err("tags.limit".to_string());
    }
    let mut body = PNG_XMP_KEYWORD.to_vec();
    body.extend_from_slice(b"\0\0\0\0");
    body.extend_from_slice(&rewritten);
    let mut chunk_bytes = Vec::with_capacity(body.len() + 12);
    write_png_chunk(&mut chunk_bytes, b"iTXt", &body);
    let mut output = Vec::with_capacity(bytes.len() + chunk_bytes.len());
    output.extend_from_slice(&bytes[..8]);
    let mut inserted = false;
    for chunk in &chunks {
        let data = &bytes[chunk.data_start..chunk.data_end];
        let is_xmp = (&chunk.kind == b"iTXt" || &chunk.kind == b"tEXt")
            && data.starts_with(PNG_XMP_KEYWORD);
        if is_xmp {
            continue;
        }
        if !inserted && (&chunk.kind == b"IDAT" || &chunk.kind == b"IEND") {
            output.extend_from_slice(&chunk_bytes);
            inserted = true;
        }
        output.extend_from_slice(&bytes[chunk.start..chunk.end]);
    }
    if !inserted {
        output.extend_from_slice(&chunk_bytes);
    }
    Ok(output)
}

/// The iTXt body after the compression flag/method: two NUL-terminated
/// strings (language tag, translated keyword), then the packet.
fn xmp_itxt_body(rest: &[u8]) -> Vec<u8> {
    let mut index = 0usize;
    let mut parts = 0usize;
    while index < rest.len() && parts < 2 {
        if rest[index] == 0 {
            parts += 1;
        }
        index += 1;
    }
    rest[index..].to_vec()
}

/// XMP requires an existing `dc:subject` for the Step 08c rewriter. A packet
/// without one gets a new description element; a packet without RDF is
/// refused instead of guessed.
fn ensure_subject(packet: &[u8]) -> Result<Vec<u8>, String> {
    let text = std::str::from_utf8(packet).map_err(|_| "tags.unsupported".to_string())?;
    if let Some(prefix) = namespace_prefix(text, NS_DC) {
        if text.contains(&format!("{prefix}:subject")) {
            return Ok(packet.to_vec());
        }
    }
    let Some(rdf) = namespace_prefix(text, NS_RDF) else {
        return Err("tags.unsupported".to_string());
    };
    let Some(close) = text.rfind(&format!("</{rdf}:RDF>")) else {
        return Err("tags.unsupported".to_string());
    };
    let mut output = String::with_capacity(text.len() + 256);
    output.push_str(&text[..close]);
    output.push_str(&format!(
        "<{rdf}:Description {rdf}:about=\"\" xmlns:dc=\"{NS_DC}\">\
         <dc:subject><{rdf}:Bag/></dc:subject>\
         </{rdf}:Description>"
    ));
    output.push_str(&text[close..]);
    Ok(output.into_bytes())
}

fn namespace_prefix<'a>(text: &'a str, namespace: &str) -> Option<&'a str> {
    let mut rest = text;
    loop {
        let index = rest.find("xmlns:")?;
        let after_marker = &rest[index + "xmlns:".len()..];
        let equal = after_marker.find('=')?;
        let prefix = &after_marker[..equal];
        rest = &after_marker[equal + 1..];
        if prefix.is_empty()
            || !prefix
                .chars()
                .all(|value| value.is_ascii_alphanumeric() || matches!(value, '_' | '-' | '.'))
        {
            continue;
        }
        let trimmed = rest.trim_start();
        let quote = trimmed.chars().next()?;
        if quote != '"' && quote != '\'' {
            continue;
        }
        let end = trimmed[1..].find(quote)?;
        if &trimmed[1..1 + end] == namespace {
            return Some(prefix);
        }
        rest = &trimmed[1 + end + 1..];
    }
}

fn verify_copy(
    format: ImageFormat,
    before: [u8; 32],
    bytes: &[u8],
    keywords: &[String],
) -> Result<(), String> {
    if detect_format(bytes) != Some(format) {
        return Err("tags.io".to_string());
    }
    let after = image_payload_hash(format, bytes).map_err(privacy_error_code)?;
    if after != before {
        return Err("tags.changed".to_string());
    }
    let packet = read_xmp(format, bytes)?.ok_or_else(|| "tags.io".to_string())?;
    let text = std::str::from_utf8(&packet).map_err(|_| "tags.io".to_string())?;
    for keyword in keywords {
        let escaped = keyword
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;");
        if !text.contains(&escaped) {
                return Err("tags.io".to_string());
        }
    }
    Ok(())
}

fn read_xmp(format: ImageFormat, bytes: &[u8]) -> Result<Option<Vec<u8>>, String> {
    match format {
        ImageFormat::Jpeg => {
            let segments = jpeg_segments(bytes).map_err(privacy_error_code)?;
            for segment in segments {
                if segment.marker != 0xe1 || segment.payload_start > segment.end {
                    continue;
                }
                let payload = &bytes[segment.payload_start..segment.end];
                if payload.starts_with(JPEG_XMP_PREFIX) {
                    return Ok(Some(payload[JPEG_XMP_PREFIX.len()..].to_vec()));
                }
            }
            Ok(None)
        }
        ImageFormat::Png => {
            for chunk in png_chunks(bytes).map_err(privacy_error_code)? {
                let data = &bytes[chunk.data_start..chunk.data_end];
                if &chunk.kind == b"iTXt" && data.starts_with(PNG_XMP_KEYWORD) {
                    let rest = &data[PNG_XMP_KEYWORD.len()..];
                    if rest.len() > 2 && rest[0] == 0 && rest[1] == 0 {
                        return Ok(Some(xmp_itxt_body(&rest[2..])));
                    }
                } else if &chunk.kind == b"tEXt" && data.starts_with(PNG_XMP_KEYWORD) {
                    return Ok(Some(data[PNG_XMP_KEYWORD.len()..].to_vec()));
                }
            }
            Ok(None)
        }
        _ => Err("tags.unsupported".to_string()),
    }
}

fn privacy_error_code(error: PrivacyError) -> String {
    match error {
        PrivacyError::TooLarge => "tags.limit".to_string(),
        PrivacyError::Changed => "tags.changed".to_string(),
        PrivacyError::Unsupported | PrivacyError::BadRequest | PrivacyError::Unverified => {
            "tags.unsupported".to_string()
        }
        _ => "tags.io".to_string(),
    }
}

fn map_helper_error(code: &str) -> String {
    match code {
        "privacy.too_large" => "tags.limit".to_string(),
        "privacy.changed" => "tags.changed".to_string(),
        "privacy.bad_request" | "privacy.unsupported" | "privacy.unverified" => {
            "tags.unsupported".to_string()
        }
        other if other.starts_with("privacy.") => "tags.io".to_string(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod step11b_xmp_tests {
    use super::*;
    use crate::tag_types::Tag;
    use std::cell::Cell;

    struct PureWriter;

    impl XmpKeywordWriter for PureWriter {
        fn set_keywords(&self, packet: &[u8], keywords: &[String]) -> Result<Vec<u8>, String> {
            privacy::xmp_rules::set_keywords(packet, keywords).map_err(privacy_error_code)
        }
    }

    struct CountingJob {
        progress_calls: Cell<usize>,
    }

    impl CountingJob {
        fn new() -> Self {
            Self {
                progress_calls: Cell::new(0),
            }
        }
    }

    impl TransferJob for CountingJob {
        fn cancelled(&self) -> bool {
            false
        }

        fn progress(&self, _done: usize, _total: usize, _current: &str) {
            self.progress_calls.set(self.progress_calls.get() + 1);
        }
    }

    fn xmp_packet(note: bool) -> String {
        let extra = if note {
            r#" xmlns:example="urn:example:custom" example:note="keep""#
        } else {
            ""
        };
        format!(
            "<?xpacket begin=\"\u{feff}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\
             <x:xmpmeta xmlns:x=\"adobe:ns:meta/\">\
             <rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\
             <rdf:Description rdf:about=\"\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\"{extra}>\
             <dc:subject><rdf:Bag><rdf:li>old</rdf:li></rdf:Bag></dc:subject>\
             </rdf:Description></rdf:RDF></x:xmpmeta><?xpacket end=\"w\"?>"
        )
    }

    fn jpeg_fixture(xmp: Option<&str>) -> Vec<u8> {
        let mut output = vec![0xff, 0xd8];
        let app0 = b"JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00";
        output.extend_from_slice(&[0xff, 0xe0]);
        output.extend_from_slice(&((app0.len() + 2) as u16).to_be_bytes());
        output.extend_from_slice(app0);
        if let Some(packet) = xmp {
            let mut body = JPEG_XMP_PREFIX.to_vec();
            body.extend_from_slice(packet.as_bytes());
            output.extend_from_slice(&[0xff, 0xe1]);
            output.extend_from_slice(&((body.len() + 2) as u16).to_be_bytes());
            output.extend_from_slice(&body);
        }
        let comment = b"keep-me";
        output.extend_from_slice(&[0xff, 0xfe]);
        output.extend_from_slice(&((comment.len() + 2) as u16).to_be_bytes());
        output.extend_from_slice(comment);
        output.extend_from_slice(&[0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
        output.extend_from_slice(&[0x12, 0x34, 0x56]);
        output.extend_from_slice(&[0xff, 0xd9]);
        output
    }

    fn png_fixture(xmp: Option<&str>) -> Vec<u8> {
        let mut output = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&1u32.to_be_bytes());
        ihdr.extend_from_slice(&1u32.to_be_bytes());
        ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
        write_png_chunk(&mut output, b"IHDR", &ihdr);
        if let Some(packet) = xmp {
            let mut body = PNG_XMP_KEYWORD.to_vec();
            body.extend_from_slice(b"\0\0\0\0");
            body.extend_from_slice(packet.as_bytes());
            write_png_chunk(&mut output, b"iTXt", &body);
        }
        write_png_chunk(&mut output, b"tEXt", b"Software\0Adperastra");
        write_png_chunk(&mut output, b"IDAT", b"payload-bytes");
        write_png_chunk(&mut output, b"IEND", &[]);
        output
    }

    fn tag(id: &str, name: &str) -> Tag {
        Tag {
            id: id.to_string(),
            name: name.to_string(),
            color: "#1565C0".to_string(),
            icon_id: "tag".to_string(),
            created_unix: 0,
            modified_unix: 0,
            revision: 0,
        }
    }

    #[test]
    fn xmp_unknown_namespace_preserved() {
        let source = jpeg_fixture(Some(&xmp_packet(true)));
        let keywords = vec!["holiday".to_string()];
        let output = embed_keywords(ImageFormat::Jpeg, &source, &keywords, &PureWriter).unwrap();
        let packet = read_xmp(ImageFormat::Jpeg, &output).unwrap().unwrap();
        let text = std::str::from_utf8(&packet).unwrap();
        assert!(text.contains("urn:example:custom"));
        assert!(text.contains("example:note=\"keep\""));
        assert!(text.contains("holiday"));
        assert!(!text.contains("<rdf:li>old</rdf:li>"));
        // The unrelated COM segment is byte-for-byte untouched.
        assert!(output.windows(7).any(|window| window == b"keep-me"));
    }

    #[test]
    fn pixel_hash_unchanged() {
        let keywords = vec!["holiday".to_string(), "family".to_string()];
        for (format, source) in [
            (ImageFormat::Jpeg, jpeg_fixture(None)),
            (ImageFormat::Png, png_fixture(None)),
        ] {
            let before = image_payload_hash(format, &source).unwrap();
            let output = embed_keywords(format, &source, &keywords, &PureWriter).unwrap();
            let after = image_payload_hash(format, &output).unwrap();
            assert_eq!(before, after);
            assert!(output.len() > source.len());
            let packet = read_xmp(format, &output).unwrap().unwrap();
            let text = std::str::from_utf8(&packet).unwrap();
            assert!(text.contains("holiday"));
            assert!(text.contains("family"));
        }
    }

    #[test]
    fn existing_write_unavailable_0_writes() {
        let dir = tempfile::tempdir().unwrap();
        let source_path = dir.path().join("photo.jpg");
        let source = jpeg_fixture(Some(&xmp_packet(true)));
        fs::write(&source_path, &source).unwrap();
        let store = TagStore::open_in_memory().unwrap();
        let history = TagHistory::default();
        let job = CountingJob::new();
        let result = write_embedded_copies(
            &[display_path(&source_path)],
            EmbeddedWriteMode::Existing {
                dest_dir: dir.path(),
            },
            &store,
            &history,
            &PureWriter,
            &job,
        );
        assert_eq!(result.err().as_deref(), Some("tags.write_unavailable"));
        assert_eq!(job.progress_calls.get(), 0);
        assert_eq!(fs::read(&source_path).unwrap(), source);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn copy_published_path_recorded() {
        let source_dir = tempfile::tempdir().unwrap();
        let dest_dir = tempfile::tempdir().unwrap();
        let source_path = source_dir.path().join("photo.jpg");
        let source = jpeg_fixture(Some(&xmp_packet(true)));
        fs::write(&source_path, &source).unwrap();
        let store = TagStore::open_in_memory().unwrap();
        let history = TagHistory::default();
        let tag = tag("0f8fad1e-0001-4a3b-9c4d-000000000001", "holiday");
        let catalog = store.save_tag(&tag, 0, &history).unwrap();
        let key = fs_service::capture_file_identity(&source_path).unwrap();
        TagTransaction::execute(
            &store,
            &history,
            &FsIdentitySource,
            &TagMutation {
                keys: vec![key],
                paths: vec![display_path(&source_path)],
                add: vec![tag.id.clone()],
                remove: Vec::new(),
                expected_revisions: vec![0],
            },
        )
        .unwrap();
        assert_eq!(catalog.tags.len(), 1);

        let job = CountingJob::new();
        let report = write_embedded_copies(
            &[display_path(&source_path)],
            EmbeddedWriteMode::NewCopy {
                dest_dir: Some(dest_dir.path()),
            },
            &store,
            &history,
            &PureWriter,
            &job,
        )
        .unwrap();
        assert_eq!(report.done_count, 1);
        assert_eq!(report.failed_count, 0);
        assert_eq!(report.outputs.len(), 1);
        let output_path = PathBuf::from(&report.outputs[0].path);
        assert!(output_path.exists());
        assert_eq!(
            output_path.file_name().and_then(|name| name.to_str()),
            Some("photo.jpg")
        );
        assert_eq!(fs::read(&source_path).unwrap(), source);
        let copied = fs::read(&output_path).unwrap();
        let packet = read_xmp(ImageFormat::Jpeg, &copied).unwrap().unwrap();
        assert!(std::str::from_utf8(&packet).unwrap().contains("holiday"));

        let copy_key = fs_service::capture_file_identity(&output_path).unwrap();
        let rows = store.assignments(&[copy_key]).unwrap();
        assert_eq!(rows[0].tag_ids, vec![tag.id]);
        assert_eq!(job.progress_calls.get(), 2);
    }

    #[test]
    fn an_untagged_source_is_never_copied() {
        let dir = tempfile::tempdir().unwrap();
        let source_path = dir.path().join("plain.jpg");
        fs::write(&source_path, jpeg_fixture(None)).unwrap();
        let store = TagStore::open_in_memory().unwrap();
        let history = TagHistory::default();
        let job = CountingJob::new();
        let report = write_embedded_copies(
            &[display_path(&source_path)],
            EmbeddedWriteMode::NewCopy {
                dest_dir: Some(dir.path()),
            },
            &store,
            &history,
            &PureWriter,
            &job,
        )
        .unwrap();
        assert_eq!(report.skipped_count, 1);
        assert_eq!(report.outputs_created, 0);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
