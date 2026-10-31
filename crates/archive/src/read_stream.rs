//! A single gzip or xz file (Step 06d T3): it is shown as an archive that
//! holds one file, named after the archive without its last extension.

use crate::entry::{ArchiveFormat, EntryKind, Listing};
use crate::error::ArchiveError;
use crate::limits::{Limits, CHUNK_BYTES};
use crate::list::{CancelCheck, Collector};
use fs_service::CancellationToken;
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;
use std::time::UNIX_EPOCH;

pub(crate) fn list_stream(
    path: &Path,
    format: ArchiveFormat,
    limits: &Limits,
    token: &CancellationToken,
) -> Result<Listing, ArchiveError> {
    let metadata = std::fs::metadata(path)?;
    let packed = metadata.len();
    let modified_unix = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|age| age.as_secs())
        .unwrap_or(0);
    let file = File::open(path)?;
    let mut decoder: Box<dyn Read> = match format {
        ArchiveFormat::Gz => Box::new(flate2::read::MultiGzDecoder::new(BufReader::new(file))),
        _ => Box::new(lzma_rust2::XzReader::new_mem_limit(
            BufReader::new(file),
            true,
            limits.xz_memory_kb,
        )),
    };
    let mut buffer = vec![0u8; CHUNK_BYTES];
    let mut size = 0u64;
    let mut cancel = CancelCheck::new();
    loop {
        // One piece per check: this is the only loop of the whole listing
        // that can run long on a huge file.
        cancel.tick(token)?;
        let read = decoder
            .read(&mut buffer)
            .map_err(|_| ArchiveError::Corrupt)?;
        if read == 0 {
            break;
        }
        crate::list::note_activity(read);
        size += read as u64;
        if size > limits.max_total_bytes {
            return Err(ArchiveError::Bomb);
        }
    }
    let name = single_file_name(path);
    let mut collector = Collector::new(limits);
    collector.add(
        0,
        &name,
        EntryKind::File,
        size,
        packed,
        modified_unix,
        false,
    )?;
    Ok(collector.finish(format, false))
}

/// `notes.txt.gz` gives `notes.txt`; a name without an extension gives
/// `data`.
fn single_file_name(path: &Path) -> String {
    let Some(name) = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
    else {
        return "data".to_string();
    };
    let stem = match name.rfind('.') {
        Some(dot) if dot > 0 => &name[..dot],
        _ => "",
    };
    if stem.is_empty() {
        "data".to_string()
    } else {
        stem.to_string()
    }
}
