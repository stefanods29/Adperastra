//! Writing one extracted file (Step 06d R-SAFE-2/3): never to the target
//! itself, always to `~<name>.partial` next to it, counted against the size
//! the archive declared, then renamed into place so an existing file is
//! never replaced.

use crate::limits::CHUNK_BYTES;
use fs_service::CancellationToken;
use std::fs::{self, OpenOptions};
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
    if let Some(parent) = target.parent() {
        if let Err(error) = fs::create_dir_all(parent) {
            return Err(WriteFailure::Skip(folder_reason(&error)));
        }
    }
    // Only this crate removes a file, and only its own unfinished partial
    // one, so a cancelled or failed write leaves nothing behind (R-SAFE-3).
    let partial = fs_service::partial_path(target);
    let written = write_partial(&partial, reader, declared, modified_unix, token, on_bytes);
    if let Err(failure) = written {
        let _ = fs::remove_file(&partial);
        return Err(failure);
    }
    if let Err(error) = fs_service::move_without_replacing(&partial, target) {
        let _ = fs::remove_file(&partial);
        return Err(WriteFailure::Skip(match error {
            fs_service::FsError::Io(io) => match io.raw_os_error() {
                // ERROR_FILE_EXISTS, ERROR_ALREADY_EXISTS
                Some(80) | Some(183) => "name_taken",
                _ => "other",
            },
            _ => "other",
        }));
    }
    if let Some(zone) = zone {
        write_zone(target, zone);
    }
    Ok(())
}

/// The pieces of a write that happen in the partial file.
fn write_partial(
    partial: &Path,
    reader: &mut dyn Read,
    declared: u64,
    modified_unix: u64,
    token: &CancellationToken,
    on_bytes: &mut dyn FnMut(u64),
) -> Result<(), WriteFailure> {
    let file = match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(partial)
    {
        Ok(file) => file,
        Err(error) => return Err(WriteFailure::Skip(open_reason(&error))),
    };
    let mut writer = BufWriter::new(file);
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
    if modified_unix > 0 {
        if let Some(time) = UNIX_EPOCH.checked_add(Duration::from_secs(modified_unix)) {
            let times = fs::FileTimes::new().set_modified(time);
            // A date the disk refuses is not worth failing the file for.
            let _ = writer.get_ref().set_times(times);
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

fn open_reason(error: &std::io::Error) -> &'static str {
    if error.kind() == std::io::ErrorKind::AlreadyExists {
        "name_taken"
    } else {
        folder_reason(error)
    }
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
