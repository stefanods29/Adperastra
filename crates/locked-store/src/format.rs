//! The outer `.adplock` container (Step 09k D3): ZIP64 with stored entries
//! only. Names are exactly the four fixed entries plus `chunks/<uuid>.age`.
//! No original name, no inner path and no plaintext ever reaches this layer.
//!
//! Reading uses a pinned source handle and re-checks its identity after every
//! entry. Every archive name, count and length is validated before a caller
//! can reach the header, a key slot, the index or one chunk.

use std::collections::HashSet;
use std::io::{Read, Write};

use fs_service::owned_io::{OwnedOutput, PinnedSource, SourceIdentity};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::chunks::{decrypt_chunk, read_entry_range, sha256_hex};
use crate::crypto::ContainerIdentity;
use crate::error::{LockedError, LockedResult};
use crate::index::decode_index;
use crate::limits::{Limits, MAX_HEADER_BYTES, MAX_KEY_SLOT_BYTES};
use crate::types::{LockedChunk, LockedEntry, LockedHeader, LockedIndex};
use crate::validation::{
    chunk_name, outer_entry_kind, validate_header, validate_outer_names, OuterEntryKind,
};

fn zip_error(error: zip::result::ZipError) -> LockedError {
    match error {
        zip::result::ZipError::Io(error) => LockedError::from(error),
        _ => LockedError::Io,
    }
}

#[derive(Debug, Clone)]
struct OuterEntry {
    name: String,
    size: u64,
}

/// One opened container, pinned for its whole session lifetime.
pub struct ContainerFile {
    header: LockedHeader,
    password_slot: Zeroizing<Vec<u8>>,
    recovery_slot: Zeroizing<Vec<u8>>,
    index_cipher: Zeroizing<Vec<u8>>,
    chunk_ids: Vec<Uuid>,
    names: Vec<OuterEntry>,
    source: PinnedSource,
    limits: Limits,
}

impl std::fmt::Debug for ContainerFile {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ContainerFile")
            .field("container_id", &self.header.container_id)
            .field("chunk_count", &self.header.chunk_count)
            .finish_non_exhaustive()
    }
}

impl ContainerFile {
    pub fn open(path: &std::path::Path, limits: Limits) -> LockedResult<Self> {
        let identity = SourceIdentity::capture(path).map_err(LockedError::from)?;
        let source = PinnedSource::open(path, &identity).map_err(LockedError::from)?;
        let mut file = Self {
            header: LockedHeader {
                schema_version: 0,
                container_id: Uuid::nil(),
                content_recipient: String::new(),
                created_unix: 0,
                chunk_count: 0,
                index_cipher_sha256: String::new(),
                password_slot_sha256: String::new(),
                recovery_slot_sha256: String::new(),
            },
            password_slot: Zeroizing::new(Vec::new()),
            recovery_slot: Zeroizing::new(Vec::new()),
            index_cipher: Zeroizing::new(Vec::new()),
            chunk_ids: Vec::new(),
            names: Vec::new(),
            source,
            limits,
        };
        file.names = file.list_outer_entries()?;
        if file.names.len() < 4 {
            return Err(LockedError::Invalid);
        }
        let header_bytes = file.read_raw("header.json", limits.max_header_bytes)?;
        let header: LockedHeader =
            serde_json::from_slice(&header_bytes).map_err(|_| LockedError::Invalid)?;
        validate_header(&header)?;
        let chunk_ids = validate_outer_names(
            &file
                .names
                .iter()
                .map(|entry| entry.name.clone())
                .collect::<Vec<_>>(),
            &header,
        )?;
        let mut fixed = HashSet::new();
        for entry in &file.names {
            match outer_entry_kind(&entry.name) {
                Some(OuterEntryKind::Header) => {
                    fixed.insert("header");
                }
                Some(OuterEntryKind::PasswordSlot) => {
                    fixed.insert("password");
                }
                Some(OuterEntryKind::RecoverySlot) => {
                    fixed.insert("recovery");
                }
                Some(OuterEntryKind::Index) => {
                    fixed.insert("index");
                }
                Some(OuterEntryKind::Chunk(_)) => {}
                None => return Err(LockedError::Invalid),
            }
            let limit = match outer_entry_kind(&entry.name) {
                Some(OuterEntryKind::Header) => limits.max_header_bytes,
                Some(OuterEntryKind::PasswordSlot | OuterEntryKind::RecoverySlot) => {
                    limits.max_key_slot_bytes
                }
                Some(OuterEntryKind::Index) => limits.max_index_cipher_bytes,
                Some(OuterEntryKind::Chunk(_)) => limits.max_chunk_cipher_bytes,
                None => return Err(LockedError::Invalid),
            };
            if entry.size > limit {
                return Err(LockedError::TooLarge);
            }
        }
        if fixed.len() != 4 {
            return Err(LockedError::Invalid);
        }
        file.password_slot = file.read_raw("keyslots/password.age", limits.max_key_slot_bytes)?;
        file.recovery_slot = file.read_raw("keyslots/recovery.age", limits.max_key_slot_bytes)?;
        file.index_cipher = file.read_raw("index.age", limits.max_index_cipher_bytes)?;
        if sha256_hex(&file.password_slot) != header.password_slot_sha256
            || sha256_hex(&file.recovery_slot) != header.recovery_slot_sha256
            || sha256_hex(&file.index_cipher) != header.index_cipher_sha256
        {
            return Err(LockedError::Changed);
        }
        file.source.verify_after_read().map_err(LockedError::from)?;
        file.chunk_ids = chunk_ids;
        file.header = header;
        Ok(file)
    }

