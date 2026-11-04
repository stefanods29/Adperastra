//! Privacy adapter for archive comments (Step 12b T6, D9).
//!
//! A ZIP archive can carry a comment that belongs to nobody's file. This
//! adapter reads and removes that comment by rewriting the central directory
//! only: every entry is copied raw, so no member is recompressed, renamed or
//! dropped.
//!
//! Entry timestamps are *not* offered here. Cleaning them means re-creating
//! the archive through the guarded archive conversion of 06e, and advertising
//! them here would claim a coverage this adapter cannot prove.

use std::io::{Cursor, Read, Write};

use convert::{MetadataCategory, ReadSeek};

use crate::error::PrivacyError;
use crate::registry::PrivacyAdapter;
use crate::types::{
    MetadataContainer, MetadataCount, PrivacyCleanSummary, PrivacyContext, PrivacyField,
};

/// The stable ID of this adapter.
pub const ADAPTER_ID: &str = "archive";

/// The categories this adapter truthfully handles.
pub const CATEGORIES: [MetadataCategory; 1] = [MetadataCategory::Comments];

/// At most 100,000 members.
pub const MAX_ENTRIES: usize = 100_000;
/// The longest archive comment this adapter will rewrite.
pub const MAX_COMMENT_BYTES: usize = 64 * 1024;

/// The archive privacy adapter.
#[derive(Debug, Default, Clone, Copy)]
pub struct ArchivePrivacyAdapter;

impl ArchivePrivacyAdapter {
    pub fn new() -> Self {
        Self
    }
}

impl PrivacyAdapter for ArchivePrivacyAdapter {
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
        let comment = read_comment(input)?;
        if comment.is_empty() {
            return Ok(Vec::new());
        }
        Ok(vec![PrivacyField {
            category: MetadataCategory::Comments,
            containers: vec![MetadataContainer::PdfStructure],
            related_categories: Vec::new(),
            field_id: "archive.zip.comment".to_string(),
            label_key: "privacy.comments".to_string(),
            preview: String::from_utf8_lossy(&comment)
                .chars()
                .take(512)
                .collect(),
            count: 1,
            content_affecting: false,
            coverage: crate::types::Coverage::Complete,
        }])
    }

    fn clean(
        &self,
        input: &mut dyn ReadSeek,
        categories: &[MetadataCategory],
        output: &mut dyn Write,
        context: &mut PrivacyContext,
    ) -> Result<PrivacyCleanSummary, PrivacyError> {
        if !categories.contains(&MetadataCategory::Comments) {
            return Err(PrivacyError::Unsupported);
        }
        if context.cancel.load(std::sync::atomic::Ordering::Relaxed) {
            return Err(PrivacyError::Cancelled);
        }
        let bytes = rewrite_without_comment(input)?;
        if bytes.len() as u64 > context.max_output_bytes {
            return Err(PrivacyError::TooLarge);
        }
        // Verify on the produced bytes, not on our intent.
        let mut cursor = Cursor::new(bytes.as_slice());
        if !read_comment(&mut cursor)?.is_empty() {
            return Err(PrivacyError::Unverified);
        }
        output.write_all(&bytes).map_err(|_| PrivacyError::Failed)?;
        Ok(PrivacyCleanSummary {
            removed_category_counts: vec![MetadataCount {
                category: MetadataCategory::Comments,
                count: 1,
                coverage: crate::types::Coverage::Complete,
            }],
            retained_category_counts: Vec::new(),
            coverage: crate::types::Coverage::Complete,
            output_bytes: bytes.len() as u64,
        })
    }
}

/// Read the archive comment, bounded.
fn read_comment(input: &mut dyn ReadSeek) -> Result<Vec<u8>, PrivacyError> {
    use std::io::SeekFrom;
    input
        .seek(SeekFrom::Start(0))
        .map_err(|_| PrivacyError::Failed)?;
    let archive = zip::ZipArchive::new(SourceRef(input)).map_err(|_| PrivacyError::BadRequest)?;
    if archive.len() > MAX_ENTRIES {
        return Err(PrivacyError::TooLarge);
    }
    let comment = archive.comment().to_vec();
    if comment.len() > MAX_COMMENT_BYTES {
        return Err(PrivacyError::TooLarge);
    }
    Ok(comment)
}

/// Rewrite the archive without its comment; every entry is copied raw.
fn rewrite_without_comment(input: &mut dyn ReadSeek) -> Result<Vec<u8>, PrivacyError> {
    use std::io::SeekFrom;
    input
        .seek(SeekFrom::Start(0))
        .map_err(|_| PrivacyError::Failed)?;
    let mut archive =
        zip::ZipArchive::new(SourceRef(input)).map_err(|_| PrivacyError::BadRequest)?;
    if archive.len() > MAX_ENTRIES {
        return Err(PrivacyError::TooLarge);
    }
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    writer.set_comment("").map_err(|_| PrivacyError::Failed)?;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|_| PrivacyError::BadRequest)?;
        writer
            .raw_copy_file(entry)
            .map_err(|_| PrivacyError::Failed)?;
    }
    let cursor = writer.finish().map_err(|_| PrivacyError::Failed)?;
    Ok(cursor.into_inner())
}

/// A read-only view of the source for the ZIP reader.
struct SourceRef<'a>(&'a mut dyn ReadSeek);

impl Read for SourceRef<'_> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        self.0.read(buffer)
    }
}

impl std::io::Seek for SourceRef<'_> {
    fn seek(&mut self, position: std::io::SeekFrom) -> std::io::Result<u64> {
        self.0.seek(position)
    }
}

#[cfg(test)]
mod tests {
    use super::rewrite_without_comment;
    use std::io::{Cursor, Write};

    fn archive_with_comment() -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        writer.set_comment("private note").unwrap();
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        writer.start_file("keep.txt", options).unwrap();
        writer.write_all(b"Keep this document.").unwrap();
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn the_comment_is_removed_and_members_are_kept() {
        let source = archive_with_comment();
        let mut cursor = std::io::Cursor::new(source);
        let rewritten = rewrite_without_comment(&mut cursor).unwrap();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(rewritten)).unwrap();
        assert!(archive.comment().is_empty());
        let mut entry = archive.by_name("keep.txt").unwrap();
        let mut text = String::new();
        std::io::Read::read_to_string(&mut entry, &mut text).unwrap();
        assert_eq!(text, "Keep this document.");
    }
}
