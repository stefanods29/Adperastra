//! Chunk encryption and authenticated range reads (Step 09k D5). A chunk is
//! exposed only after its age final tag, its plaintext hash and its declared
//! length agree. Chunk sharing never bypasses those checks.

use age::secrecy::SecretString;
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::crypto::{decrypt_content, encrypt_to_recipient, ContainerIdentity};
use crate::error::{LockedError, LockedResult};
use crate::limits::{MAX_CHUNK_CIPHER_BYTES, MAX_CHUNK_PLAIN_BYTES, MAX_READ_RANGE};
use crate::types::{LockedChunk, LockedEntry};

pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut text = String::with_capacity(64);
    for byte in digest {
        text.push_str(&format!("{byte:02x}"));
    }
    text
}

pub fn encrypt_chunk(recipient: &str, plaintext: &[u8]) -> LockedResult<(Vec<u8>, LockedChunk)> {
    if plaintext.is_empty() || plaintext.len() as u64 > MAX_CHUNK_PLAIN_BYTES {
        return Err(LockedError::TooLarge);
    }
    let ciphertext = encrypt_to_recipient(recipient, plaintext)?;
    if ciphertext.len() as u64 > MAX_CHUNK_CIPHER_BYTES {
        return Err(LockedError::TooLarge);
    }
    let record = LockedChunk {
        id: Uuid::new_v4(),
        cipher_sha256: sha256_hex(&ciphertext),
        plain_sha256: sha256_hex(plaintext),
        plain_len: plaintext.len() as u32,
    };
    Ok((ciphertext, record))
}

pub fn decrypt_chunk(
    identity: &ContainerIdentity,
    record: &LockedChunk,
    ciphertext: &[u8],
) -> LockedResult<Zeroizing<Vec<u8>>> {
    if ciphertext.len() as u64 > MAX_CHUNK_CIPHER_BYTES
        || record.plain_len == 0
        || record.plain_len as u64 > MAX_CHUNK_PLAIN_BYTES
    {
        return Err(LockedError::TooLarge);
    }
    if sha256_hex(ciphertext) != record.cipher_sha256 {
        return Err(LockedError::Changed);
    }
    let plain = decrypt_content(identity, ciphertext, record.plain_len as u64)?;
    if plain.len() != record.plain_len as usize {
        return Err(LockedError::BadPasswordOrCorrupt);
    }
    if sha256_hex(&plain) != record.plain_sha256 {
        return Err(LockedError::BadPasswordOrCorrupt);
    }
    Ok(plain)
}

/// Read one exact range of a file by decrypting only the chunks it covers.
/// The loader returns the outer ciphertext for one chunk id.
pub fn read_entry_range(
    identity: &ContainerIdentity,
    entry: &LockedEntry,
    records: &[LockedChunk],
    offset: u64,
    length: u64,
    mut load_chunk: impl FnMut(Uuid) -> LockedResult<Zeroizing<Vec<u8>>>,
) -> LockedResult<Zeroizing<Vec<u8>>> {
    if !entry.is_file() {
        return Err(LockedError::Invalid);
    }
    if length == 0 {
        if offset > entry.size {
            return Err(LockedError::Invalid);
        }
        return Ok(Zeroizing::new(Vec::new()));
    }
    if length > MAX_READ_RANGE {
        return Err(LockedError::TooLarge);
    }
    let end = offset.checked_add(length).ok_or(LockedError::TooLarge)?;
    if end > entry.size {
        return Err(LockedError::Invalid);
    }
    let by_id: std::collections::HashMap<Uuid, &LockedChunk> =
        records.iter().map(|record| (record.id, record)).collect();
    let mut output = Zeroizing::new(Vec::with_capacity(length as usize));
    let mut position = 0u64;
    for chunk_id in &entry.chunks {
        let record = by_id.get(chunk_id).ok_or(LockedError::Invalid)?;
        let chunk_start = position;
        let chunk_end = position
            .checked_add(record.plain_len as u64)
            .ok_or(LockedError::TooLarge)?;
        position = chunk_end;
        if chunk_end <= offset || chunk_start >= end {
            continue;
        }
        let ciphertext = load_chunk(*chunk_id)?;
        let plain = decrypt_chunk(identity, record, &ciphertext)?;
        let from = offset.saturating_sub(chunk_start) as usize;
        let to = (end.min(chunk_end) - chunk_start) as usize;
        if to > plain.len() || from > to {
            return Err(LockedError::BadPasswordOrCorrupt);
        }
        output.extend_from_slice(&plain[from..to]);
    }
    if output.len() as u64 != length {
        return Err(LockedError::BadPasswordOrCorrupt);
    }
    Ok(output)
}

/// Split an 8 MiB wrapper request into at most two protocol-sized reads.
pub fn protocol_ranges(offset: u64, length: u64) -> LockedResult<Vec<(u64, u64)>> {
    if length > MAX_READ_RANGE || offset.checked_add(length).is_none() {
        return Err(LockedError::TooLarge);
    }
    if length == 0 {
        return Ok(Vec::new());
    }
    let first = length.min(crate::limits::MAX_PROTOCOL_RANGE);
    let second = length - first;
    if second == 0 {
        Ok(vec![(offset, first)])
    } else {
        Ok(vec![(offset, first), (offset + first, second)])
    }
}

pub fn chunk_plain_len(record: &LockedChunk) -> u64 {
    record.plain_len as u64
}

/// A zeroizing copy for the pending/generation writers.
pub fn memory_of(bytes: &[u8]) -> Zeroizing<Vec<u8>> {
    Zeroizing::new(bytes.to_vec())
}

/// A password is transported as a secret string, never as a plain text log
/// line. This helper exists so callers do not invent another wrapper.
pub fn secret_of(value: &str) -> SecretString {
    SecretString::from(value.to_string())
}
