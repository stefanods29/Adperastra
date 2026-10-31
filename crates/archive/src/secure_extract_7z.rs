//! Reading 7z entries into owned staging (Step 06e T4). The header password
//! and the data password are the same exact string; a solid archive is read
//! in order, so every entry's data is drained even when it is not wanted.

use std::collections::{HashMap, VecDeque};
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

use sevenz_rust2::Error as SevenZError;

use crate::error::ArchiveError;
use crate::limits::{Limits, CHUNK_BYTES};
use crate::plan::ExtractPlan;
use crate::read_7z::seven_z_password;
use crate::read_options::ArchiveReadOptions;
use crate::secure_extract_readers::SecureWriter;

pub(crate) fn extract_7z(
    path: &Path,
    plan: &ExtractPlan,
    writer: &mut SecureWriter<'_>,
    options: &ArchiveReadOptions,
    limits: &Limits,
) -> Result<(), ArchiveError> {
    let file = File::open(path)?;
    let mut reader = sevenz_rust2::ArchiveReader::new(
        BufReader::new(file),
        seven_z_password(options.password.as_deref()),
    )
    .map_err(|_| ArchiveError::Corrupt)?;
    let mut pending: HashMap<String, VecDeque<usize>> = HashMap::new();
    for (position, planned) in plan.files.iter().enumerate() {
        pending
            .entry(planned.inner.clone())
            .or_default()
            .push_back(position);
    }
    let mut seen = vec![false; plan.files.len()];
    let mut parsed_error = false;
    let run = {
        let token = writer.token().clone();
        let mut closure = |entry: &sevenz_rust2::ArchiveEntry, data: &mut dyn Read| {
            if token.load(std::sync::atomic::Ordering::Relaxed) {
                writer.cancel();
                return Ok(false);
            }
            let wanted = crate::path::normalize_inner_path(entry.name(), limits)
                .ok()
                .and_then(|path| pending.get_mut(&path).and_then(|queue| queue.pop_front()));
            let Some(position) = wanted else {
                return drain(data, &token);
            };
            seen[position] = true;
            match writer.write_file_encrypted(&plan.files[position], data) {
                Ok(()) => Ok(true),
                Err(ArchiveError::Cancelled) => {
                    writer.cancel();
                    Ok(false)
                }
                Err(_) => {
                    parsed_error = true;
                    Ok(false)
                }
            }
        };
        reader.for_each_entries(&mut closure)
    };
    if parsed_error {
        // The exact created/skipped report has already recorded the effect.
        skip_unseen(plan, writer, &seen, "bad_password");
        return Ok(());
    }
    if let Err(error) = run {
        let missing = matches!(error, SevenZError::PasswordRequired);
        let bad = matches!(error, SevenZError::MaybeBadPassword(_));
        if (missing || bad) && !writer.has_created() {
            return Err(if missing {
                ArchiveError::PasswordRequired
            } else {
                ArchiveError::BadPassword
            });
        }
        let reason = if missing {
            "password_required"
        } else if bad {
            "bad_password"
        } else if matches!(error, SevenZError::UnsupportedCompressionMethod(_)) {
            "unsupported_method"
        } else {
            "damaged"
        };
        if missing || bad {
            writer.set_error(if missing {
                "archive.password_required"
            } else {
                "archive.bad_password"
            });
        }
        skip_unseen(plan, writer, &seen, reason);
        return Ok(());
    }
    skip_unseen(plan, writer, &seen, "damaged");
    Ok(())
}

fn drain(data: &mut dyn Read, token: &fs_service::CancellationToken) -> Result<bool, SevenZError> {
    let mut sink = vec![0u8; CHUNK_BYTES];
    loop {
        if token.load(std::sync::atomic::Ordering::Relaxed) {
            return Ok(false);
        }
        match data.read(&mut sink) {
            Ok(0) => return Ok(true),
            Ok(read) => crate::list::note_activity(read),
            Err(error) => return Err(SevenZError::from(error)),
        }
    }
}

fn skip_unseen(plan: &ExtractPlan, writer: &mut SecureWriter<'_>, seen: &[bool], reason: &str) {
    if writer.cancelled() {
        return;
    }
    for (position, planned) in plan.files.iter().enumerate() {
        if !seen[position] {
            writer.skip(planned.inner.clone(), reason);
        }
    }
}
