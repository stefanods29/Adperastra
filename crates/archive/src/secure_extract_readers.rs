//! Reading files into the new owned output (Step 06e T3): bzip2 streams and
//! tar.bz2 now; password-protected formats and RAR use the same writer.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant, UNIX_EPOCH};

use fs_service::owned_io::{OwnedIoError, OwnedOutput};
use fs_service::CancellationToken;

use crate::entry::ArchiveFormat;
use crate::error::ArchiveError;
use crate::extract::{ExtractEvents, ExtractReport};
use crate::limits::{Limits, CHUNK_BYTES, MAX_SKIPPED_REPORT};
use crate::plan::{ExtractPlan, PlannedEntry, SkippedEntry};
use crate::secure_extract::ZoneWriter;
use crate::secure_extract_paths::{numbered, SecureTree, MAX_NUMBERED};

/// How often progress is reported at most.
const PROGRESS_EVERY: Duration = Duration::from_millis(100);

/// How one file write ended.
enum WriteEnd {
    Done,
    Skip(&'static str),
    Cancelled,
}

/// Reads files into owned staging and reports what really happened.
pub(crate) struct SecureWriter<'a> {
    tree: SecureTree,
    report: ExtractReport,
    events: &'a mut dyn ExtractEvents,
    token: &'a CancellationToken,
    zone: Option<String>,
    zone_writer: &'a dyn ZoneWriter,
    single_file: bool,
    items_total: usize,
    items_done: usize,
    bytes_done: u64,
    bytes_total: u64,
    last_progress: Instant,
}