    fn list_outer_entries(&mut self) -> LockedResult<Vec<OuterEntry>> {
        let mut archive =
            zip::ZipArchive::new(self.source.file_mut()).map_err(|_| LockedError::Invalid)?;
        if archive.len() > self.limits.max_outer_entries {
            return Err(LockedError::TooLarge);
        }
        let mut entries = Vec::with_capacity(archive.len());
        for index in 0..archive.len() {
            let entry = archive
                .by_index_raw(index)
                .map_err(|_| LockedError::Invalid)?;
            if entry.is_dir()
                || entry.encrypted()
                || entry.compression() != zip::CompressionMethod::Stored
            {
                return Err(LockedError::Invalid);
            }
            let name = entry.name().map_err(|_| LockedError::Invalid)?.to_string();
            if outer_entry_kind(&name).is_none() {
                return Err(LockedError::Invalid);
            }
            if entry.size() != entry.compressed_size() {
                return Err(LockedError::Invalid);
            }
            entries.push(OuterEntry {
                name,
                size: entry.size(),
            });
        }
        Ok(entries)
    }

    fn read_raw(&mut self, name: &str, max: u64) -> LockedResult<Zeroizing<Vec<u8>>> {
        let mut archive =
            zip::ZipArchive::new(self.source.file_mut()).map_err(|_| LockedError::Changed)?;
        let mut entry = archive.by_name(name).map_err(|_| LockedError::Changed)?;
        if entry.is_dir()
            || entry.encrypted()
            || entry.compression() != zip::CompressionMethod::Stored
            || entry.size() > max
            || entry.size() != entry.compressed_size()
        {
            return Err(LockedError::Changed);
        }
        let declared = entry.size();
        let mut bytes = Zeroizing::new(Vec::with_capacity(declared as usize));
        entry
            .by_ref()
            .take(max.saturating_add(1))
            .read_to_end(&mut bytes)
            .map_err(|_| LockedError::Changed)?;
        if bytes.len() as u64 != declared {
            return Err(LockedError::Changed);
        }
        drop(entry);
        drop(archive);
        self.source.verify_after_read().map_err(LockedError::from)?;
        Ok(bytes)
    }

    pub fn header(&self) -> &LockedHeader {
        &self.header
    }

    pub fn chunk_ids(&self) -> &[Uuid] {
        &self.chunk_ids
    }

    pub fn password_slot(&self) -> &[u8] {
        &self.password_slot
    }

    pub fn recovery_slot(&self) -> &[u8] {
        &self.recovery_slot
    }

    pub fn index_cipher(&self) -> &[u8] {
        &self.index_cipher
    }

    pub fn read_chunk(&mut self, id: Uuid) -> LockedResult<Zeroizing<Vec<u8>>> {
        if !self.chunk_ids.contains(&id) {
            return Err(LockedError::Invalid);
        }
        self.read_raw(&chunk_name(id), self.limits.max_chunk_cipher_bytes)
    }

