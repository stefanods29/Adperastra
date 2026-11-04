//! Clipboard-history service (Step 09j T4/T5).
//!
//! The bounded memory rules live in `clipboard_history_core`; this file
//! owns loading, recording app copies, persistence and resolving an item
//! into an authoritative 09c transfer. History is memory-only by default;
//! a load failure leaves it empty rather than falling back to plaintext.
#![allow(dead_code)]


use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use uuid::Uuid;

use crate::clipboard_history_core::History;
use crate::clipboard_history_payload::build_item;
use crate::clipboard_history_store::ClipboardHistoryStore;
use crate::clipboard_history_types::{
    CapturedPayload, ClipboardHistoryKind, ClipboardHistoryPage, ClipboardHistoryPatch,
    ClipboardHistorySettings, ClipboardHistorySource,
};
use crate::content_transfer::ContentTransfers;
use crate::document_types::DocumentRef;
use crate::export_snapshot_types::{now_unix, ExportSnapshot, StoragePolicy};
use crate::export_snapshots::ExportSnapshots;
use crate::transfer_types::TransferPayload;

pub(crate) struct Inner {
    settings: ClipboardHistorySettings,
    pub(crate) history: History,
    loaded: bool,
    load_failed: bool,
}

/// The managed clipboard-history service (behind an `Arc`).
pub struct ClipboardHistoryState {
    pub(crate) inner: Mutex<Inner>,
    load_lock: Mutex<()>,
    store: ClipboardHistoryStore,
    pub(crate) transfers: Arc<ContentTransfers>,
    pub(crate) snapshots: Arc<ExportSnapshots>,
}

impl ClipboardHistoryState {
    pub fn new(
        settings: ClipboardHistorySettings,
        root: PathBuf,
        transfers: Arc<ContentTransfers>,
        snapshots: Arc<ExportSnapshots>,
    ) -> Result<Arc<Self>, String> {
        settings.validate()?;
        let history = History::new(settings.effective_items(), settings.effective_bytes());
        Ok(Arc::new(ClipboardHistoryState {
            inner: Mutex::new(Inner {
                settings,
                history,
                loaded: false,
                load_failed: false,
            }),
            load_lock: Mutex::new(()),
            store: ClipboardHistoryStore::new(root),
            transfers,
            snapshots,
        }))
    }

