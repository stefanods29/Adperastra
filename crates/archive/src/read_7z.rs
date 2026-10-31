//! Listing a 7z archive (Step 06d T3). The header is read; the blocks are
//! not decoded, so a solid archive lists as fast as a plain one.

use crate::entry::{ArchiveFormat, EntryKind, Listing};
use crate::error::ArchiveError;
use crate::limits::Limits;
use crate::list::{CancelCheck, Collector};
use fs_service::CancellationToken;
use sevenz_rust2::{Archive, Error as SevenZError, Password};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

pub(crate) fn list_7z(
    path: &Path,
    limits: &Limits,
    token: &CancellationToken,
) -> Result<Listing, ArchiveError> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let archive = Archive::read(&mut reader, &Password::empty()).map_err(map_error)?;
    if archive.files.len() > limits.max_entries {
        return Err(ArchiveError::TooManyEntries);
    }
    let mut collector = Collector::new(limits);
    let mut cancel = CancelCheck::new();
    for (index, entry) in archive.files.iter().enumerate() {
        cancel.tick(token)?;
        // Anti items mark a file that a later version removed: nothing to show.
        if entry.is_anti_item() {
            continue;
        }
        let kind = if entry.is_directory() {
            EntryKind::Folder
        } else {
            EntryKind::File
        };
        // 7z stores a Windows file time, which is already UTC.
        let ticks = u64::from(entry.last_modified_date());
        let modified_unix = fs_service::filetime_to_unix(ticks);
        collector.add(
            index as u32,
            entry.name(),
            kind,
            entry.size(),
            0,
            modified_unix,
            false,
        )?;
    }
    Ok(collector.finish(ArchiveFormat::SevenZ, false))
}

fn map_error(error: SevenZError) -> ArchiveError {
    match error {
        SevenZError::PasswordRequired | SevenZError::MaybeBadPassword(_) => {
            ArchiveError::PasswordRequired
        }
        SevenZError::Unsupported(_)
        | SevenZError::UnsupportedCompressionMethod(_)
        | SevenZError::UnsupportedVersion { .. }
        | SevenZError::ExternalUnsupported => ArchiveError::Unsupported,
        _ => ArchiveError::Corrupt,
    }
}
