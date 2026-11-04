//! New encrypted generations (Step 09k D11/D12). Pending recovery and Save
//! encrypted copy both write a complete standard container: existing key
//! slots are copied byte for byte, unchanged chunk ciphertext is copied, and
//! only edited entries are re-encrypted to the container recipient.

use std::collections::{HashMap, HashSet};
use std::io::Write;

use uuid::Uuid;
use zeroize::Zeroizing;

use crate::chunks::encrypt_chunk;
use crate::crypto::{encrypt_to_recipient, ContainerIdentity};
use crate::error::{LockedError, LockedResult};
use crate::format::{ContainerFile, StreamingContainer};
use crate::index::{encode_index, entry_mut, trim_unused_chunks};
use crate::limits::{Limits, MAX_CHUNK_PLAIN_BYTES, MAX_EDITABLE_ENTRY_BYTES};
use crate::types::{LockedChunk, LockedHeader, LockedIndex, CONTAINER_SCHEMA_VERSION};
use crate::validation::validate_index;

#[derive(Clone)]
pub struct ChangeSet {
    pub entry_id: Uuid,
    pub bytes: Zeroizing<Vec<u8>>,
    pub modified_unix: u64,
}

impl std::fmt::Debug for ChangeSet {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ChangeSet")
            .field("entry_id", &self.entry_id)
            .field("byte_len", &self.bytes.len())
            .field("modified_unix", &self.modified_unix)
            .finish()
    }
}

pub struct Generation<'a> {
    pub source: &'a mut ContainerFile,
    pub index: &'a LockedIndex,
    pub identity: &'a ContainerIdentity,
    pub password_slot: &'a [u8],
    pub recovery_slot: &'a [u8],
    pub changes: &'a [ChangeSet],
    pub revision: u64,
    pub limits: Limits,
}

pub fn write_generation<W: Write + std::io::Seek>(
    writer: W,
    generation: Generation<'_>,
) -> LockedResult<(LockedIndex, LockedHeader)> {
    if generation.revision == 0 || generation.changes.len() > crate::limits::MAX_INDEX_ENTRIES {
        return Err(LockedError::Invalid);
    }
    let source_header = generation.source.header();
    // A generation must describe the exact container it came from: same
    // container id, same content identity, unchanged key slots, and a
    // strictly newer revision. No caller may silently rebind or roll back.
    if generation.index.container_id != source_header.container_id
        || generation.identity.recipient() != source_header.content_recipient
        || crate::chunks::sha256_hex(generation.password_slot) != source_header.password_slot_sha256
        || crate::chunks::sha256_hex(generation.recovery_slot) != source_header.recovery_slot_sha256
        || generation.revision <= generation.index.revision
    {
        return Err(LockedError::Changed);
    }
    let mut index = generation.index.clone();
    index.revision = generation.revision;
    let mut stream = StreamingContainer::new(writer)?;
    let mut new_chunks: HashSet<Uuid> = HashSet::new();
    let mut changed_entries: HashSet<Uuid> = HashSet::new();
    let mut new_records: Vec<LockedChunk> = Vec::new();
    for change in generation.changes {
        if !changed_entries.insert(change.entry_id) {
            return Err(LockedError::Invalid);
        }
        if change.bytes.len() as u64 > MAX_EDITABLE_ENTRY_BYTES
            || entry_mut(&mut index, change.entry_id).is_none_or(|entry| !entry.is_file())
        {
            return Err(LockedError::Invalid);
        }
        let mut chunks = Vec::new();
        let mut offset = 0usize;
        while offset < change.bytes.len() {
            let end = (offset + MAX_CHUNK_PLAIN_BYTES as usize).min(change.bytes.len());
            let (ciphertext, record) =
                encrypt_chunk(generation.identity.recipient(), &change.bytes[offset..end])?;
            stream.add_chunk(record.id, &ciphertext)?;
            new_chunks.insert(record.id);
            chunks.push(record.id);
            new_records.push(record);
            offset = end;
        }
        let target = entry_mut(&mut index, change.entry_id).ok_or(LockedError::Invalid)?;
        target.chunks = chunks;
        target.size = change.bytes.len() as u64;
        target.modified_unix = change.modified_unix;
    }
    index.chunk_records.extend(new_records);
    trim_unused_chunks(&mut index);
    validate_index(&index, &generation.limits)?;
    // Copy the ciphertext of every chunk that survived unchanged. A changed
    // entry's old chunks were removed by trim_unused_chunks.
    let records = index.chunk_records.clone();
    for record in records {
        if new_chunks.contains(&record.id) {
            continue;
        }
        let ciphertext = generation.source.read_chunk(record.id)?;
        stream.add_chunk(record.id, &ciphertext)?;
    }
    let index_plain = encode_index(&index, &generation.limits)?;
    let index_cipher = encrypt_to_recipient(generation.identity.recipient(), &index_plain)?;
    let header = LockedHeader {
        schema_version: CONTAINER_SCHEMA_VERSION,
        container_id: index.container_id,
        content_recipient: generation.identity.recipient().to_string(),
        created_unix: crate::limits::now_unix().max(1),
        chunk_count: index.chunk_records.len() as u32,
        index_cipher_sha256: crate::chunks::sha256_hex(&index_cipher),
        password_slot_sha256: crate::chunks::sha256_hex(generation.password_slot),
        recovery_slot_sha256: crate::chunks::sha256_hex(generation.recovery_slot),
    };
    stream.finish(
        &header,
        generation.password_slot,
        generation.recovery_slot,
        &index_cipher,
    )?;
    Ok((index, header))
}

/// Build only the part of a generation that changed for one entry; the
/// pending store uses this to prove captures stay immutable.
pub fn empty_change(entry_id: Uuid, modified_unix: u64) -> ChangeSet {
    ChangeSet {
        entry_id,
        bytes: Zeroizing::new(Vec::new()),
        modified_unix,
    }
}

/// A bounded map for the caller; no names or paths enter it.
pub fn changes_by_entry(changes: &[ChangeSet]) -> HashMap<Uuid, &ChangeSet> {
    changes
        .iter()
        .map(|change| (change.entry_id, change))
        .collect()
}
