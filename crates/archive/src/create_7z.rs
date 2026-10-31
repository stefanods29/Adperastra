//! Writing a 7z archive into the app-owned spool (Step 06e T6): non-solid
//! LZMA2 level 6 with an 8 MiB dictionary, AES-256 with 2^19 KDF cycles only
//! when chosen, and header encryption only for encrypted archives.

use std::cell::Cell;
use std::io::{Seek, Write};
use std::sync::atomic::Ordering;

use sevenz_rust2::encoder_options::{AesEncoderOptions, Lzma2Options};
use sevenz_rust2::{ArchiveEntry, ArchiveWriter, EncoderConfiguration, NtTime, Password};

use crate::create_plan::CreatePlan;
use crate::create_stream::{
    open_source, BuildProgress, GuardedReader, SourceFailure, WriteOutcome,
};
use crate::create_types::{CreateEncryption, CreateLimits, CreateOptions};
use crate::entry::EntryKind;
use crate::error::ArchiveError;
use fs_service::CancellationToken;

/// LZMA2 level 6 and an 8 MiB dictionary (D3).
pub(crate) const SEVEN_Z_LEVEL: u32 = 6;
pub(crate) const SEVEN_Z_DICTIONARY: u32 = 8 * 1024 * 1024;
/// The KDF cycle power D3 requires; the library default of 8 is not accepted.
pub(crate) const SEVEN_Z_CYCLES_POWER: u8 = 19;

pub(crate) fn write_7z<W: Write + Seek>(
    output: &mut W,
    plan: &CreatePlan,
    options: &CreateOptions,
    token: &CancellationToken,
    progress: &mut BuildProgress<'_>,
    _limits: &CreateLimits,
) -> Result<WriteOutcome, ArchiveError> {
    let mut writer = ArchiveWriter::new(output).map_err(|_| ArchiveError::OutputChanged)?;
    writer.set_content_methods(content_methods(options)?);
    writer.set_encrypt_header(
        options.encryption == CreateEncryption::Aes256 && options.encrypt_names,
    );
    let mut outcome = WriteOutcome::from_plan(plan);
    for entry in &plan.entries {
        if token.load(Ordering::Relaxed) {
            return Err(ArchiveError::Cancelled);
        }
        match entry.kind {
            EntryKind::Folder => {
                let mut meta = ArchiveEntry::new_directory(&entry.inner_path);
                set_time(&mut meta, entry.modified_unix);
                writer
                    .push_archive_entry(meta, None::<&[u8]>)
                    .map_err(|_| ArchiveError::OutputChanged)?;
                outcome.folders += 1;
                progress.item(&entry.source.to_string_lossy());
            }
            EntryKind::Link => outcome.skip(&entry.inner_path, "link_entry"),
            EntryKind::File => {
                let source = match open_source(entry) {
                    Ok(source) => source,
                    Err(reason) => {
                        outcome.skip(&entry.inner_path, reason);
                        continue;
                    }
                };
                let failure = Cell::new(None);
                let inner = entry.inner_path.clone();
                let mut meta = ArchiveEntry::new_file(&inner);
                set_time(&mut meta, entry.modified_unix);
                let mut on_read = |read: usize| progress.bytes(read, &inner);
                let reader = GuardedReader::new(source, entry.size, token, &mut on_read, &failure);
                let pushed = writer.push_archive_entry(meta, Some(reader));
                if let Some(failure) = failure.get() {
                    return Err(match failure {
                        SourceFailure::Cancelled => ArchiveError::Cancelled,
                        SourceFailure::Changed => ArchiveError::SourceChanged,
                    });
                }
                pushed.map_err(|_| ArchiveError::OutputChanged)?;
                outcome.files += 1;
                progress.item(&entry.source.to_string_lossy());
            }
        }
    }
    writer.finish().map_err(|_| ArchiveError::OutputChanged)?;
    Ok(outcome)
}

fn content_methods(options: &CreateOptions) -> Result<Vec<EncoderConfiguration>, ArchiveError> {
    let mut lzma = Lzma2Options::from_level(SEVEN_Z_LEVEL);
    lzma.set_dictionary_size(SEVEN_Z_DICTIONARY);
    let mut methods = Vec::new();
    if options.encryption == CreateEncryption::Aes256 {
        let Some(password) = options.password.as_deref() else {
            return Err(ArchiveError::InvalidPassword);
        };
        let mut aes = AesEncoderOptions::new(Password::from(password));
        aes.num_cycles_power = SEVEN_Z_CYCLES_POWER;
        // AES is added before LZMA2 in content-method order (D3).
        methods.push(EncoderConfiguration::from(aes));
    }
    methods.push(EncoderConfiguration::from(lzma));
    Ok(methods)
}

fn set_time(entry: &mut ArchiveEntry, modified_unix: u64) {
    if modified_unix == 0 {
        return;
    }
    let ticks = modified_unix
        .saturating_add(11_644_473_600)
        .saturating_mul(10_000_000);
    entry.last_modified_date = NtTime::new(ticks);
    entry.has_last_modified_date = true;
}
