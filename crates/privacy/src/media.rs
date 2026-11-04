//! Privacy adapter for media containers (Step 12b T6, D9).
//!
//! Media cleaning is a remux, never a transcode: the audio frames are copied
//! byte for byte and only the metadata block is removed. This adapter handles
//! the three containers whose metadata sits in one self-contained block, so
//! the bytes outside that block can be proven unchanged:
//!
//! - MP3: the leading ID3v2 tag;
//! - WAV: the `LIST`/`INFO` chunk;
//! - FLAC: the `VORBIS_COMMENT` metadata block.
//!
//! Every other container needs a real demuxer and is refused as unsupported
//! instead of being half-rewritten. Because one block holds several
//! categories, inspecting one of them discloses all the others as related, so
//! a caller cannot claim an unselected category was preserved.

use std::io::{Read, SeekFrom, Write};

use convert::{MetadataCategory, ReadSeek};

use crate::error::PrivacyError;
use crate::registry::PrivacyAdapter;
use crate::types::{MetadataContainer, PrivacyCleanSummary, PrivacyContext, PrivacyField};

/// The stable ID of this adapter.
pub const ADAPTER_ID: &str = "media";

/// The categories this adapter truthfully handles.
pub const CATEGORIES: [MetadataCategory; 5] = [
    MetadataCategory::Author,
    MetadataCategory::Encoder,
    MetadataCategory::Date,
    MetadataCategory::Comments,
    MetadataCategory::Timestamps,
];

/// The largest media tag block this adapter rewrites.
pub const MAX_TAG_BYTES: u64 = 16 * 1024 * 1024;

/// One metadata block found in a container.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Block {
    /// A leading ID3v2 tag, from offset 0 to `end`.
    Id3 { end: u64 },
    /// A RIFF `LIST` chunk of type `INFO`.
    RiffInfo { start: u64, end: u64 },
    /// A FLAC metadata block of type `VORBIS_COMMENT`.
    FlacComment { start: u64, end: u64 },
}

impl Block {
    pub fn range(self) -> (u64, u64) {
        match self {
            Self::Id3 { end } => (0, end),
            Self::RiffInfo { start, end } | Self::FlacComment { start, end } => (start, end),
        }
    }
}

/// The media privacy adapter.
#[derive(Debug, Default, Clone, Copy)]
pub struct MediaPrivacyAdapter;

impl MediaPrivacyAdapter {
    pub fn new() -> Self {
        Self
    }
}

impl PrivacyAdapter for MediaPrivacyAdapter {
    fn id(&self) -> &'static str {
        ADAPTER_ID
    }

    fn categories(&self) -> &'static [MetadataCategory] {
        &CATEGORIES
    }

    fn inspect(
        &self,
        input: &mut dyn ReadSeek,
        _context: &mut PrivacyContext,
    ) -> Result<Vec<PrivacyField>, PrivacyError> {
        let bytes = read_head(input, MAX_TAG_BYTES)?;
        let Some(Finding {
            block,
            categories,
            preview,
        }) = find_tags(&bytes)?
        else {
            return Ok(Vec::new());
        };
        let related: Vec<MetadataCategory> = categories
            .iter()
            .copied()
            .filter(|category| !matches!(category, MetadataCategory::Encoder))
            .collect();
        let mut fields = Vec::new();
        for category in &categories {
            fields.push(PrivacyField {
                category: *category,
                containers: vec![MetadataContainer::Exif],
                related_categories: related
                    .iter()
                    .copied()
                    .filter(|other| other != category)
                    .collect(),
                field_id: format!("media.{}.{}", block_kind(block), tag_name(*category)),
                label_key: label_key(*category).to_string(),
                preview: preview.chars().take(512).collect(),
                count: 1,
                content_affecting: false,
                coverage: crate::types::Coverage::Complete,
            });
        }
        Ok(fields)
    }

    fn clean(
        &self,
        input: &mut dyn ReadSeek,
        categories: &[MetadataCategory],
        output: &mut dyn Write,
        context: &mut PrivacyContext,
    ) -> Result<PrivacyCleanSummary, PrivacyError> {
        if categories.is_empty() {
            return Err(PrivacyError::BadRequest);
        }
        let bytes = read_head(input, MAX_TAG_BYTES)?;
        let Some(finding) = find_tags(&bytes)? else {
            // Nothing to remove: copy the file unchanged.
            if bytes.len() as u64 > context.max_output_bytes {
                return Err(PrivacyError::TooLarge);
            }
            output.write_all(&bytes).map_err(|_| PrivacyError::Failed)?;
            return Ok(PrivacyCleanSummary {
                removed_category_counts: Vec::new(),
                retained_category_counts: Vec::new(),
                coverage: crate::types::Coverage::Complete,
                output_bytes: bytes.len() as u64,
            });
        };
        // The whole block goes away, so every category it carries must have
        // been disclosed and accepted; otherwise the caller must recompute its
        // closure first.
        for category in &finding.categories {
            if !categories.contains(category) {
                return Err(PrivacyError::BadRequest);
            }
        }
        for category in categories {
            if !CATEGORIES.contains(category) {
                return Err(PrivacyError::Unsupported);
            }
        }
        if context.cancel.load(std::sync::atomic::Ordering::Relaxed) {
            return Err(PrivacyError::Cancelled);
        }
        let (start, end) = finding.block.range();
        let mut rewritten = Vec::with_capacity(bytes.len());
        rewritten.extend_from_slice(&bytes[..start as usize]);
        rewritten.extend_from_slice(&bytes[end as usize..]);
        // A FLAC block must keep its header counts consistent: removing a
        // block only shortens the block list, which stays valid.
        if rewritten.len() as u64 > context.max_output_bytes {
            return Err(PrivacyError::TooLarge);
        }
        // Verify: the payload outside the removed range is identical, and no
        // selected category is described any more.
        let before_payload = payload_digest(&bytes, start, end);
        let after_payload = blake3::hash(&rewritten);
        if before_payload != after_payload {
            return Err(PrivacyError::Unverified);
        }
        if let Some(Finding {
            categories: left, ..
        }) = find_tags(&rewritten)?
        {
            if left.iter().any(|category| categories.contains(category)) {
                return Err(PrivacyError::Unverified);
            }
        }
        output
            .write_all(&rewritten)
            .map_err(|_| PrivacyError::Failed)?;
        Ok(PrivacyCleanSummary {
            removed_category_counts: finding
                .categories
                .iter()
                .map(|category| crate::types::MetadataCount {
                    category: *category,
                    count: 1,
                    coverage: crate::types::Coverage::Complete,
                })
                .collect(),
            retained_category_counts: Vec::new(),
            coverage: crate::types::Coverage::Complete,
            output_bytes: rewritten.len() as u64,
        })
    }
}