    pub(crate) fn lock(&self) -> Result<MutexGuard<'_, Inner>, String> {
        self.inner
            .lock()
            .map_err(|_| "clipboard_history.io".to_string())
    }

    pub fn settings(&self) -> Result<ClipboardHistorySettings, String> {
        Ok(self.lock()?.settings.clone())
    }

    pub fn wants_windows_capture(&self) -> bool {
        self.lock()
            .map(|inner| inner.settings.enabled && inner.settings.capture_windows)
            .unwrap_or(false)
    }

    pub fn apply_settings(&self, settings: ClipboardHistorySettings) -> Result<(), String> {
        settings.validate()?;
        let mut inner = self.lock()?;
        inner.history.configure(
            settings.effective_items(),
            settings.effective_bytes(),
        );
        let newly_persistent = settings.persist && !inner.settings.persist;
        inner.settings = settings;
        if newly_persistent {
            inner.loaded = false;
        }
        Ok(())
    }

    pub(crate) fn load_if_needed(&self) {
        let needed = self
            .lock()
            .map(|inner| inner.settings.persist && !inner.loaded)
            .unwrap_or(false);
        if !needed {
            return;
        }
        let Ok(_guard) = self.load_lock.lock() else {
            return;
        };
        let still = self
            .lock()
            .map(|inner| inner.settings.persist && !inner.loaded)
            .unwrap_or(false);
        if !still {
            return;
        }
        let loaded = self.store.load();
        if let Ok(mut inner) = self.lock() {
            match loaded {
                Ok((items, generation)) => inner.history.restore(items, generation),
                Err(_) => inner.load_failed = true,
            }
            inner.loaded = true;
        }
    }

    pub fn had_load_failure(&self) -> bool {
        self.lock().map(|inner| inner.load_failed).unwrap_or(true)
    }

    fn persist_locked(&self, inner: &Inner) -> Result<(), String> {
        if !inner.settings.persist {
            return Ok(());
        }
        self.store
            .write(
                &inner.history.persist_entries(),
                inner.history.generation(),
            )
            .map_err(|_| "clipboard_history.io".to_string())
    }

    pub fn list(
        &self,
        query: &str,
        cursor: Option<&str>,
    ) -> Result<ClipboardHistoryPage, String> {
        self.load_if_needed();
        let mut inner = self.lock()?;
        inner.history.page(query, cursor)
    }

    pub fn patch(
        &self,
        patch: &ClipboardHistoryPatch,
    ) -> Result<ClipboardHistoryPage, String> {
        self.load_if_needed();
        let (page, revoked) = {
            let mut inner = self.lock()?;
            let removed_before: Vec<Uuid> = match patch {
                ClipboardHistoryPatch::Remove { ids, .. } => ids
                    .iter()
                    .filter_map(|id| Uuid::parse_str(id).ok())
                    .collect(),
                ClipboardHistoryPatch::Clear {
                    include_pinned, ..
                } => {
                    if *include_pinned {
                        inner.history.ids_of_kind(ClipboardHistoryKind::Image)
                    } else {
                        inner
                            .history
                            .items
                            .iter()
                            .filter(|item| {
                                item.kind == ClipboardHistoryKind::Image && !item.pinned
                            })
                            .map(|item| item.id)
                            .collect()
                    }
                }
                _ => Vec::new(),
            };
            let persist = inner.settings.persist;
            inner.history.apply_patch(patch)?;
            if persist {
                self.persist_locked(&inner)?;
            } else if matches!(patch, ClipboardHistoryPatch::Clear { .. }) {
                // "Clear history" must also remove a history the user saved
                // earlier, even when persistence is off right now.
                self.store
                    .clear_owned()
                    .map_err(|_| "clipboard_history.io".to_string())?;
            }
            (inner.history.page("", None)?, removed_before)
        };
        for id in revoked {
            let _ = self.snapshots.release_snapshot_authority(&id.to_string());
        }
        Ok(page)
    }

    /// Record one successful app copy from its authoritative transfer.
    pub fn record_transfer(&self, transfer_id: &str) -> Result<u64, String> {
        let envelope = self
            .transfers
            .get(transfer_id)
            .map_err(String::from)?;
        if envelope.sensitive {
            return Err("clipboard_history.private".to_string());
        }
        let captured = match envelope.payload {
            TransferPayload::Text { text } => CapturedPayload::Text(text),
            TransferPayload::Files { sources } => {
                let mut paths = Vec::new();
                for source in sources {
                    match source {
                        DocumentRef::Disk { path } => paths.push(path),
                        _ => return Err("clipboard_history.private".to_string()),
                    }
                }
                CapturedPayload::Files(paths)
            }
            TransferPayload::Image {
                snapshot,
                width,
                height,
            } => self.image_payload(&snapshot, width, height)?,
            _ => return Err("clipboard_history.invalid".to_string()),
        };
        self.insert_captured(captured, ClipboardHistorySource::App, None)
    }

    fn image_payload(
        &self,
        snapshot: &ExportSnapshot,
        width: u32,
        height: u32,
    ) -> Result<CapturedPayload, String> {
        let lease = self
            .snapshots
            .resolve(
                &snapshot.snapshot_id,
                &snapshot.document_id,
                snapshot.revision,
            )
            .map_err(|_| "clipboard_history.changed".to_string())?;
        if lease.snapshot.storage_policy == StoragePolicy::Sensitive {
            return Err("clipboard_history.private".to_string());
        }
        if lease.snapshot.byte_len == 0
            || lease.snapshot.byte_len > crate::clipboard_history_types::MAX_IMAGE_BYTES as u64
        {
            return Err("clipboard_history.too_large".to_string());
        }
        let length = usize::try_from(lease.snapshot.byte_len)
            .map_err(|_| "clipboard_history.too_large".to_string())?;
        let mut bytes = Vec::with_capacity(length);
        let mut offset = 0usize;
        while offset < length {
            let take = (length - offset).min(4 * 1024 * 1024);
            let chunk = lease
                .backing
                .read_range(offset as u64, take)
                .map_err(|_| "clipboard_history.io".to_string())?;
            if chunk.len() != take {
                return Err("clipboard_history.changed".to_string());
            }
            bytes.extend_from_slice(&chunk);
            offset += take;
        }
        Ok(CapturedPayload::Image {
            mime: lease.snapshot.mime.clone(),
            width,
            height,
            bytes,
        })
    }

    pub fn capture_window(&self, payload: CapturedPayload) -> Result<u64, String> {
        self.insert_captured(payload, ClipboardHistorySource::Windows, None)
    }

    fn insert_captured(
        &self,
        captured: CapturedPayload,
        source: ClipboardHistorySource,
        source_label: Option<String>,
    ) -> Result<u64, String> {
        self.load_if_needed();
        let (generation, revoked) = {
            let mut inner = self.lock()?;
            let before = inner.history.ids_of_kind(ClipboardHistoryKind::Image);
            let item = build_item(
                Uuid::new_v4(),
                captured,
                source,
                source_label,
                now_unix(),
            )?;
            if item.sensitive {
                return Err("clipboard_history.private".to_string());
            }
            let generation = inner.history.insert(item)?;
            self.persist_locked(&inner)?;
            let after = inner.history.ids_of_kind(ClipboardHistoryKind::Image);
            let revoked = before
                .into_iter()
                .filter(|id| !after.contains(id))
                .collect::<Vec<Uuid>>();
            (generation, revoked)
        };
        for id in revoked {
            let _ = self.snapshots.release_snapshot_authority(&id.to_string());
        }
        Ok(generation)
    }
}

/// The store directory under the app's data folder.
pub fn store_root(data_dir: &Path) -> PathBuf {
    data_dir.join("clipboard-history")
}
