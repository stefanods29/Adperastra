//! Create a verified encrypted copy (Step 09k D7). The source folder is only
//! read; it is never moved, recycled or claimed as protected. A cancelled or
//! failed creation disposes only the app-owned staging output.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use age::secrecy::SecretString;
use fs_service::owned_io::{OwnedOutput, PinnedDirectory, PinnedSource};
use fs_service::CancellationToken;
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::chunks::{encrypt_chunk, sha256_hex};
use crate::crypto::{encrypt_to_recipient, ContainerIdentity};
use crate::error::{LockedError, LockedResult};
use crate::format::StreamingContainer;
use crate::index::{build_index, encode_index};
use crate::keyslots::{seal_password_slot, seal_recovery_slot};
use crate::limits::{
    Limits, MAX_CHUNK_PLAIN_BYTES, MAX_CONTAINER_BYTES, MAX_FILE_BYTES, MAX_INDEX_CHUNKS,
};
use crate::recovery_key::{build_recovery_file, encode_recovery_file};
use crate::sources::{collect_sources, mime_for_name, relative_key, SourceFile, SourceTree};
use crate::types::{
    LockedCreateRequest, LockedCreateResult, LockedEntry, LockedEntryKind, LockedHeader,
    LockedIndex, CONTAINER_SCHEMA_VERSION,
};
use crate::validation::{validate_index, validate_password};
use crate::verify::{verify_candidate, ExpectedContainer, ExpectedSource};

pub type ProgressCallback<'a> = &'a mut dyn FnMut(u64, u64, &str);

pub struct CreateDeps<'a> {
    pub is_from_internet: &'a dyn Fn(&Path) -> bool,
    pub token: &'a CancellationToken,
    pub progress: Option<ProgressCallback<'a>>,
}

impl<'a> CreateDeps<'a> {
    pub fn quiet(
        is_from_internet: &'a dyn Fn(&Path) -> bool,
        token: &'a CancellationToken,
    ) -> Self {
        Self {
            is_from_internet,
            token,
            progress: None,
        }
    }
}

fn checked(token: &CancellationToken) -> LockedResult<()> {
    if token.load(std::sync::atomic::Ordering::Relaxed) {
        return Err(LockedError::Cancelled);
    }
    Ok(())
}

fn absolute_path(value: &str) -> LockedResult<PathBuf> {
    if value.is_empty() || value.len() > 32768 || value.contains('\0') {
        return Err(LockedError::Invalid);
    }
    let path = PathBuf::from(value);
    let text = path.to_string_lossy();
    let drive = text.len() >= 3
        && text.as_bytes()[0].is_ascii_alphabetic()
        && text.as_bytes()[1] == b':'
        && matches!(text.as_bytes()[2], b'\\' | b'/');
    if !drive && !text.starts_with("\\\\") {
        return Err(LockedError::Invalid);
    }
    if text.starts_with("\\\\.\\") || text.starts_with("\\\\?\\GLOBALROOT") {
        return Err(LockedError::Invalid);
    }
    if text.split(['\\', '/']).any(|part| part == "..") {
        return Err(LockedError::Invalid);
    }
    Ok(path)
}

fn extension_of(path: &Path, expected: &str) -> LockedResult<()> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or(LockedError::Invalid)?;
    if !name.to_ascii_lowercase().ends_with(&format!(".{expected}")) {
        return Err(LockedError::Invalid);
    }
    Ok(())
}

pub fn create_locked_copy(
    request: &LockedCreateRequest,
    deps: &mut CreateDeps<'_>,
) -> LockedResult<LockedCreateResult> {
    create_locked_copy_with_limits(request, deps, Limits::default())
}