    /// Decrypt the authenticated index with the container identity.
    pub fn open_index(&mut self, identity: &ContainerIdentity) -> LockedResult<LockedIndex> {
        if identity.recipient() != self.header.content_recipient {
            return Err(LockedError::BadPasswordOrCorrupt);
        }
        let plain = crate::crypto::decrypt_content(
            identity,
            &self.index_cipher,
            self.limits.max_index_plain_bytes,
        )?;
        let index = decode_index(&plain, &self.limits)?;
        if index.container_id != self.header.container_id
            || index.chunk_records.len() != self.chunk_ids.len()
        {
            return Err(LockedError::BadPasswordOrCorrupt);
        }
        let index_ids: HashSet<Uuid> = index.chunk_records.iter().map(|chunk| chunk.id).collect();
        let outer_ids: HashSet<Uuid> = self.chunk_ids.iter().copied().collect();
        if index_ids != outer_ids {
            return Err(LockedError::BadPasswordOrCorrupt);
        }
        Ok(index)
    }

    pub fn read_entry_range(
        &mut self,
        identity: &ContainerIdentity,
        entry: &LockedEntry,
        records: &[LockedChunk],
        offset: u64,
        length: u64,
    ) -> LockedResult<Zeroizing<Vec<u8>>> {
        read_entry_range(identity, entry, records, offset, length, |id| {
            self.read_chunk(id)
        })
    }

    /// Independent verification: decrypt every chunk and compare the index.
    pub fn verify_all(&mut self, identity: &ContainerIdentity) -> LockedResult<LockedIndex> {
        let index = self.open_index(identity)?;
        let by_id: std::collections::HashMap<Uuid, &LockedChunk> = index
            .chunk_records
            .iter()
            .map(|chunk| (chunk.id, chunk))
            .collect();
        for id in self.chunk_ids.clone() {
            let record = by_id.get(&id).ok_or(LockedError::Invalid)?;
            let ciphertext = self.read_chunk(id)?;
            let _ = decrypt_chunk(identity, record, &ciphertext)?;
        }
        Ok(index)
    }

    pub fn verify_source(&self) -> LockedResult<()> {
        self.source.verify_after_read().map_err(LockedError::from)
    }

    /// Read only the plain header, for the recovery list. No key is touched.
    pub fn read_header_only(path: &std::path::Path, limits: Limits) -> LockedResult<LockedHeader> {
        let identity = SourceIdentity::capture(path).map_err(LockedError::from)?;
        let mut source = PinnedSource::open(path, &identity).map_err(LockedError::from)?;
        let mut archive =
            zip::ZipArchive::new(source.file_mut()).map_err(|_| LockedError::Invalid)?;
        let mut entry = archive
            .by_name("header.json")
            .map_err(|_| LockedError::Invalid)?;
        if entry.is_dir()
            || entry.encrypted()
            || entry.compression() != zip::CompressionMethod::Stored
            || entry.size() != entry.compressed_size()
        {
            return Err(LockedError::Invalid);
        }
        if entry.size() > limits.max_header_bytes {
            return Err(LockedError::TooLarge);
        }
        let mut bytes = Zeroizing::new(Vec::new());
        entry
            .by_ref()
            .take(limits.max_header_bytes + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| LockedError::Invalid)?;
        drop(entry);
        drop(archive);
        source.verify_after_read().map_err(LockedError::from)?;
        let header: LockedHeader =
            serde_json::from_slice(&bytes).map_err(|_| LockedError::Invalid)?;
        validate_header(&header)?;
        Ok(header)
    }
}

/// A streaming writer for one new container. Chunks are written as they are
/// produced; the fixed entries and header come last, so a 4 TiB container
/// never has to exist in memory.
pub struct StreamingContainer<W: Write + std::io::Seek> {
    writer: zip::ZipWriter<W>,
    options: zip::write::SimpleFileOptions,
    chunk_ids: HashSet<Uuid>,
}

