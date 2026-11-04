//! Writing a zip archive into the app-owned spool (Step 06e T6). Selected
//! Deflate level, directories as entries, exact timestamps; AES-256 only when the
//! user chose it, and the weak compatibility mode only when explicitly
//! selected.

use std::io::{Seek, Write};

use zip::unstable::write::FileOptionsExt;
use zip::{AesMode, CompressionMethod, DateTime, ZipWriter};

use crate::create_plan::CreatePlan;
use crate::create_stream::{open_source, BuildProgress, WriteOutcome};
use crate::create_types::{CreateEncryption, CreateOptions};
use crate::entry::EntryKind;
use crate::error::ArchiveError;
use fs_service::CancellationToken;

/// Zip options that may borrow the password for the call that writes them.
type BaseOptions<'a> = zip::write::FileOptions<'a, 'static, ()>;

pub(crate) fn write_zip<W: Write + Seek>(
    output: &mut W,
    plan: &CreatePlan,
    options: &CreateOptions,
    token: &CancellationToken,
    progress: &mut BuildProgress<'_>,
    _limits: &crate::create_types::CreateLimits,
) -> Result<WriteOutcome, ArchiveError> {
    let mut writer = ZipWriter::new(output);
    let mut outcome = WriteOutcome::from_plan(plan);
    for entry in &plan.entries {
        if token.load(std::sync::atomic::Ordering::Relaxed) {
            return Err(ArchiveError::Cancelled);
        }
        match entry.kind {
            EntryKind::Folder => {
                writer
                    .add_directory(
                        entry.inner_path.clone(),
                        base_options(entry.modified_unix, options.level),
                    )
                    .map_err(|_| ArchiveError::OutputChanged)?;
                outcome.folders += 1;
                progress.item(&entry.source.to_string_lossy());
            }
            EntryKind::Link => {
                // Links are refused by the walk; never write one here.
                outcome.skip(&entry.inner_path, "link_entry");
            }
            EntryKind::File => {
                let source = match open_source(entry) {
                    Ok(source) => source,
                    Err(reason) => {
                        outcome.skip(&entry.inner_path, reason);
                        continue;
                    }
                };
                let options = encrypted(base_options(entry.modified_unix, options.level), options)?;
                writer
                    .start_file(entry.inner_path.clone(), options)
                    .map_err(|_| ArchiveError::OutputChanged)?;
                let inner = entry.inner_path.clone();
                crate::create_stream::copy_source(
                    source,
                    entry.size,
                    &mut writer,
                    token,
                    &mut |read| progress.bytes(read, &inner),
                )?;
                outcome.files += 1;
                progress.item(&entry.source.to_string_lossy());
            }
        }
    }
    writer.finish().map_err(|_| ArchiveError::OutputChanged)?;
    Ok(outcome)
}

fn base_options<'a>(modified_unix: u64, level: u8) -> BaseOptions<'a> {
    let mut options: BaseOptions<'a> = zip::write::FileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .compression_level(Some(i64::from(level)))
        .large_file(true);
    if let Some((year, month, day, hour, minute, second)) =
        crate::time::unix_to_dos_local(modified_unix)
    {
        if let Ok(date) = DateTime::from_date_and_time(year, month, day, hour, minute, second) {
            options = options.last_modified_time(date);
        }
    }
    options
}

fn encrypted<'a>(
    base: BaseOptions<'a>,
    options: &'a CreateOptions,
) -> Result<BaseOptions<'a>, ArchiveError> {
    let Some(password) = options.password.as_deref() else {
        return match options.encryption {
            CreateEncryption::None => Ok(base),
            _ => Err(ArchiveError::InvalidPassword),
        };
    };
    match options.encryption {
        CreateEncryption::None => Ok(base),
        CreateEncryption::Aes256 => Ok(base.with_aes_encryption(AesMode::Aes256, password)),
        CreateEncryption::ZipCrypto => base
            .with_deprecated_encryption(password.as_bytes())
            .map_err(|_| ArchiveError::InvalidPassword),
    }
}