pub fn create_locked_copy_with_limits(
    request: &LockedCreateRequest,
    deps: &mut CreateDeps<'_>,
    limits: Limits,
) -> LockedResult<LockedCreateResult> {
    if !request.keep_original || !request.confirm_original_unprotected {
        return Err(LockedError::Invalid);
    }
    validate_password(&request.password)?;
    let source_dir = absolute_path(&request.source_dir)?;
    let dest_path = absolute_path(&request.dest_path)?;
    let recovery_path = absolute_path(&request.recovery_dest_path)?;
    extension_of(&dest_path, "adplock")?;
    extension_of(&recovery_path, "adprecovery")?;
    if dest_path
        .to_string_lossy()
        .eq_ignore_ascii_case(&recovery_path.to_string_lossy())
        || dest_path.exists()
        || recovery_path.exists()
    {
        return Err(LockedError::Invalid);
    }
    let source_meta = std::fs::symlink_metadata(&source_dir).map_err(|_| LockedError::Invalid)?;
    if !source_meta.is_dir() || crate::sources::is_link(&source_meta) {
        return Err(LockedError::Invalid);
    }
    let tree = collect_sources(&source_dir, deps.is_from_internet)?;
    let container_id = Uuid::new_v4();
    let content_identity = ContainerIdentity::generate();
    let recovery_identity = ContainerIdentity::generate();

    // Stage the recovery key before the container. A finished container
    // must never be published without the separate key file the user was
    // promised; both staging files are disposed on any failure.
    let recovery_bytes =
        encode_recovery_file(&build_recovery_file(container_id, &recovery_identity))?;
    let recovery_parent = recovery_path.parent().ok_or(LockedError::Invalid)?;
    let recovery_name = recovery_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or(LockedError::Invalid)?;
    let recovery_pin = PinnedDirectory::open(recovery_parent).map_err(LockedError::from)?;
    let mut recovery_output =
        OwnedOutput::create(&recovery_pin, "recovery").map_err(LockedError::from)?;
    recovery_output
        .file_mut()
        .write_all(&recovery_bytes)
        .map_err(LockedError::from)?;
    recovery_output.flush_sync().map_err(LockedError::from)?;

    let dest_parent = dest_path.parent().ok_or(LockedError::Invalid)?;
    let pin = PinnedDirectory::open(dest_parent).map_err(LockedError::from)?;
    let mut output = OwnedOutput::create(&pin, "locked").map_err(LockedError::from)?;
    let (index, _header, expected) = write_new_container(
        output.file_mut(),
        container_id,
        &content_identity,
        &recovery_identity,
        &request.password,
        &tree,
        deps,
        limits,
    )?;
    output.flush_sync().map_err(LockedError::from)?;
    let closed = output.close();
    let verified = verify_candidate(
        closed.path(),
        &ExpectedContainer {
            index,
            sources: expected,
        },
        &request.password,
        {
            use age::secrecy::ExposeSecret;
            recovery_identity.secret().expose_secret()
        },
        limits,
    );
    if let Err(error) = verified {
        let _ = closed.dispose();
        return Err(error);
    }
    if let Err(error) = checked(deps.token) {
        let _ = closed.dispose();
        return Err(error);
    }
    if let Err(error) = recovery_output.publish_name(recovery_name) {
        let _ = closed.dispose();
        return Err(LockedError::from(error));
    }
    closed.publish_to(&dest_path).map_err(LockedError::from)?;

    Ok(LockedCreateResult {
        path: dest_path.to_string_lossy().into_owned(),
        container_id,
        recovery_path: recovery_path.to_string_lossy().into_owned(),
        original_kept: true,
        skipped: tree.skipped,
    })
}