impl<'a> SecureWriter<'a> {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        tree: SecureTree,
        plan: &ExtractPlan,
        events: &'a mut dyn ExtractEvents,
        token: &'a CancellationToken,
        zone: Option<String>,
        zone_writer: &'a dyn ZoneWriter,
        single_file: bool,
    ) -> Self {
        let listed = plan.skipped.len().min(MAX_SKIPPED_REPORT);
        let report = ExtractReport {
            skipped: plan.skipped[..listed].to_vec(),
            skipped_more: (plan.skipped.len() - listed) as u64,
            ..ExtractReport::default()
        };
        Self {
            tree,
            report,
            events,
            token,
            zone,
            zone_writer,
            single_file,
            items_total: plan.files.len(),
            items_done: 0,
            bytes_done: 0,
            bytes_total: plan.bytes_total,
            last_progress: Instant::now(),
        }
    }

    pub(crate) fn cancelled(&self) -> bool {
        self.report.cancelled
    }

    pub(crate) fn stop_requested(&self) -> bool {
        self.token.load(Ordering::Relaxed)
    }

    pub(crate) fn token(&self) -> &CancellationToken {
        self.token
    }

    pub(crate) fn has_created(&self) -> bool {
        !self.report.created.is_empty()
    }

    pub(crate) fn set_error(&mut self, code: &str) {
        self.report.error = Some(code.to_string());
    }

    pub(crate) fn cancel(&mut self) {
        self.report.cancelled = true;
    }

    /// A missing or wrong password. Before any output exists this is the
    /// whole result (the UI asks and may try again); afterwards the exact
    /// created list is kept and no work is repeated automatically.
    pub(crate) fn fail_password(
        &mut self,
        planned: &PlannedEntry,
        missing: bool,
    ) -> Result<(), ArchiveError> {
        let code = if missing {
            "archive.password_required"
        } else {
            "archive.bad_password"
        };
        if !self.has_created() {
            return Err(if missing {
                ArchiveError::PasswordRequired
            } else {
                ArchiveError::BadPassword
            });
        }
        self.set_error(code);
        self.skip(
            planned.inner.clone(),
            if missing {
                "password_required"
            } else {
                "bad_password"
            },
        );
        Ok(())
    }

    pub(crate) fn note_created(&mut self, path: &Path) {
        let text = path.to_string_lossy().into_owned();
        if self
            .report
            .created
            .iter()
            .any(|existing| existing.eq_ignore_ascii_case(&text))
        {
            return;
        }
        self.report.created.push(text);
        self.events.created(path);
    }

    pub(crate) fn skip(&mut self, path: String, reason: &str) {
        self.items_done += 1;
        if self.report.skipped.len() < MAX_SKIPPED_REPORT {
            self.report.skipped.push(SkippedEntry {
                path,
                reason: reason.to_string(),
            });
        } else {
            self.report.skipped_more += 1;
        }
    }

    pub(crate) fn create_folder(&mut self, planned: &PlannedEntry) {
        match self.tree.create_folder(&planned.relative) {
            Ok(path) => {
                self.report.folders_created += 1;
                self.items_done += 1;
                self.note_created(&path);
            }
            Err(reason) => self.skip(planned.inner.clone(), reason),
        }
        let root = self.tree.root().to_path_buf();
        self.progress(&root, false);
    }

    /// Write one planned file from its reader, then publish it.
    pub(crate) fn write_file(
        &mut self,
        planned: &PlannedEntry,
        reader: &mut dyn Read,
    ) -> Result<(), ArchiveError> {
        self.write_file_mode(planned, reader, false)
    }

    /// The same for an entry whose data is encrypted: a read or size
    /// failure is a password failure, never "damaged unencrypted data".
    pub(crate) fn write_file_encrypted(
        &mut self,
        planned: &PlannedEntry,
        reader: &mut dyn Read,
    ) -> Result<(), ArchiveError> {
        self.write_file_mode(planned, reader, true)
    }

    fn write_file_mode(
        &mut self,
        planned: &PlannedEntry,
        reader: &mut dyn Read,
        encrypted: bool,
    ) -> Result<(), ArchiveError> {
        if self.token.load(Ordering::Relaxed) {
            self.cancel();
            return Err(ArchiveError::Cancelled);
        }
        let hint = crate::path::name_of(&planned.inner).to_string();
        let (mut output, pin) = match self.tree.open_output(&planned.relative, &hint) {
            Ok(pair) => pair,
            Err(reason) => {
                self.skip(planned.inner.clone(), reason);
                let root = self.tree.root().to_path_buf();
                self.progress(&root, false);
                return Ok(());
            }
        };
        let mut read_bytes = 0u64;
        let result = write_into(
            &mut output,
            reader,
            planned.size,
            self.token,
            encrypted,
            &mut |read| read_bytes += read as u64,
        );
        self.bytes_done = self.bytes_done.saturating_add(read_bytes);
        match result {
            WriteEnd::Cancelled => {
                self.cancel();
                Err(ArchiveError::Cancelled)
            }
            WriteEnd::Skip(reason) => {
                if encrypted && !self.has_created() {
                    return Err(ArchiveError::BadPassword);
                }
                self.skip(planned.inner.clone(), reason);
                let root = self.tree.root().to_path_buf();
                self.progress(&root, false);
                Ok(())
            }
            WriteEnd::Done => {
                if let Some(time) = unix_time(planned.modified_unix) {
                    let times = fs::FileTimes::new().set_modified(time);
                    let _ = output.file_mut().set_times(times);
                }
                if output.flush_sync().is_err() {
                    self.skip(planned.inner.clone(), "other");
                    return Ok(());
                }
                if let Some(zone) = &self.zone {
                    if self.zone_writer.write(output.staging_path(), zone).is_err() {
                        // A required mark that cannot be preserved is never
                        // silently dropped: the file is not published.
                        self.skip(planned.inner.clone(), "other");
                        return Ok(());
                    }
                }
                let published = match self.publish(&mut output, planned) {
                    Ok(path) => path,
                    Err(reason) => {
                        self.skip(planned.inner.clone(), reason);
                        return Ok(());
                    }
                };
                drop(pin);
                self.report.files_written += 1;
                self.items_done += 1;
                if self.single_file {
                    self.report.opened = Some(published.to_string_lossy().into_owned());
                }
                if planned.relative.len() == 1 {
                    self.note_created(&published);
                } else if let Some(first) = planned.relative.first() {
                    self.note_created(&self.tree.top_path(first));
                }
                self.progress(&published, false);
                Ok(())
            }
        }
    }

    /// Publish under the planned name. Only a top-level file takes the next
    /// numbered name; anything nested reports `name_taken` instead.
    fn publish(
        &mut self,
        output: &mut OwnedOutput,
        planned: &PlannedEntry,
    ) -> Result<std::path::PathBuf, &'static str> {
        let Some(last) = planned.relative.last().cloned() else {
            return Err("invalid_name");
        };
        let top_file = planned.relative.len() == 1 && !self.tree.is_top_folder(&last);
        if !top_file {
            return match output.publish_name(&last) {
                Ok(path) => Ok(path),
                Err(OwnedIoError::TargetExists) => Err("name_taken"),
                Err(_) => Err("other"),
            };
        }
        for number in 0..MAX_NUMBERED {
            let candidate = if number == 0 {
                last.clone()
            } else {
                numbered(&last, number)
            };
            match output.publish_name(&candidate) {
                Ok(path) => return Ok(path),
                Err(OwnedIoError::TargetExists) => continue,
                Err(_) => return Err("other"),
            }
        }
        Err("name_taken")
    }

    fn progress(&mut self, current: &Path, force: bool) {
        if !force && self.last_progress.elapsed() < PROGRESS_EVERY {
            return;
        }
        self.last_progress = Instant::now();
        self.events.progress(&crate::secure_extract::progress_of(
            self.items_done,
            self.items_total,
            self.bytes_done,
            self.bytes_total,
            current,
        ));
    }

    pub(crate) fn finish(mut self) -> ExtractReport {
        let root = self.tree.root().to_path_buf();
        self.progress(&root, true);
        std::mem::take(&mut self.report)
    }
}

