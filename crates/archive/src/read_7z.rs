//! Listing a 7z archive (Step 06d T3, Step 06e T4). The header is read; the
//! blocks are not decoded, so a solid archive lists as fast as a plain one.
//! A password is passed to the header reader; an entry's own encryption is
//! read from the coders of the block that holds it.

use crate::entry::{ArchiveFormat, EntryKind, Listing};
use crate::error::ArchiveError;
use crate::limits::Limits;
use crate::list::{CancelCheck, Collector};
use fs_service::CancellationToken;
use sevenz_rust2::{Archive, EncoderMethod, Error as SevenZError, Password};
use std::fs::File;
use std::io::BufReader;
use std::path::Path;

pub(crate) fn list_7z(
    path: &Path,
    limits: &Limits,
    token: &CancellationToken,
    password: Option<&str>,
) -> Result<Listing, ArchiveError> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let secret = password.map(Password::from).unwrap_or_default();
    let archive = Archive::read(&mut reader, &secret).map_err(map_error)?;
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
        let encrypted = file_is_encrypted(&archive, index);
        collector.add(
            index as u32,
            entry.name(),
            kind,
            entry.size(),
            0,
            modified_unix,
            encrypted,
        )?;
    }
    Ok(collector.finish(ArchiveFormat::SevenZ, false))
}

/// True when the block that holds file `index` uses the AES-256 coder.
pub(crate) fn file_is_encrypted(archive: &Archive, index: usize) -> bool {
    let Some(block_index) = archive
        .stream_map
        .file_block_index
        .get(index)
        .copied()
        .flatten()
    else {
        return false;
    };
    let Some(block) = archive.blocks.get(block_index) else {
        return false;
    };
    block
        .coders
        .iter()
        .any(|coder| coder.encoder_method_id() == EncoderMethod::ID_AES256_SHA256)
}

/// The password as sevenz-rust2 wants it: UTF-16 bytes for the KDF.
pub(crate) fn seven_z_password(password: Option<&str>) -> Password {
    password.map(Password::from).unwrap_or_default()
}

fn map_error(error: SevenZError) -> ArchiveError {
    match error {
        SevenZError::PasswordRequired => ArchiveError::PasswordRequired,
        SevenZError::MaybeBadPassword(_) => ArchiveError::BadPassword,
        SevenZError::Unsupported(_)
        | SevenZError::UnsupportedCompressionMethod(_)
        | SevenZError::UnsupportedVersion { .. }
        | SevenZError::ExternalUnsupported => ArchiveError::Unsupported,
        _ => ArchiveError::Corrupt,
    }
}
