//! Native revalidation of every content-transfer field (Step 09c T1).
//!
//! The renderer validates too, but nothing here trusts it. Limits are
//! rechecked, snapshots must be 08a identities, and sensitivity is ORed
//! with the authoritative source and snapshot policies so a caller can
//! never lower it.

use std::collections::HashSet;

use crate::document_types::DocumentRef;
use crate::export_snapshot_types::{StoragePolicy, MAX_SNAPSHOT_BYTES};
use crate::transfer_types::*;

fn scalar_count(text: &str, limit: usize) -> usize {
    text.chars().take(limit.saturating_add(1)).count()
}

fn valid_mime(mime: &str) -> bool {
    !mime.is_empty()
        && mime.len() <= 128
        && mime
            .bytes()
            .all(|byte| byte.is_ascii_graphic() && byte != b'"' && byte != b'\\')
}

fn validate_snapshot(
    snapshot: &crate::export_snapshot_types::ExportSnapshot,
) -> Result<(), TransferError> {
    if !is_transfer_uuid(&snapshot.snapshot_id) || snapshot.revision == 0 {
        return Err(TransferError::Invalid);
    }
    if snapshot.document_id.is_empty() || snapshot.document_id.chars().count() > 128 {
        return Err(TransferError::Invalid);
    }
    if !valid_mime(&snapshot.mime) || snapshot.expires_unix == 0 {
        return Err(TransferError::Invalid);
    }
    if snapshot.byte_len > MAX_SNAPSHOT_BYTES {
        return Err(TransferError::TooLarge);
    }
    Ok(())
}

fn validate_marks(marks: &[TransferMark]) -> Result<(), TransferError> {
    if marks.len() > MAX_TRANSFER_MARKS_PER_RUN {
        return Err(TransferError::TooLarge);
    }
    let mut seen = 0u8;
    for mark in marks {
        let bit = match mark {
            TransferMark::Bold => 1,
            TransferMark::Italic => 2,
            TransferMark::Underline => 4,
            TransferMark::Strike => 8,
            TransferMark::Code => 16,
            TransferMark::Foreground { .. } => 32,
        };
        if seen & bit != 0 {
            return Err(TransferError::Invalid);
        }
        seen |= bit;
    }
    Ok(())
}

fn validate_block(block: &TransferBlock) -> Result<(), TransferError> {
    if block.depth > MAX_TRANSFER_BLOCK_DEPTH || block.runs.len() > MAX_TRANSFER_RUNS_PER_BLOCK {
        return Err(TransferError::TooLarge);
    }
    for run in &block.runs {
        validate_marks(&run.marks)?;
    }
    match block.kind {
        TransferBlockKind::Paragraph | TransferBlockKind::ListItem => {
            if block.level.is_some() {
                return Err(TransferError::Invalid);
            }
        }
        TransferBlockKind::Heading => {
            if let Some(level) = block.level {
                if !(1..=6).contains(&level) {
                    return Err(TransferError::Invalid);
                }
            }
        }
    }
    if block.list_order.is_some() && block.kind != TransferBlockKind::ListItem {
        return Err(TransferError::Invalid);
    }
    Ok(())
}

fn validate_format(format: &TransferCellFormat) -> Result<(), TransferError> {
    if let Some(number_format) = &format.number_format {
        if number_format.chars().count() > MAX_TRANSFER_CELL_FORMAT {
            return Err(TransferError::TooLarge);
        }
    }
    Ok(())
}

