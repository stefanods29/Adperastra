//! Chunked template copy with authorized source and owned staging handles.

#[cfg(test)]
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

use fs_service::{CancellationToken, OpProgress};

#[path = "template_copy_handles.rs"]
mod handles;

const COPY_CHUNK_BYTES: usize = 1024 * 1024;
const MAX_UNIQUE_ATTEMPTS: usize = 10_000;

/// Authorize and copy one template, reporting byte progress for a shared
/// job. Cancellation returns `templates.cancelled` and only the owned
/// staging file is removed. Existing destinations are never replaced.
pub(crate) fn copy_template_with_progress(
    template: &Path,
    dest_dir: &Path,
    name: &str,
    sources: &[PathBuf],
    token: &CancellationToken,
    progress: impl FnMut(&OpProgress),
) -> Result<PathBuf, String> {
    copy_with_limit(
        template,
        dest_dir,
        name,
        sources,
        token,
        progress,
        MAX_UNIQUE_ATTEMPTS,
    )
}

fn copy_with_limit(
    template: &Path,
    dest_dir: &Path,
    name: &str,
    sources: &[PathBuf],
    token: &CancellationToken,
    mut progress: impl FnMut(&OpProgress),
    max_names: usize,
) -> Result<PathBuf, String> {
    fs_service::validate_new_name(name).map_err(|_| "templates.invalid_name".to_string())?;
    check_cancel(token)?;
    let mut source = handles::Source::open(template, sources)?;
    let destination = handles::Directory::open(dest_dir).map_err(|error| copy_error(&error))?;
    let mut staged =
        handles::Partial::create(&destination, name).map_err(|error| copy_error(&error))?;
    let mut status = OpProgress {
        items_done: 0,
        items_total: 1,
        bytes_done: 0,
        bytes_total: source
            .file
            .metadata()
            .map_err(|error| copy_error(&error))?
            .len(),
        current: template.to_string_lossy().into_owned(),
    };
    progress(&status);
    let mut buffer = vec![0; COPY_CHUNK_BYTES];
    loop {
        check_cancel(token)?;
        let read = source
            .file
            .read(&mut buffer)
            .map_err(|error| copy_error(&error))?;
        if read == 0 {
            break;
        }
        staged
            .file
            .write_all(&buffer[..read])
            .map_err(|error| copy_error(&error))?;
        status.bytes_done += read as u64;
        progress(&status);
    }
    check_cancel(token)?;
    staged.file.sync_all().map_err(|error| copy_error(&error))?;
    for number in 0..max_names {
        check_cancel(token)?;
        let target = destination.path.join(numbered_name(name, number));
        match staged.publish(&target) {
            Ok(()) => {
                status.items_done = 1;
                progress(&status);
                return Ok(target);
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::AlreadyExists
                    || target.symlink_metadata().is_ok() =>
            {
                continue
            }
            Err(error) => return Err(copy_error(&error)),
        }
    }
    Err("templates.other".to_string())
}

fn numbered_name(name: &str, number: usize) -> String {
    if number == 0 {
        return name.to_string();
    }
    let (base, extension) = match name.rfind('.') {
        Some(dot) if dot > 0 => (&name[..dot], &name[dot..]),
        _ => (name, ""),
    };
    format!("{base} ({number}){extension}")
}

fn check_cancel(token: &CancellationToken) -> Result<(), String> {
    if token.load(Ordering::Relaxed) {
        Err("templates.cancelled".to_string())
    } else {
        Ok(())
    }
}

pub(super) fn copy_error(error: &std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::PermissionDenied => "templates.access_denied",
        std::io::ErrorKind::NotFound => "templates.not_found",
        _ => "templates.other",
    }
    .to_string()
}

/// The recipe's small pure wrapper stays available to its original tests.
#[cfg(test)]
pub(super) fn copy_template(
    template: &Path,
    dest_dir: &Path,
    name: &str,
) -> Result<PathBuf, String> {
    let sources = template
        .parent()
        .map(Path::to_path_buf)
        .into_iter()
        .collect::<Vec<_>>();
    copy_template_with_progress(
        template,
        dest_dir,
        name,
        &sources,
        &fs_service::new_cancellation_token(),
        |_| {},
    )
}

#[cfg(test)]
#[path = "template_copy_tests.rs"]
mod tests;
