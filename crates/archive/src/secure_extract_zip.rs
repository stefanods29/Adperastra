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
