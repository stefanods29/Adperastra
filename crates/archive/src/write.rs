//! Writing one extracted file (Step 06d R-SAFE-2/3): never to the target
//! itself, always to an owned staging file with a random name next to it,
//! counted against the size the archive declared, flushed, then renamed into
//! place so an existing file is never replaced. A failure removes only that
//! staging file, through its own handle.

use crate::limits::CHUNK_BYTES;
use fs_service::owned_io::{OwnedIoError, OwnedOutput, PinnedDirectory};
use fs_service::CancellationToken;
use std::fs;
use std::io::{BufWriter, Read, Write};
use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::{Duration, UNIX_EPOCH};

/// Why one file was not written. Both leave the folder as it was.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteFailure {
    /// A skip reason code (`errors.archive.<reason>`).
    Skip(&'static str),
    Cancelled,
}

/// Write one file. `declared` is the size the archive says the entry has;
/// a different size stops the write. `on_bytes` is called after every piece
/// written, for progress.
pub fn write_entry(
    target: &Path,
    reader: &mut dyn Read,
    declared: u64,
    modified_unix: u64,
    zone: Option<&str>,
    token: &CancellationToken,
    on_bytes: &mut dyn FnMut(u64),
) -> Result<(), WriteFailure> {
    if target.symlink_metadata().is_ok() {
        return Err(WriteFailure::Skip("name_taken"));
    }
    let (Some(parent), Some(name)) = (target.parent(), target.file_name().and_then(|n| n.to_str()))
    else {
        return Err(WriteFailure::Skip("invalid_name"));
    };
    if let Err(error) = fs::create_dir_all(parent) {
        return Err(WriteFailure::Skip(folder_reason(&error)));
    }
    let pin = PinnedDirectory::open(parent).map_err(owned_failure)?;
    // The staging file is removed through its handle when `output` is dropped
    // unpublished, so a cancelled or failed write leaves nothing behind and
    // never touches another file (R-SAFE-3).
    let mut output = OwnedOutput::create(&pin, name).map_err(owned_failure)?;
    write_output(
        &mut output,
        reader,
        declared,
        modified_unix,
        token,
        on_bytes,
    )?;
    output.publish_name(name).map_err(owned_failure)?;
    drop(output);
    if let Some(zone) = zone {
        write_zone(target, zone);
    }
    Ok(())
}

/// The pieces of a write that happen in the staging file.
fn write_output(
    output: &mut OwnedOutput,
    reader: &mut dyn Read,
    declared: u64,
    modified_unix: u64,
    token: &CancellationToken,
    on_bytes: &mut dyn FnMut(u64),
) -> Result<(), WriteFailure> {
    let mut writer = BufWriter::new(output.file_mut());
    let mut buffer = vec![0u8; CHUNK_BYTES];
    let mut total = 0u64;
    loop {
        if token.load(Ordering::Relaxed) {
            return Err(WriteFailure::Cancelled);
        }
        let read = match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => read,
            Err(_) => return Err(WriteFailure::Skip("damaged")),
        };
        crate::list::note_activity(read);
        total += read as u64;
        if total > declared {
            return Err(WriteFailure::Skip("size_mismatch"));
        }
        if let Err(error) = writer.write_all(&buffer[..read]) {
            return Err(WriteFailure::Skip(write_reason(&error)));
        }
        on_bytes(read as u64);
    }
    if total < declared {
        return Err(WriteFailure::Skip("size_mismatch"));
    }
    if let Err(error) = writer.flush() {
        return Err(WriteFailure::Skip(write_reason(&error)));
    }
    drop(writer);
    output.flush_sync().map_err(owned_failure)?;
    if modified_unix > 0 {
        if let Some(time) = UNIX_EPOCH.checked_add(Duration::from_secs(modified_unix)) {
            let times = fs::FileTimes::new().set_modified(time);
            // A date the disk refuses is not worth failing the file for.
            let _ = output.file_mut().set_times(times);
        }
    }
    Ok(())
}

/// Copy the internet mark (Step 06d D9), so the protected view and Windows
/// SmartScreen still apply to what was extracted.
fn write_zone(target: &Path, zone: &str) {
    let Some(name) = target.file_name() else {
        return;
    };
    if name.to_string_lossy().contains(':') {
        return;
    }
    let mut stream = target.as_os_str().to_os_string();
    stream.push(":Zone.Identifier");
    let _ = fs::write(Path::new(&stream), zone);
}

fn owned_failure(error: OwnedIoError) -> WriteFailure {
    WriteFailure::Skip(match error {
        OwnedIoError::TargetExists => "name_taken",
        OwnedIoError::InvalidName => "invalid_name",
        OwnedIoError::Io(io) => folder_reason(&io),
        _ => "other",
    })
}

fn folder_reason(error: &std::io::Error) -> &'static str {
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        "access_denied"
    } else {
        "other"
    }
}

fn write_reason(error: &std::io::Error) -> &'static str {
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        "access_denied"
    } else {
        "other"
    }
}