impl<W: Write + std::io::Seek> StreamingContainer<W> {
    pub fn new(writer: W) -> LockedResult<Self> {
        Ok(Self {
            writer: zip::ZipWriter::new(writer),
            options: zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored)
                .large_file(true),
            chunk_ids: HashSet::new(),
        })
    }

    pub fn into_inner(self) -> LockedResult<W> {
        self.writer.finish().map_err(zip_error)
    }

    pub fn add_chunk(&mut self, id: Uuid, bytes: &[u8]) -> LockedResult<()> {
        if id.is_nil()
            || !self.chunk_ids.insert(id)
            || bytes.len() as u64 > crate::limits::MAX_CHUNK_CIPHER_BYTES
        {
            return Err(LockedError::Invalid);
        }
        self.writer
            .start_file(chunk_name(id), self.options)
            .map_err(zip_error)?;
        self.writer.write_all(bytes).map_err(LockedError::from)
    }

    pub fn finish(
        mut self,
        header: &LockedHeader,
        password_slot: &[u8],
        recovery_slot: &[u8],
        index_cipher: &[u8],
    ) -> LockedResult<()> {
        if self.chunk_ids.len() != header.chunk_count as usize {
            return Err(LockedError::Invalid);
        }
        if password_slot.len() as u64 > MAX_KEY_SLOT_BYTES
            || recovery_slot.len() as u64 > MAX_KEY_SLOT_BYTES
            || index_cipher.len() as u64 > crate::limits::MAX_INDEX_CIPHER_BYTES
        {
            return Err(LockedError::TooLarge);
        }
        for (name, bytes) in [
            ("index.age", index_cipher),
            ("keyslots/password.age", password_slot),
            ("keyslots/recovery.age", recovery_slot),
        ] {
            self.writer
                .start_file(name.to_string(), self.options)
                .map_err(zip_error)?;
            self.writer.write_all(bytes).map_err(LockedError::from)?;
        }
        let header = serde_json::to_vec(header).map_err(|_| LockedError::Invalid)?;
        if header.len() as u64 > MAX_HEADER_BYTES {
            return Err(LockedError::TooLarge);
        }
        self.writer
            .start_file("header.json".to_string(), self.options)
            .map_err(zip_error)?;
        self.writer.write_all(&header).map_err(LockedError::from)?;
        self.writer.finish().map_err(zip_error)?;
        Ok(())
    }
}

pub struct ContainerParts<'a> {
    pub header: &'a LockedHeader,
    pub password_slot: &'a [u8],
    pub recovery_slot: &'a [u8],
    pub index_cipher: &'a [u8],
    pub chunks: &'a [(Uuid, Vec<u8>)],
}

/// Write a complete container into an owned staging output. The caller
/// flushes, verifies and publishes it; this function never publishes.
pub fn write_container(output: &mut OwnedOutput, parts: &ContainerParts<'_>) -> LockedResult<()> {
    if parts.password_slot.len() as u64 > MAX_KEY_SLOT_BYTES
        || parts.recovery_slot.len() as u64 > MAX_KEY_SLOT_BYTES
        || parts.index_cipher.len() as u64 > crate::limits::MAX_INDEX_CIPHER_BYTES
        || parts.chunks.len() > crate::limits::MAX_INDEX_CHUNKS
        || parts.chunks.len() != parts.header.chunk_count as usize
    {
        return Err(LockedError::TooLarge);
    }
    let mut writer = zip::ZipWriter::new(output.file_mut());
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Stored)
        .large_file(true);
    let mut sorted = parts.chunks.to_vec();
    sorted.sort_by_key(|(id, _)| *id);
    let mut previous = None;
    for (id, bytes) in &sorted {
        if id.is_nil()
            || previous == Some(*id)
            || bytes.len() as u64 > crate::limits::MAX_CHUNK_CIPHER_BYTES
        {
            return Err(LockedError::Invalid);
        }
        previous = Some(*id);
        writer
            .start_file(chunk_name(*id), options)
            .map_err(zip_error)?;
        writer.write_all(bytes).map_err(LockedError::from)?;
    }
    for (name, bytes) in [
        ("index.age", parts.index_cipher),
        ("keyslots/password.age", parts.password_slot),
        ("keyslots/recovery.age", parts.recovery_slot),
    ] {
        writer
            .start_file(name.to_string(), options)
            .map_err(zip_error)?;
        writer.write_all(bytes).map_err(LockedError::from)?;
    }
    let header = serde_json::to_vec(parts.header).map_err(|_| LockedError::Invalid)?;
    if header.len() as u64 > MAX_HEADER_BYTES {
        return Err(LockedError::TooLarge);
    }
    writer
        .start_file("header.json".to_string(), options)
        .map_err(zip_error)?;
    writer.write_all(&header).map_err(LockedError::from)?;
    writer.finish().map_err(zip_error)?;
    Ok(())
}
