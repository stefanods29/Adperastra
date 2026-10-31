//! Reading ZIP entries into owned staging (Step 06e T4). Metadata comes from
//! `by_index_raw`; encrypted data only through `by_index_decrypt` with the
//! exact password bytes the user supplied.

use std::fs::File;
use std::io::BufReader;
use std::path::Path;

use zip::result::ZipError;

use crate::error::ArchiveError;
use crate::plan::ExtractPlan;
use crate::read_options::ArchiveReadOptions;
use crate::secure_extract_readers::SecureWriter;

pub(crate) fn extract_zip(
    path: &Path,
    plan: &ExtractPlan,
    writer: &mut SecureWriter<'_>,
    options: &ArchiveReadOptions,
) -> Result<(), ArchiveError> {
    let file = File::open(path)?;
    let mut archive =
        zip::ZipArchive::new(BufReader::new(file)).map_err(|_| ArchiveError::Corrupt)?;
    for planned in &plan.files {
        if writer.stop_requested() {
            writer.cancel();
            return Ok(());
        }
        let encrypted = archive
            .by_index_raw(planned.index as usize)
            .map(|entry| entry.encrypted())
            .unwrap_or(false);
        if !encrypted {
            let mut entry = match archive.by_index(planned.index as usize) {
                Ok(entry) => entry,
                Err(error) => {
                    skip_zip_error(writer, planned, error)?;
                    continue;
                }
            };
            writer.write_file(planned, &mut entry)?;
            continue;
        }
        let Some(password) = options.password.as_deref() else {
            writer.fail_password(planned, true)?;
            continue;
        };
        let mut entry = match archive.by_index_decrypt(planned.index as usize, password.as_bytes())
        {
            Ok(entry) => entry,
            Err(error) => {
                if is_password_error(&error) {
                    writer.fail_password(planned, false)?;
                } else {
                    skip_zip_error(writer, planned, error)?;
                }
                continue;
            }
        };
        writer.write_file_encrypted(planned, &mut entry)?;
    }
    Ok(())
}

/// The most an early password check reads from one file. ZipCrypto's header
/// check passes for about 1 wrong password in 256; only the file's checksum
/// at its end settles it. A larger file is checked while it is written.
const VERIFY_READ_MAX: u64 = 64 * 1024 * 1024;

/// Try the password when the plan's first file is encrypted, so a wrong one is
/// the whole result. When a plain file comes first it is written, and a later
/// password failure is reported with what was created.
pub(crate) fn verify_password(
    path: &Path,
    plan: &ExtractPlan,
    options: &ArchiveReadOptions,
) -> Result<(), ArchiveError> {
    let Some(password) = options.password.as_deref() else {
        return Ok(());
    };
    let file = File::open(path)?;
    let mut archive =
        zip::ZipArchive::new(BufReader::new(file)).map_err(|_| ArchiveError::Corrupt)?;
    let Some(planned) = plan.files.first() else {
        return Ok(());
    };
    let encrypted = archive
        .by_index_raw(planned.index as usize)
        .map(|entry| entry.encrypted())
        .unwrap_or(false);
    if !encrypted {
        return Ok(());
    }
    let mut entry = match archive.by_index_decrypt(planned.index as usize, password.as_bytes()) {
        Err(error) if is_password_error(&error) => return Err(ArchiveError::BadPassword),
        // Other problems are reported for this file when it is written.
        Err(_) => return Ok(()),
        Ok(entry) => entry,
    };
    if planned.size <= VERIFY_READ_MAX && std::io::copy(&mut entry, &mut std::io::sink()).is_err() {
        return Err(ArchiveError::BadPassword);
    }
    Ok(())
}

fn is_password_error(error: &ZipError) -> bool {
    match error {
        ZipError::InvalidPassword => true,
        ZipError::UnsupportedArchive(reason) => *reason == ZipError::PASSWORD_REQUIRED,
        _ => false,
    }
}

fn skip_zip_error(
    writer: &mut SecureWriter<'_>,
    planned: &crate::plan::PlannedEntry,
    error: ZipError,
) -> Result<(), ArchiveError> {
    match error {
        ZipError::InvalidPassword => {
            writer.fail_password(planned, false)?;
        }
        ZipError::UnsupportedArchive(reason) if reason == ZipError::PASSWORD_REQUIRED => {
            writer.fail_password(planned, true)?;
        }
        ZipError::UnsupportedArchive(_) | ZipError::CompressionMethodNotSupported(_) => {
            writer.skip(planned.inner.clone(), "unsupported_method");
        }
        _ => writer.skip(planned.inner.clone(), "damaged"),
    }
    Ok(())
}
