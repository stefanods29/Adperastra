//! Native mirror of the sanitized document block model (Step 08b E6/E7).
//!
//! The trusted parser produces this shape; the PDF writer and later readers
//! consume it. There is no raw HTML, script, event attribute or remote URL
//! field. Every string is bounded and every image needs an authorized
//! descriptor. The TypeScript definition lives in
//! `src/convert/documentTypes.ts`.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};

pub const MAX_BLOCKS_PER_PAGE: usize = 256;
pub const MAX_BLOCK_TEXT_BYTES: usize = 64 * 1024;
pub const MAX_TABLE_ROWS: usize = 1_000;
pub const MAX_TABLE_COLUMNS: usize = 100;
pub const MAX_TABLE_CELLS: usize = 100_000;
pub const MAX_PAGE_CURSOR_UNITS: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HtmlBlock {
    Paragraph {
        text: String,
    },
    Heading {
        level: u8,
        text: String,
    },
    ListItem {
        ordered: bool,
        level: u8,
        text: String,
    },
    Code {
        text: String,
    },
    Table {
        cells: Vec<Vec<String>>,
        header: bool,
    },
    Image {
        image: HtmlBlockImage,
    },
}

/// One authorized local image. A helper grant and an immutable snapshot are
/// the only two descriptors; a path, URL or raw byte field does not exist.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HtmlBlockImage {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grant_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snapshot_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub document_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_id: Option<String>,
    pub mime: String,
    pub alt: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HtmlBlockPage {
    pub blocks: Vec<HtmlBlock>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    pub complete: bool,
}

/// The wire error code for a block or page outside E6.
pub fn validate_block(block: &HtmlBlock) -> Result<(), String> {
    match block {
        HtmlBlock::Paragraph { text } | HtmlBlock::Code { text } => validate_text(text),
        HtmlBlock::Heading { level, text } => {
            if !(1..=6).contains(level) {
                return Err("convert.bad_request".to_string());
            }
            validate_text(text)
        }
        HtmlBlock::ListItem { level, text, .. } => {
            if *level > 8 {
                return Err("convert.bad_request".to_string());
            }
            validate_text(text)
        }
        HtmlBlock::Table { cells, .. } => validate_table(cells),
        HtmlBlock::Image { image } => validate_image(image),
    }
}

pub fn validate_page(page: &HtmlBlockPage) -> Result<(), String> {
    if page.blocks.len() > MAX_BLOCKS_PER_PAGE {
        return Err("convert.bad_request".to_string());
    }
    if let Some(cursor) = &page.next_cursor {
        if cursor.is_empty() || cursor.len() > MAX_PAGE_CURSOR_UNITS || !cursor.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
            return Err("convert.bad_request".to_string());
        }
    }
    for block in &page.blocks {
        validate_block(block)?;
    }
    Ok(())
}

fn validate_text(text: &str) -> Result<(), String> {
    if text.len() > MAX_BLOCK_TEXT_BYTES || text.contains('\0') {
        Err("convert.bad_request".to_string())
    } else {
        Ok(())
    }
}

fn validate_table(cells: &[Vec<String>]) -> Result<(), String> {
    if cells.is_empty() || cells.len() > MAX_TABLE_ROWS {
        return Err("convert.bad_request".to_string());
    }
    let mut count = 0usize;
    for row in cells {
        if row.len() > MAX_TABLE_COLUMNS {
            return Err("convert.bad_request".to_string());
        }
        for cell in row {
            validate_text(cell)?;
            count += 1;
            if count > MAX_TABLE_CELLS {
                return Err("convert.bad_request".to_string());
            }
        }
    }
    Ok(())
}

fn validate_image(image: &HtmlBlockImage) -> Result<(), String> {
    if image.mime.is_empty() || image.mime.len() > 128 || image.alt.len() > 512 {
        return Err("convert.bad_request".to_string());
    }
    let has_grant = image.grant_id.as_deref().is_some_and(is_uuid);
    let has_snapshot = image.snapshot_id.as_deref().is_some_and(is_uuid)
        && image.document_id.as_deref().is_some_and(|value| !value.is_empty() && value.len() <= 128)
        && image.revision.is_some()
        && image.content_id.as_deref().is_some_and(is_uuid);
    if has_grant || has_snapshot {
        Ok(())
    } else {
        Err("convert.bad_request".to_string())
    }
}

fn is_uuid(value: &str) -> bool {
    value.len() == 36
        && value
            .chars()
            .enumerate()
            .all(|(index, ch)| match index {
                8 | 13 | 18 | 23 => ch == '-',
                _ => ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase(),
            })
}

/// Page a block list exactly like `src/convert/documentTypes.ts`.
pub fn paginate_blocks(
    blocks: &[HtmlBlock],
    offset: usize,
) -> (Vec<HtmlBlock>, Option<usize>, bool) {
    let start = offset.min(blocks.len());
    let end = (start + MAX_BLOCKS_PER_PAGE).min(blocks.len());
    (blocks[start..end].to_vec(), (end < blocks.len()).then_some(end), end >= blocks.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paragraph(text: &str) -> HtmlBlock {
        HtmlBlock::Paragraph {
            text: text.to_string(),
        }
    }

    #[test]
    fn a_page_is_bounded_to_256_blocks() {
        let pages = vec![paragraph("a"); MAX_BLOCKS_PER_PAGE + 1];
        assert!(validate_page(&HtmlBlockPage {
            blocks: pages,
            next_cursor: None,
            complete: true,
        })
        .is_err());
    }

    #[test]
    fn a_remote_image_has_no_representation() {
        let image = HtmlBlockImage {
            grant_id: None,
            snapshot_id: None,
            document_id: None,
            revision: None,
            content_id: None,
            mime: "image/png".to_string(),
            alt: "https://example.test/x.png".to_string(),
        };
        assert_eq!(validate_image(&image), Err("convert.bad_request".to_string()));
    }

    #[test]
    fn pagination_is_stable() {
        let blocks = vec![paragraph("a"); 300];
        let (first, next, complete) = paginate_blocks(&blocks, 0);
        assert_eq!(first.len(), MAX_BLOCKS_PER_PAGE);
        assert_eq!(next, Some(MAX_BLOCKS_PER_PAGE));
        assert!(!complete);
        let (second, next, complete) = paginate_blocks(&blocks, next.unwrap());
        assert_eq!(second.len(), 300 - MAX_BLOCKS_PER_PAGE);
        assert_eq!(next, None);
        assert!(complete);
    }
}
