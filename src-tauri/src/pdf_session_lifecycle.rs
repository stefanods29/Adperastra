//! Serialized native PDF admission and identity-checked helper reopening.
use super::*;
use crate::pdf_helper_process::PdfHelperProcess;
use crate::webview_helper_types::{HelperInputGrant, HelperInputSource};
use fs_service::CancellationToken;
use std::path::PathBuf;
use std::sync::{MutexGuard, TryLockError};
use zeroize::Zeroizing;

pub struct PdfResume {
    pub grant: HelperInputGrant,
    pub identity: PdfSourceIdentity,
    pub data_dir: PathBuf,
    pub password: Option<Zeroizing<String>>,
    pub retention: Option<Arc<dyn crate::pdf_snapshot_resolver::PdfSnapshotRetention>>,
}
impl PdfResume {
    pub fn start(&self, cancel: CancellationToken) -> Result<PdfHelperProcess, String> {
        if let HelperInputSource::Disk {
            path,
            expected,
            pinned,
        } = &self.grant.source
        {
            pinned.verify_after_read().map_err(|_| "pdf.changed")?;
            if fs_service::capture_source_stamp(path).map_err(|_| "pdf.changed")? != *expected {
                return Err("pdf.changed".into());
            }
        }
        PdfHelperProcess::start(
            self.grant.clone(),
            self.identity.clone(),
            self.data_dir.clone(),
            self.password
                .as_ref()
                .map(|password| password.as_str().to_owned()),
            self.retention.clone(),
            cancel,
        )
    }
}
impl PdfSessionEntry {
    pub fn set_resume(&self, resume: Arc<PdfResume>) -> Result<(), String> {
        *self.resume.lock().map_err(|_| "pdf.unavailable")? = Some(resume);
        Ok(())
    }
}
impl PdfSessions {
    /// A cancelled queued request never starts a new child. No table lock is
    /// retained during child close/start or parser work.
    pub fn operation(&self, cancel: &CancellationToken) -> Result<MutexGuard<'_, ()>, String> {
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err("pdf.changed".into());
            }
            match self.operations.try_lock() {
                Ok(guard) => return Ok(guard),
                Err(TryLockError::Poisoned(_)) => return Err("pdf.unavailable".into()),
                Err(TryLockError::WouldBlock) => {
                    std::thread::sleep(std::time::Duration::from_millis(25))
                }
            }
        }
    }
    /// Caller holds operation() across this reservation and child attachment.
    pub fn make_room_for_helper(&self, keep: Option<Uuid>) -> Result<(), String> {
        let candidate = {
            let table = self.sessions.lock().map_err(|_| "pdf.unavailable")?;
            if table
                .values()
                .filter(|entry| entry.active.load(Ordering::Relaxed))
                .count()
                < PDF_MAX_ACTIVE_SESSIONS
            {
                return Ok(());
            }
            table
                .values()
                .filter(|entry| Some(entry.id()) != keep && entry.active.load(Ordering::Relaxed))
                .min_by_key(|entry| entry.last_used.load(Ordering::Relaxed))
                .cloned()
        };
        let entry = candidate.ok_or_else(|| "pdf.unavailable".to_string())?;
        entry.helper.detach();
        entry.active.store(false, Ordering::Relaxed);
        Ok(())
    }
    pub fn with_helper<R>(
        &self,
        entry: &PdfSessionEntry,
        cancel: &CancellationToken,
        work: impl FnOnce(&mut PdfHelperProcess) -> Result<R, String>,
    ) -> Result<R, String> {
        let _operation = self.operation(cancel)?;
        if !entry.valid.load(Ordering::Relaxed) {
            return Err("pdf.changed".into());
        }
        if !entry.helper.is_attached() {
            self.make_room_for_helper(Some(entry.id()))?;
            let resume = entry
                .resume
                .lock()
                .map_err(|_| "pdf.unavailable")?
                .clone()
                .ok_or_else(|| "pdf.changed".to_string())?;
            let helper = resume.start(cancel.clone())?;
            if helper.page_count != entry.page_count() || helper.identity != entry.session.source {
                helper.close();
                return Err("pdf.changed".into());
            }
            self.attach(entry, helper)?;
        }
        let result = entry.helper.with(work);
        if entry
            .helper
            .with(|helper| Ok(helper.is_closed()))
            .unwrap_or(true)
        {
            entry.valid.store(false, Ordering::Relaxed);
            entry.helper.detach();
            entry.active.store(false, Ordering::Relaxed);
        }
        result
    }
}