fn unix_time(seconds: u64) -> Option<std::time::SystemTime> {
    if seconds == 0 {
        return None;
    }
    UNIX_EPOCH.checked_add(Duration::from_secs(seconds))
}

fn write_into(
    output: &mut OwnedOutput,
    reader: &mut dyn Read,
    declared: u64,
    token: &CancellationToken,
    encrypted: bool,
    on_bytes: &mut dyn FnMut(usize),
) -> WriteEnd {
    let failure = if encrypted { "bad_password" } else { "damaged" };
    let mut buffer = vec![0u8; CHUNK_BYTES];
    let mut total = 0u64;
    loop {
        if token.load(Ordering::Relaxed) {
            return WriteEnd::Cancelled;
        }
        let read = match reader.read(&mut buffer) {
            Ok(read) => read,
            Err(_) => return WriteEnd::Skip(failure),
        };
        if read == 0 {
            break;
        }
        crate::list::note_activity(read);
        total = total.saturating_add(read as u64);
        if total > declared {
            return WriteEnd::Skip(if encrypted {
                "bad_password"
            } else {
                "size_mismatch"
            });
        }
        if output.file_mut().write_all(&buffer[..read]).is_err() {
            return WriteEnd::Skip("other");
        }
        on_bytes(read);
    }
    if total < declared {
        return WriteEnd::Skip(if encrypted {
            "bad_password"
        } else {
            "size_mismatch"
        });
    }
    WriteEnd::Done
}

/// Read the planned files of one archive format into the writer.
pub(crate) fn extract_files(
    format: ArchiveFormat,
    path: &Path,
    plan: &ExtractPlan,
    writer: &mut SecureWriter<'_>,
    limits: &Limits,
    options: &crate::read_options::ArchiveReadOptions,
) -> Result<(), ArchiveError> {
    match format {
        ArchiveFormat::Bz2 => extract_bz2(path, plan, writer),
        ArchiveFormat::TarBz2 => extract_tar_bz2(path, plan, writer, limits),
        ArchiveFormat::Zip => crate::secure_extract_zip::extract_zip(path, plan, writer, options),
        ArchiveFormat::SevenZ => {
            crate::secure_extract_7z::extract_7z(path, plan, writer, options, limits)
        }
        _ => Err(ArchiveError::Unsupported),
    }
}

fn extract_bz2(
    path: &Path,
    plan: &ExtractPlan,
    writer: &mut SecureWriter<'_>,
) -> Result<(), ArchiveError> {
    let Some(planned) = plan.files.first() else {
        return Ok(());
    };
    let mut decoder = crate::read_bzip2::decoder(File::open(path)?);
    writer.write_file(planned, &mut decoder)?;
    Ok(())
}

fn extract_tar_bz2(
    path: &Path,
    plan: &ExtractPlan,
    writer: &mut SecureWriter<'_>,
    _limits: &Limits,
) -> Result<(), ArchiveError> {
    let decoder = crate::read_bzip2::decoder(File::open(path)?);
    let mut archive = tar::Archive::new(crate::list::ActivityReader(decoder));
    let planned_by_index: HashMap<u32, usize> = plan
        .files
        .iter()
        .enumerate()
        .map(|(position, planned)| (planned.index, position))
        .collect();
    let mut seen = vec![false; plan.files.len()];
    let mut entries = match archive.entries() {
        Ok(entries) => entries,
        Err(_) => {
            skip_unseen(plan, writer, &seen, "damaged");
            return Ok(());
        }
    };
    let mut position = 0u32;
    loop {
        if writer.token.load(Ordering::Relaxed) {
            writer.cancel();
            return Ok(());
        }
        let mut entry = match entries.next() {
            None => break,
            Some(Ok(entry)) => entry,
            Some(Err(_)) => {
                skip_unseen(plan, writer, &seen, "damaged");
                return Ok(());
            }
        };
        if let Some(&planned) = planned_by_index.get(&position) {
            seen[planned] = true;
            match writer.write_file(&plan.files[planned], &mut entry) {
                Ok(()) => {}
                Err(ArchiveError::Cancelled) => return Ok(()),
                Err(error) => return Err(error),
            }
        }
        position = position.wrapping_add(1);
    }
    skip_unseen(plan, writer, &seen, "damaged");
    Ok(())
}

fn skip_unseen(plan: &ExtractPlan, writer: &mut SecureWriter<'_>, seen: &[bool], reason: &str) {
    if writer.cancelled() {
        return;
    }
    for (position, planned) in plan.files.iter().enumerate() {
        if !seen[position] {
            writer.skip(planned.inner.clone(), reason);
        }
    }
}
