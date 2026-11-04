//! Resolve a clipboard item into an authoritative 09c transfer (Step 09j
//! T4). Text and files become bounded payloads; an image is uploaded into
//! an 08a snapshot under a native authority, so no bytes travel as JSON
//! and the transfer registry keeps the bytes alive until release.

use uuid::Uuid;

use crate::clipboard_history_payload::{any_file_missing, validate_text};
use crate::clipboard_history_types::{
    ClipboardHistoryKind, HistoryItem, HistoryPayload,
};
use crate::document_types::DocumentRef;
use crate::export_snapshot_types::SnapshotBeginRequest;
use crate::transfer_types::{TransferEnvelope, TransferPayload};

use crate::clipboard_history::ClipboardHistoryState;

impl ClipboardHistoryState {
    /// Resolve one history item into an authoritative 09c transfer. The
    /// caller is responsible for releasing it after the target commits.
    pub fn resolve(
        &self,
        id: &str,
        target_document_id: Option<&str>,
    ) -> Result<TransferEnvelope, String> {
        if let Some(target) = target_document_id {
            Uuid::parse_str(target).map_err(|_| "clipboard_history.invalid".to_string())?;
        }
        self.load_if_needed();
        let item = {
            let inner = self.lock()?;
            inner
                .history
                .get(id)
                .cloned()
                .ok_or_else(|| "clipboard_history.changed".to_string())?
        };
        if item.sensitive {
            return Err("clipboard_history.private".to_string());
        }
        match item.kind {
            ClipboardHistoryKind::Text => {
                let HistoryPayload::Text(text) = &item.payload else {
                    return Err("clipboard_history.invalid".to_string());
                };
                validate_text(text)?;
                self.transfers
                    .create(None, TransferPayload::Text { text: text.to_string() })
                    .map_err(String::from)
            }
            ClipboardHistoryKind::Files => {
                let HistoryPayload::Files(paths) = &item.payload else {
                    return Err("clipboard_history.invalid".to_string());
                };
                if any_file_missing(paths) {
                    self.mark_missing(item.id)?;
                    return Err("clipboard_history.changed".to_string());
                }
                let sources = paths
                    .iter()
                    .map(|path| DocumentRef::Disk { path: path.clone() })
                    .collect();
                self.transfers
                    .create(None, TransferPayload::Files { sources })
                    .map_err(String::from)
            }
            ClipboardHistoryKind::Image => self.resolve_image(&item),
        }
    }

    fn resolve_image(&self, item: &HistoryItem) -> Result<TransferEnvelope, String> {
        let HistoryPayload::Image {
            mime,
            width,
            height,
            bytes,
        } = &item.payload
        else {
            return Err("clipboard_history.invalid".to_string());
        };
        let name = format!("Clipboard image.{}", extension_for(mime));
        self.snapshots
            .authorities()
            .register_native(item.id, &name, mime, None, false)
            .map_err(|_| "clipboard_history.io".to_string())?;
        let begun = self
            .snapshots
            .begin(SnapshotBeginRequest {
                document_id: item.id,
                revision: 1,
                content_id: item.id,
                mime: mime.clone(),
                byte_len: bytes.len() as u64,
                source: None,
            })
            .map_err(|_| "clipboard_history.io".to_string())?;
        let mut offset = 0usize;
        while offset < bytes.len() {
            let end = (offset + 1024 * 1024).min(bytes.len());
            if self
                .snapshots
                .append(&begun.snapshot_id, &begun.upload_token, offset as u64, &bytes[offset..end])
                .is_err()
            {
                let _ = self.snapshots.abort_upload(&begun.snapshot_id);
                return Err("clipboard_history.io".to_string());
            }
            offset = end;
        }
        let snapshot = match self.snapshots.finish(&begun.snapshot_id) {
            Ok(snapshot) => snapshot,
            Err(_) => {
                let _ = self.snapshots.abort_upload(&begun.snapshot_id);
                return Err("clipboard_history.io".to_string());
            }
        };
        self.transfers
            .create(
                None,
                TransferPayload::Image {
                    snapshot,
                    width: *width,
                    height: *height,
                },
            )
            .map_err(String::from)
    }

    fn mark_missing(&self, id: Uuid) -> Result<(), String> {
        let mut inner = self.lock()?;
        if let Some(item) = inner.history.items.iter_mut().find(|item| item.id == id) {
            item.missing = true;
        }
        Ok(())
    }
}

fn extension_for(mime: &str) -> &'static str {
    match mime.to_ascii_lowercase().as_str() {
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/tiff" => "tiff",
        _ => "png",
    }
}
