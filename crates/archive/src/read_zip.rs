//! Listing a zip archive (Step 06d T3). Only metadata is read: nothing is
//! decompressed and nothing is decrypted, so a damaged or hostile entry
//! cannot slow the listing down.

use crate::entry::{ArchiveFormat, EntryKind, Listing};
use crate::error::ArchiveError;
use crate::limits::Limits;
use crate::list::{CancelCheck, Collector};
use crate::time::dos_local_to_unix;
use fs_service::CancellationToken;
use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use zip::result::ZipError;

pub(crate) fn list_zip(
    path: &Path,
    limits: &Limits,
    token: &CancellationToken,
) -> Result<Listing, ArchiveError> {
    let file = File::open(path)?;
    let mut archive = zip::ZipArchive::new(BufReader::new(file)).map_err(map_error)?;
    let count = archive.len();
    if count > limits.max_entries {
        return Err(ArchiveError::TooManyEntries);
    }
    let mut collector = Collector::new(limits);
    let mut cancel = CancelCheck::new();
    let mut partial = false;
    for index in 0..count {
        cancel.tick(token)?;
        // The entry borrows the archive, so everything needed is copied out
        // before the next index is asked for.
        let fields = {
            let entry = match archive.by_index_raw(index) {
                Ok(entry) => entry,
                Err(_) => {
                    partial = true;
                    continue;
                }
            };
            entry.name().ok().map(|name| {
                let kind = if entry.is_dir() {
                    EntryKind::Folder
                } else if entry.is_symlink() {
                    EntryKind::Link
                } else {
                    EntryKind::File
                };
                let modified_unix = entry.last_modified().map_or(0, |date| {
                    dos_local_to_unix(
                        date.year(),
                        date.month(),
                        date.day(),
                        date.hour(),
                        date.minute(),
                        date.second(),
                    )
                });
                (
                    name.into_owned(),
                    kind,
                    entry.size(),
                    entry.compressed_size(),
                    modified_unix,
                    entry.encrypted(),
                )
            })
        };
        let Some((raw, kind, size, packed, modified, encrypted)) = fields else {
            partial = true;
            continue;
        };
        collector.add(index as u32, &raw, kind, size, packed, modified, encrypted)?;
    }
    Ok(collector.finish(ArchiveFormat::Zip, partial))
}

/// A zip that cannot even be opened is damaged, unless the format itself
/// (not the file) is what this step cannot read.
fn map_error(error: ZipError) -> ArchiveError {
    match error {
        ZipError::UnsupportedArchive(_) | ZipError::CompressionMethodNotSupported(_) => {
            ArchiveError::Unsupported
        }
        _ => ArchiveError::Corrupt,
    }
}