/// Test seam: write a container into any seekable writer without publishing
/// it. Production callers use `create_locked_copy`, which verifies first.
#[doc(hidden)]
#[allow(clippy::too_many_arguments)]
pub fn write_new_container<W: Write + std::io::Seek>(
    writer: W,
    container_id: Uuid,
    content_identity: &ContainerIdentity,
    recovery_identity: &ContainerIdentity,
    password: &SecretString,
    tree: &SourceTree,
    deps: &mut CreateDeps<'_>,
    limits: Limits,
) -> LockedResult<(LockedIndex, LockedHeader, Vec<ExpectedSource>)> {
    let entry_count = tree.folders.len().saturating_add(tree.files.len());
    if entry_count > limits.max_index_entries || entry_count > crate::limits::MAX_INDEX_ENTRIES {
        return Err(LockedError::TooLarge);
    }
    let mut stream = StreamingContainer::new(writer)?;
    let mut entries = Vec::with_capacity(tree.folders.len() + tree.files.len());
    let mut ids: HashMap<String, Uuid> = HashMap::new();

    for folder in &tree.folders {
        let id = Uuid::new_v4();
        ids.insert(relative_key(&folder.relative), id);
        entries.push(LockedEntry {
            id,
            parent_id: parent_id_of(&ids, &folder.relative),
            name: folder
                .relative
                .last()
                .cloned()
                .ok_or(LockedError::Invalid)?,
            kind: LockedEntryKind::Folder,
            mime: String::new(),
            size: 0,
            modified_unix: folder.modified_unix,
            chunks: Vec::new(),
            from_internet: false,
            hidden: folder.hidden,
            system: folder.system,
            read_only: folder.read_only,
        });
    }

    let total_items = tree.files.len() as u64;
    let mut done_items = 0u64;
    let mut total_file_bytes = 0u64;
    let mut chunk_records = Vec::new();
    let mut expected_sources = Vec::new();

    for file in &tree.files {
        checked(deps.token)?;
        if file.size > MAX_FILE_BYTES {
            return Err(LockedError::TooLarge);
        }
        total_file_bytes = total_file_bytes
            .checked_add(file.size)
            .ok_or(LockedError::TooLarge)?;
        if total_file_bytes > MAX_CONTAINER_BYTES {
            return Err(LockedError::TooLarge);
        }
        let id = Uuid::new_v4();
        let parent_id = parent_id_of(&ids, &file.relative);
        let (chunks, records, size, digest) =
            write_file_chunks(&mut stream, content_identity, file, deps)?;
        chunk_records.extend(records);
        if chunk_records.len() > limits.max_index_chunks || chunk_records.len() > MAX_INDEX_CHUNKS {
            return Err(LockedError::TooLarge);
        }
        expected_sources.push(ExpectedSource {
            path: file.path.clone(),
            size,
            sha256: digest,
        });
        entries.push(LockedEntry {
            id,
            parent_id,
            name: file.relative.last().cloned().ok_or(LockedError::Invalid)?,
            kind: LockedEntryKind::File,
            mime: mime_for_name(file.relative.last().map(String::as_str).unwrap_or_default())
                .to_string(),
            size,
            modified_unix: file.modified_unix,
            chunks,
            from_internet: file.from_internet,
            hidden: file.hidden,
            system: file.system,
            read_only: file.read_only,
        });
        done_items += 1;
        if let Some(progress) = deps.progress.as_mut() {
            progress(done_items, total_items, &file.path.to_string_lossy());
        }
    }
    let index = build_index(container_id, 1, entries, chunk_records);
    validate_index(&index, &limits)?;
    let index_plain = encode_index(&index, &limits)?;
    let index_cipher = encrypt_to_recipient(content_identity.recipient(), &index_plain)?;
    let password_slot = seal_password_slot(content_identity, container_id, password)?;
    let recovery_slot = seal_recovery_slot(
        content_identity,
        container_id,
        recovery_identity.recipient(),
    )?;
    let header = LockedHeader {
        schema_version: CONTAINER_SCHEMA_VERSION,
        container_id,
        content_recipient: content_identity.recipient().to_string(),
        created_unix: crate::limits::now_unix().max(1),
        chunk_count: index.chunk_records.len() as u32,
        index_cipher_sha256: sha256_hex(&index_cipher),
        password_slot_sha256: sha256_hex(&password_slot),
        recovery_slot_sha256: sha256_hex(&recovery_slot),
    };
    stream.finish(&header, &password_slot, &recovery_slot, &index_cipher)?;
    Ok((index, header, expected_sources))
}

fn parent_id_of(ids: &HashMap<String, Uuid>, relative: &[String]) -> Option<Uuid> {
    if relative.len() <= 1 {
        return None;
    }
    ids.get(&relative_key(&relative[..relative.len() - 1]))
        .copied()
}

fn write_file_chunks<W: Write + std::io::Seek>(
    stream: &mut StreamingContainer<W>,
    content_identity: &ContainerIdentity,
    file: &SourceFile,
    deps: &mut CreateDeps<'_>,
) -> LockedResult<(Vec<Uuid>, Vec<crate::types::LockedChunk>, u64, String)> {
    let mut source = PinnedSource::open(&file.path, &file.identity).map_err(LockedError::from)?;
    let mut chunks = Vec::new();
    let mut records = Vec::new();
    let mut total = 0u64;
    let mut hasher = Sha256::new();
    loop {
        checked(deps.token)?;
        let mut buffer = Zeroizing::new(Vec::with_capacity(MAX_CHUNK_PLAIN_BYTES as usize));
        let read = source
            .file_mut()
            .take(MAX_CHUNK_PLAIN_BYTES)
            .read_to_end(&mut buffer)
            .map_err(|_| LockedError::Io)?;
        if read == 0 {
            break;
        }
        total = total
            .checked_add(read as u64)
            .ok_or(LockedError::TooLarge)?;
        if total > file.size || total > crate::limits::MAX_FILE_BYTES {
            return Err(LockedError::Changed);
        }
        hasher.update(&buffer);
        let (ciphertext, record) = encrypt_chunk(content_identity.recipient(), &buffer)?;
        stream.add_chunk(record.id, &ciphertext)?;
        chunks.push(record.id);
        records.push(record);
    }
    source.verify_after_read().map_err(LockedError::from)?;
    if total != file.size {
        return Err(LockedError::Changed);
    }
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(64);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    Ok((chunks, records, total, hex))
}
