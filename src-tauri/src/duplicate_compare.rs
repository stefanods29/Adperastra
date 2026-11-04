//! Byte-for-byte equality under fresh guarded handles (Step 11c T4 D7).
//!
//! Equal BLAKE3 hashes are still only a filter. A group becomes verified
//! only after one canonical member is compared with every other physical
//! member through `PinnedSource` handles, and both stamps are revalidated.
//! Nothing here mutates or recycles a file.

use std::io::Read;

use fs_service::owned_io::{OwnedIoError, PinnedSource};
use fs_service::{capture_source_stamp, CancellationToken};

use crate::duplicate_candidates::CandidateFile;
use crate::duplicate_hash::stamp_matches;

pub const COMPARE_CHUNK: usize = 1024 * 1024;

fn map_owned(error: OwnedIoError) -> String {
    match error {
        OwnedIoError::SourceChanged | OwnedIoError::ReparseRefused => {
            "duplicates.changed".to_string()
        }
        _ => "storage.unavailable".to_string(),
    }
}

fn check_cancel(cancel: &CancellationToken) -> Result<(), String> {
    if cancel.load(std::sync::atomic::Ordering::Relaxed) {
        Err("ops.cancelled".to_string())
    } else {
        Ok(())
    }
}

/// Compare two physical members through their own guarded handles.
pub fn byte_equal_guarded(
    left: &CandidateFile,
    right: &CandidateFile,
    cancel: &CancellationToken,
) -> Result<bool, String> {
    let mut left_source = PinnedSource::open(
        std::path::Path::new(left.primary_path()),
        &left.identity,
    )
    .map_err(map_owned)?;
    let mut right_source = PinnedSource::open(
        std::path::Path::new(right.primary_path()),
        &right.identity,
    )
    .map_err(map_owned)?;
    let mut left_buffer = vec![0u8; COMPARE_CHUNK];
    let mut right_buffer = vec![0u8; COMPARE_CHUNK];
    let equal = loop {
        check_cancel(cancel)?;
        let left_read = left_source
            .file_mut()
            .read(&mut left_buffer)
            .map_err(|_| "storage.unavailable".to_string())?;
        let right_read = right_source
            .file_mut()
            .read(&mut right_buffer)
            .map_err(|_| "storage.unavailable".to_string())?;
        if left_read != right_read {
            break false;
        }
        if left_read == 0 {
            break true;
        }
        if left_buffer[..left_read] != right_buffer[..right_read] {
            break false;
        }
    };
    left_source.verify_after_read().map_err(map_owned)?;
    right_source.verify_after_read().map_err(map_owned)?;
    drop(left_source);
    drop(right_source);
    if !stamp_matches(
        &capture_source_stamp(std::path::Path::new(left.primary_path()))
            .map_err(|_| "duplicates.changed".to_string())?,
        &left.source,
    ) || !stamp_matches(
        &capture_source_stamp(std::path::Path::new(right.primary_path()))
            .map_err(|_| "duplicates.changed".to_string())?,
        &right.source,
    ) {
        return Err("duplicates.changed".to_string());
    }
    Ok(equal)
}

/// A group is verified only when the canonical member equals every other
/// member and every member's full hash is the same. A cancellation or a
/// changed source leaves the group unverified.
pub fn verify_group(
    members: &[CandidateFile],
    full_hashes: &[[u8; 32]],
    cancel: &CancellationToken,
) -> Result<bool, String> {
    if members.len() < 2 || members.len() != full_hashes.len() {
        return Ok(false);
    }
    let canonical = &full_hashes[0];
    if full_hashes.iter().any(|hash| hash != canonical) {
        return Ok(false);
    }
    for member in members.iter().skip(1) {
        if !byte_equal_guarded(&members[0], member, cancel)? {
            return Ok(false);
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::verify_group;
    use crate::duplicate_candidates::CandidateFile;
    use fs_service::owned_io::SourceIdentity;
    use fs_service::{capture_source_stamp, FileIdentityKey, SourceStamp};
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    fn candidate(path: &std::path::Path) -> CandidateFile {
        let stamp = capture_source_stamp(path).unwrap();
        CandidateFile {
            paths: vec![path.to_string_lossy().into_owned()],
            key: FileIdentityKey {
                volume_id: stamp.volume_id.clone(),
                file_id: stamp.file_id.clone(),
                path_key: stamp.path_key.clone(),
                stable: true,
            },
            source: stamp,
            identity: SourceIdentity::capture(path).unwrap(),
            logical_bytes: std::fs::metadata(path).unwrap().len(),
            allocated_bytes: None,
            modified_unix: 0,
        }
    }

    #[test]
    fn equal_hashes_with_unequal_bytes_are_not_verified() {
        let dir = tempfile::tempdir().unwrap();
        let left = dir.path().join("left.bin");
        let right = dir.path().join("right.bin");
        std::fs::write(&left, b"aaaa").unwrap();
        std::fs::write(&right, b"aaab").unwrap();
        let members = vec![candidate(&left), candidate(&right)];
        let cancel = Arc::new(AtomicBool::new(false));
        // Both stage-3 hashes are deliberately equal: the byte compare is
        // the final authority.
        let hashes = [[7u8; 32], [7u8; 32]];
        assert!(!verify_group(&members, &hashes, &cancel).unwrap());
        let _: SourceStamp = members[0].source.clone();
    }
}
