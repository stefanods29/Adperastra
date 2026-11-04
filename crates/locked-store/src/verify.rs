//! Independent verification before publication (Step 09k D7). The verifier
//! reopens the candidate through a new pinned handle, opens both key slots,
//! decrypts the index and every chunk, and re-reads every source file to
//! prove its size and SHA-256 did not change while the container was built.

use std::io::Read;
use std::path::{Path, PathBuf};

use age::secrecy::SecretString;
use fs_service::owned_io::{PinnedSource, SourceIdentity};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::crypto::ContainerIdentity;
use crate::error::{LockedError, LockedResult};
use crate::format::ContainerFile;
use crate::keyslots::{open_password_slot, open_recovery_slot};
use crate::limits::Limits;
use crate::types::LockedIndex;

#[derive(Debug, Clone)]
pub struct ExpectedSource {
    pub path: PathBuf,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone)]
pub struct ExpectedContainer {
    pub index: LockedIndex,
    pub sources: Vec<ExpectedSource>,
}

pub fn hash_source(path: &Path) -> LockedResult<(u64, String)> {
    let identity = SourceIdentity::capture(path).map_err(LockedError::from)?;
    let mut source = PinnedSource::open(path, &identity).map_err(LockedError::from)?;
    let mut hasher = Sha256::new();
    let mut buffer = Zeroizing::new(vec![0u8; 1024 * 1024]);
    let mut total = 0u64;
    loop {
        let read = source
            .file_mut()
            .read(&mut buffer)
            .map_err(|_| LockedError::Io)?;
        if read == 0 {
            break;
        }
        total = total
            .checked_add(read as u64)
            .ok_or(LockedError::TooLarge)?;
        hasher.update(&buffer[..read]);
    }
    source.verify_after_read().map_err(LockedError::from)?;
    let digest = hasher.finalize();
    Ok((total, hex_of(&digest)))
}

fn hex_of(digest: &[u8]) -> String {
    let mut text = String::with_capacity(64);
    for byte in digest {
        text.push_str(&format!("{byte:02x}"));
    }
    text
}

/// Verify one finished candidate and return its authenticated index.
pub fn verify_candidate(
    path: &Path,
    expected: &ExpectedContainer,
    password: &SecretString,
    recovery_secret: &str,
    limits: Limits,
) -> LockedResult<LockedIndex> {
    let mut container = ContainerFile::open(path, limits)?;
    let header = container.header().clone();
    let from_password = open_password_slot(&header, container.password_slot(), password)?;
    let from_recovery = open_recovery_slot(&header, container.recovery_slot(), recovery_secret)?;
    if from_password.recipient() != from_recovery.recipient()
        || from_password.recipient() != header.content_recipient
    {
        return Err(LockedError::BadPasswordOrCorrupt);
    }
    let identity = ContainerIdentity::from_secret(from_password.secret().clone())?;
    let index = container.verify_all(&identity)?;
    if index.container_id != expected.index.container_id
        || index.revision != expected.index.revision
        || index.entries != expected.index.entries
        || index.chunk_records != expected.index.chunk_records
    {
        return Err(LockedError::Changed);
    }
    for source in &expected.sources {
        let (size, digest) = hash_source(&source.path)?;
        if size != source.size || digest != source.sha256 {
            return Err(LockedError::Changed);
        }
    }
    container.verify_source()?;
    Ok(index)
}

/// Verify an already-published container that has no external sources (a
/// pending generation or a saved copy).
pub fn verify_generation(
    path: &Path,
    expected_index: &LockedIndex,
    identity: &ContainerIdentity,
    limits: Limits,
) -> LockedResult<LockedIndex> {
    let mut container = ContainerFile::open(path, limits)?;
    if container.header().content_recipient != identity.recipient() {
        return Err(LockedError::BadPasswordOrCorrupt);
    }
    let index = container.verify_all(identity)?;
    if index.container_id != expected_index.container_id
        || index.revision != expected_index.revision
        || index.entries != expected_index.entries
        || index.chunk_records != expected_index.chunk_records
    {
        return Err(LockedError::Changed);
    }
    container.verify_source()?;
    Ok(index)
}