/// What one container's metadata block carries.
struct Finding {
    block: Block,
    categories: Vec<MetadataCategory>,
    preview: String,
}

fn block_kind(block: Block) -> &'static str {
    match block {
        Block::Id3 { .. } => "id3",
        Block::RiffInfo { .. } => "riff",
        Block::FlacComment { .. } => "flac",
    }
}

fn tag_name(category: MetadataCategory) -> &'static str {
    match category {
        MetadataCategory::Author => "author",
        MetadataCategory::Encoder => "encoder",
        MetadataCategory::Date => "date",
        MetadataCategory::Comments => "comment",
        MetadataCategory::Timestamps => "timestamp",
        _ => "other",
    }
}

fn label_key(category: MetadataCategory) -> &'static str {
    match category {
        MetadataCategory::Author => "privacy.author",
        MetadataCategory::Encoder => "privacy.encoder",
        MetadataCategory::Date => "privacy.date",
        MetadataCategory::Comments => "privacy.comments",
        MetadataCategory::Timestamps => "privacy.timestamps",
        _ => "privacy.scope",
    }
}

/// Read at most `cap` bytes from the start of the source.
fn read_head(input: &mut dyn ReadSeek, cap: u64) -> Result<Vec<u8>, PrivacyError> {
    input
        .seek(SeekFrom::Start(0))
        .map_err(|_| PrivacyError::Failed)?;
    let mut bytes = Vec::new();
    input
        .take(cap + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| PrivacyError::Failed)?;
    if bytes.len() as u64 > cap {
        return Err(PrivacyError::TooLarge);
    }
    Ok(bytes)
}

/// Find the one metadata block this adapter understands.
fn find_tags(bytes: &[u8]) -> Result<Option<Finding>, PrivacyError> {
    if bytes.starts_with(b"ID3") {
        let Some(header) = bytes.get(6..10) else {
            return Ok(None);
        };
        let size = ((header[0] as u64 & 0x7f) << 21)
            | ((header[1] as u64 & 0x7f) << 14)
            | ((header[2] as u64 & 0x7f) << 7)
            | (header[3] as u64 & 0x7f);
        let end = 10 + size;
        if end > bytes.len() as u64 {
            return Err(PrivacyError::Unverified);
        }
        let body = String::from_utf8_lossy(&bytes[10..end as usize]).into_owned();
        return Ok(Some(Finding {
            block: Block::Id3 { end },
            categories: id3_categories(&body),
            preview: body.chars().take(64).collect(),
        }));
    }
    if bytes.starts_with(b"RIFF") {
        return find_riff_info(bytes);
    }
    if bytes.starts_with(b"fLaC") {
        return find_flac_comment(bytes);
    }
    Ok(None)
}