fn validate_cell(cell: &TransferCell) -> Result<(), TransferError> {
    if let Some(format) = &cell.format {
        validate_format(format)?;
    }
    match cell.kind {
        TransferCellKind::Text => {
            let Some(text) = &cell.text else {
                return Err(TransferError::Invalid);
            };
            if cell.number.is_some() || cell.boolean.is_some() {
                return Err(TransferError::Invalid);
            }
            if text.encode_utf16().count() > MAX_TRANSFER_CELL_TEXT_UTF16 {
                return Err(TransferError::TooLarge);
            }
        }
        TransferCellKind::Number => {
            let Some(number) = cell.number else {
                return Err(TransferError::Invalid);
            };
            if !number.is_finite() || cell.text.is_some() || cell.boolean.is_some() {
                return Err(TransferError::Invalid);
            }
        }
        TransferCellKind::Boolean => {
            if cell.boolean.is_none() || cell.text.is_some() || cell.number.is_some() {
                return Err(TransferError::Invalid);
            }
        }
        TransferCellKind::Blank => {
            if cell.text.is_some() || cell.number.is_some() || cell.boolean.is_some() {
                return Err(TransferError::Invalid);
            }
        }
    }
    Ok(())
}

fn plain_path(path: &str) -> String {
    path.strip_prefix("\\\\?\\").unwrap_or(path).replace('/', "\\").to_lowercase()
}

fn source_key(source: &DocumentRef) -> String {
    match source {
        DocumentRef::Disk { path } => format!("disk:{}", plain_path(path)),
        DocumentRef::Virtual {
            provider,
            container_path,
            entry_id,
        } => format!("virtual:{provider}:{}:{}", plain_path(container_path), entry_id.to_lowercase()),
        DocumentRef::Draft { draft_id } => format!("draft:{}", draft_id.to_lowercase()),
    }
}

pub fn validate_export_snapshot(
    snapshot: &crate::export_snapshot_types::ExportSnapshot,
) -> Result<(), TransferError> {
    validate_snapshot(snapshot)
}

pub fn validate_transfer_payload(payload: &TransferPayload) -> Result<(), TransferError> {
    match payload {
        TransferPayload::Text { text } => {
            if scalar_count(text, MAX_TRANSFER_TEXT_SCALARS) > MAX_TRANSFER_TEXT_SCALARS {
                return Err(TransferError::TooLarge);
            }
        }
        TransferPayload::RichText { blocks } => {
            if blocks.is_empty() || blocks.len() > MAX_TRANSFER_RICH_BLOCKS {
                return Err(if blocks.is_empty() {
                    TransferError::Invalid
                } else {
                    TransferError::TooLarge
                });
            }
            for block in blocks {
                validate_block(block)?;
            }
            let bytes = serde_json::to_vec(blocks).map_err(|_| TransferError::Invalid)?;
            if bytes.len() > MAX_TRANSFER_RICH_BYTES {
                return Err(TransferError::TooLarge);
            }
        }
        TransferPayload::Cells {
            rows,
            row_count,
            column_count,
        } => {
            if *row_count < 1 || *column_count < 1 || *column_count > MAX_TRANSFER_COLUMNS {
                return Err(TransferError::Invalid);
            }
            if rows.len() != *row_count as usize
                || rows.len() > MAX_TRANSFER_CELLS / *column_count as usize
            {
                return Err(if rows.len() != *row_count as usize {
                    TransferError::Invalid
                } else {
                    TransferError::TooLarge
                });
            }
            for row in rows {
                if row.len() != *column_count as usize {
                    return Err(TransferError::Invalid);
                }
                for cell in row {
                    validate_cell(cell)?;
                }
            }
            let bytes = serde_json::to_vec(rows).map_err(|_| TransferError::Invalid)?;
            if bytes.len() > MAX_TRANSFER_CELL_BYTES {
                return Err(TransferError::TooLarge);
            }
        }
        TransferPayload::Image {
            snapshot,
            width,
            height,
        } => {
            validate_export_snapshot(snapshot)?;
            if !snapshot.mime.to_ascii_lowercase().starts_with("image/") {
                return Err(TransferError::Unsupported);
            }
            if *width == 0 || *height == 0 {
                return Err(TransferError::Invalid);
            }
        }
        TransferPayload::PdfPages { snapshot, pages } => {
            validate_export_snapshot(snapshot)?;
            if !snapshot.mime.eq_ignore_ascii_case("application/pdf") {
                return Err(TransferError::Unsupported);
            }
            if pages.is_empty() {
                return Err(TransferError::Invalid);
            }
            if pages.len() > MAX_TRANSFER_PDF_PAGES {
                return Err(TransferError::TooLarge);
            }
            let mut previous = 0u32;
            for page in pages {
                if *page < 1 || *page <= previous {
                    return Err(TransferError::Invalid);
                }
                previous = *page;
            }
        }
        TransferPayload::Files { sources } => {
            if sources.is_empty() {
                return Err(TransferError::Invalid);
            }
            if sources.len() > MAX_TRANSFER_FILE_SOURCES {
                return Err(TransferError::TooLarge);
            }
            let mut seen = HashSet::new();
            for source in sources {
                source.validate().map_err(|_| TransferError::Invalid)?;
                if !seen.insert(source_key(source)) {
                    return Err(TransferError::Invalid);
                }
            }
        }
    }
    Ok(())
}