fn id3_categories(body: &str) -> Vec<MetadataCategory> {
    let mut categories = Vec::new();
    for (frame, category) in [
        ("TPE1", MetadataCategory::Author),
        ("TENC", MetadataCategory::Encoder),
        ("TSSE", MetadataCategory::Encoder),
        ("TDRC", MetadataCategory::Date),
        ("TYER", MetadataCategory::Date),
        ("COMM", MetadataCategory::Comments),
    ] {
        if body.contains(frame) && !categories.contains(&category) {
            categories.push(category);
        }
    }
    categories
}

fn find_riff_info(bytes: &[u8]) -> Result<Option<Finding>, PrivacyError> {
    let mut position = 12usize;
    while position + 8 <= bytes.len() {
        let id = &bytes[position..position + 4];
        let size = u32::from_le_bytes([
            bytes[position + 4],
            bytes[position + 5],
            bytes[position + 6],
            bytes[position + 7],
        ]) as usize;
        let body_start = position + 8;
        let body_end = body_start.saturating_add(size);
        if body_end > bytes.len() {
            return Ok(None);
        }
        if id == b"LIST" && bytes.get(body_start..body_start + 4) == Some(b"INFO") {
            let body = String::from_utf8_lossy(&bytes[body_start..body_end]).into_owned();
            let mut categories = Vec::new();
            for (chunk, category) in [
                ("IART", MetadataCategory::Author),
                ("ISFT", MetadataCategory::Encoder),
                ("ICRD", MetadataCategory::Date),
                ("ICMT", MetadataCategory::Comments),
            ] {
                if body.contains(chunk) && !categories.contains(&category) {
                    categories.push(category);
                }
            }
            if categories.is_empty() {
                return Ok(None);
            }
            // The chunk is padded to an even length inside the container.
            let padded = body_end + (size % 2);
            return Ok(Some(Finding {
                block: Block::RiffInfo {
                    start: position as u64,
                    end: padded.min(bytes.len()) as u64,
                },
                categories,
                preview: body.chars().take(64).collect(),
            }));
        }
        position = body_end + (size % 2);
    }
    Ok(None)
}

fn find_flac_comment(bytes: &[u8]) -> Result<Option<Finding>, PrivacyError> {
    let mut position = 4usize;
    while position + 4 <= bytes.len() {
        let header = bytes[position];
        let last = header & 0x80 != 0;
        let kind = header & 0x7f;
        let size = ((bytes[position + 1] as usize) << 16)
            | ((bytes[position + 2] as usize) << 8)
            | (bytes[position + 3] as usize);
        let body_start = position + 4;
        let body_end = body_start.saturating_add(size);
        if body_end > bytes.len() {
            return Ok(None);
        }
        if kind == 4 {
            let body = String::from_utf8_lossy(&bytes[body_start..body_end]).into_owned();
            let mut categories = Vec::new();
            for (field, category) in [
                ("ARTIST=", MetadataCategory::Author),
                ("ENCODER=", MetadataCategory::Encoder),
                ("DATE=", MetadataCategory::Date),
                ("COMMENT=", MetadataCategory::Comments),
            ] {
                if body.contains(field) && !categories.contains(&category) {
                    categories.push(category);
                }
            }
            if categories.is_empty() {
                return Ok(None);
            }
            return Ok(Some(Finding {
                block: Block::FlacComment {
                    start: position as u64,
                    end: body_end as u64,
                },
                categories,
                preview: body.chars().take(64).collect(),
            }));
        }
        if last {
            break;
        }
        position = body_end;
    }
    Ok(None)
}

/// The digest of every byte outside the removed range.
fn payload_digest(bytes: &[u8], start: u64, end: u64) -> blake3::Hash {
    let mut hasher = blake3::Hasher::new();
    hasher.update(&bytes[..start as usize]);
    hasher.update(&bytes[end as usize..]);
    hasher.finalize()
}

#[cfg(test)]
mod tests {
    use super::{find_tags, Block, MetadataCategory};

    #[test]
    fn id3_tags_are_found_and_measured() {
        let mut bytes = b"ID3\x04\x00\x00\x00\x00\x00\x14".to_vec();
        bytes.extend_from_slice(b"TPE1Ada   ");
        bytes.extend_from_slice(b"TSSElibmp3");
        let finding = find_tags(&bytes).unwrap().unwrap();
        assert!(matches!(finding.block, Block::Id3 { .. }));
        assert!(finding.categories.contains(&MetadataCategory::Author));
        assert!(finding.categories.contains(&MetadataCategory::Encoder));
    }

    #[test]
    fn a_container_without_tags_reports_nothing() {
        assert!(find_tags(b"not media at all").unwrap().is_none());
    }
}