/// Validate an envelope and return it with the authoritative sensitivity.
pub fn validate_transfer_envelope(
    mut envelope: TransferEnvelope,
    native_sensitive: bool,
) -> Result<TransferEnvelope, TransferError> {
    if !is_transfer_uuid(&envelope.transfer_id) || envelope.expires_unix == 0 {
        return Err(TransferError::Invalid);
    }
    if let Some(document_id) = &envelope.source_document_id {
        if !is_transfer_uuid(document_id) {
            return Err(TransferError::Invalid);
        }
    }
    if let Some(revision) = envelope.source_revision {
        if revision == 0 {
            return Err(TransferError::Invalid);
        }
    }
    if envelope.source_revision.is_some() && envelope.source_document_id.is_none() {
        return Err(TransferError::Invalid);
    }
    if let Some(tab_id) = &envelope.source_tab_id {
        if !valid_source_tab_id(tab_id) {
            return Err(TransferError::Invalid);
        }
    }
    validate_transfer_payload(&envelope.payload)?;
    let mut policy = StoragePolicy::Ordinary;
    if let TransferPayload::Image { snapshot, .. } | TransferPayload::PdfPages { snapshot, .. } =
        &envelope.payload
    {
        let Some(document_id) = envelope.source_document_id.as_deref() else {
            return Err(TransferError::Invalid);
        };
        let Some(revision) = envelope.source_revision else {
            return Err(TransferError::Invalid);
        };
        if snapshot.document_id != document_id || snapshot.revision != revision {
            return Err(TransferError::Changed);
        }
        policy = snapshot.storage_policy;
    }
    envelope.sensitive = effective_sensitive(envelope.sensitive, native_sensitive, policy);
    Ok(envelope)
}

fn validate_losses(losses: &[String]) -> Result<(), TransferError> {
    if losses.len() > MAX_TRANSFER_LOSSES {
        return Err(TransferError::Invalid);
    }
    let mut seen = HashSet::new();
    for loss in losses {
        if !is_loss_key(loss) || !seen.insert(loss.as_str()) {
            return Err(TransferError::Invalid);
        }
    }
    Ok(())
}

#[allow(dead_code)]
pub fn validate_transfer_action(action: &TransferAction) -> Result<(), TransferError> {
    if !valid_transfer_key(&action.label_key) {
        return Err(TransferError::Invalid);
    }
    validate_losses(&action.losses)
}

#[allow(dead_code)]
pub fn validate_transfer_receipt(receipt: &TransferReceipt) -> Result<(), TransferError> {
    if !is_transfer_uuid(&receipt.transaction_id) {
        return Err(TransferError::Invalid);
    }
    if let Some(document_id) = &receipt.target_document_id {
        if !is_transfer_uuid(document_id) {
            return Err(TransferError::Invalid);
        }
    }
    if let Some(revision) = receipt.revision {
        if revision == 0 {
            return Err(TransferError::Invalid);
        }
    }
    validate_losses(&receipt.losses)
}
