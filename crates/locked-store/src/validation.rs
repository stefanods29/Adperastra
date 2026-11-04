//! Structural validation (Step 09k D3-D7). Everything here runs before a
//! byte, a name or a relationship is exposed to the UI.

use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::Path;

use age::secrecy::{ExposeSecret, SecretString};
use std::str::FromStr;
use uuid::Uuid;

use crate::error::{LockedError, LockedResult};
use crate::limits::{
    Limits, MAX_CONTAINER_BYTES, MAX_DEPTH, MAX_FILE_BYTES, MAX_MIME_CHARS, MAX_NAME_UTF16,
    MAX_PASSWORD_BYTES, MAX_RECIPIENT_CHARS, MAX_RELATIVE_PATH_UTF16, MIN_PASSWORD_SCALARS,
};
use crate::types::{
    is_lower_hex_64, LockedChunk, LockedEntry, LockedEntryKind, LockedHeader, LockedIndex,
    LockedKeySlotPayload, LockedRecoveryFile,
};

pub fn password_scalars(password: &SecretString) -> usize {
    password.expose_secret().chars().count()
}

pub fn validate_password(password: &SecretString) -> LockedResult<()> {
    let scalar_count = password_scalars(password);
    if scalar_count < MIN_PASSWORD_SCALARS || password.expose_secret().len() > MAX_PASSWORD_BYTES {
        return Err(LockedError::Invalid);
    }
    // No trimming, normalization or whitespace rule: the exact string the
    // user typed is the password (spaces included).
    Ok(())
}

/// One Windows path component, never a path.
pub fn valid_name(name: &str) -> bool {
    let units = name.encode_utf16().count();
    if units == 0 || units > MAX_NAME_UTF16 || name == "." || name == ".." {
        return false;
    }
    if name.ends_with(' ') || name.ends_with('.') {
        return false;
    }
    if name
        .chars()
        .any(|character| character.is_control() || "<>:\"/\\|?*".contains(character))
    {
        return false;
    }
    let stem = name.split('.').next().unwrap_or(name).to_ascii_uppercase();
    if matches!(
        stem.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    ) {
        return false;
    }
    true
}

pub fn valid_recipient(recipient: &str) -> bool {
    !recipient.is_empty()
        && recipient.chars().count() <= MAX_RECIPIENT_CHARS
        && recipient.starts_with("age1")
        && recipient.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

pub fn valid_mime(mime: &str) -> bool {
    !mime.is_empty()
        && mime.chars().count() <= MAX_MIME_CHARS
        && !mime.chars().any(char::is_control)
}

pub fn validate_header(header: &LockedHeader) -> LockedResult<()> {
    if header.schema_version != crate::limits::CONTAINER_SCHEMA_VERSION {
        return Err(LockedError::Unsupported);
    }
    if !valid_recipient(&header.content_recipient)
        || header.chunk_count as usize > crate::limits::MAX_INDEX_CHUNKS
        || !is_lower_hex_64(&header.index_cipher_sha256)
        || !is_lower_hex_64(&header.password_slot_sha256)
        || !is_lower_hex_64(&header.recovery_slot_sha256)
        || header.container_id.is_nil()
        || header.created_unix == 0
    {
        return Err(LockedError::Invalid);
    }
    Ok(())
}

pub fn validate_keyslot_payload(
    payload: &LockedKeySlotPayload,
    container_id: Uuid,
    content_recipient: &str,
) -> LockedResult<()> {
    if payload.schema_version != crate::limits::KEYS_SLOT_SCHEMA_VERSION {
        return Err(LockedError::Unsupported);
    }
    if payload.container_id != container_id
        || payload.content_recipient != content_recipient
        || !valid_recipient(&payload.content_recipient)
    {
        return Err(LockedError::BadPasswordOrCorrupt);
    }
    let secret = payload.container_secret.expose_secret();
    let identity =
        age::x25519::Identity::from_str(secret).map_err(|_| LockedError::BadPasswordOrCorrupt)?;
    if identity.to_public().to_string() != payload.content_recipient {
        return Err(LockedError::BadPasswordOrCorrupt);
    }
    Ok(())
}

pub fn validate_recovery_file(file: &LockedRecoveryFile) -> LockedResult<()> {
    if file.schema_version != crate::limits::RECOVERY_FILE_SCHEMA_VERSION {
        return Err(LockedError::Unsupported);
    }
    if file.container_id.is_nil() || !valid_recipient(&file.recovery_recipient) {
        return Err(LockedError::Invalid);
    }
    let identity = age::x25519::Identity::from_str(file.recovery_secret.expose_secret())
        .map_err(|_| LockedError::Invalid)?;
    if identity.to_public().to_string() != file.recovery_recipient {
        return Err(LockedError::Invalid);
    }
    Ok(())
}

fn parent_chain_depth(
    id: Uuid,
    by_id: &HashMap<Uuid, &LockedEntry>,
) -> LockedResult<(usize, usize)> {
    let mut visited = HashSet::new();
    let mut depth = 0usize;
    let mut path_units = 0usize;
    let mut current = Some(id);
    while let Some(next) = current {
        if !visited.insert(next) {
            return Err(LockedError::Invalid);
        }
        let entry = by_id.get(&next).ok_or(LockedError::Invalid)?;
        depth += 1;
        if depth > MAX_DEPTH {
            return Err(LockedError::Invalid);
        }
        path_units = path_units
            .checked_add(entry.name.encode_utf16().count())
            .and_then(|value| value.checked_add(1))
            .ok_or(LockedError::Invalid)?;
        current = entry.parent_id;
    }
    if path_units > MAX_RELATIVE_PATH_UTF16 + 1 {
        return Err(LockedError::Invalid);
    }
    Ok((depth, path_units.saturating_sub(1)))
}

pub fn validate_index(index: &LockedIndex, limits: &Limits) -> LockedResult<()> {
    if index.schema_version != crate::limits::CONTAINER_SCHEMA_VERSION {
        return Err(LockedError::Unsupported);
    }
    if index.revision == 0
        || index.container_id.is_nil()
        || index.entries.len() > limits.max_index_entries
        || index.chunk_records.len() > limits.max_index_chunks
        || index.entries.len() > crate::limits::MAX_INDEX_ENTRIES
        || index.chunk_records.len() > crate::limits::MAX_INDEX_CHUNKS
    {
        return Err(LockedError::Invalid);
    }

    let mut by_id: HashMap<Uuid, &LockedEntry> = HashMap::new();
    for entry in &index.entries {
        if entry.id.is_nil() || by_id.insert(entry.id, entry).is_some() {
            return Err(LockedError::Invalid);
        }
    }

    let mut siblings: HashMap<(Option<Uuid>, String), Uuid> = HashMap::new();
    for entry in &index.entries {
        if !valid_name(&entry.name) || (entry.is_file() && !valid_mime(&entry.mime)) {
            return Err(LockedError::Invalid);
        }
        let sibling_key = (entry.parent_id, entry.name.to_lowercase());
        if siblings.insert(sibling_key, entry.id).is_some() {
            return Err(LockedError::Invalid);
        }
        if let Some(parent_id) = entry.parent_id {
            let parent = by_id.get(&parent_id).ok_or(LockedError::Invalid)?;
            if !parent.is_folder() || parent_id == entry.id {
                return Err(LockedError::Invalid);
            }
        }
        let (_, path_units) = parent_chain_depth(entry.id, &by_id)?;
        if path_units > MAX_RELATIVE_PATH_UTF16 {
            return Err(LockedError::Invalid);
        }
    }

    let mut chunks: HashMap<Uuid, &LockedChunk> = HashMap::new();
    let mut previous: Option<Uuid> = None;
    let mut aggregate = 0u64;
    for chunk in &index.chunk_records {
        if chunk.id.is_nil()
            || previous.is_some_and(|id| chunk.id <= id)
            || chunks.insert(chunk.id, chunk).is_some()
            || !is_lower_hex_64(&chunk.cipher_sha256)
            || !is_lower_hex_64(&chunk.plain_sha256)
            || chunk.plain_len == 0
            || chunk.plain_len as u64 > limits.max_chunk_plain_bytes
        {
            return Err(LockedError::Invalid);
        }
        previous = Some(chunk.id);
        aggregate = aggregate
            .checked_add(chunk.plain_len as u64)
            .ok_or(LockedError::TooLarge)?;
    }
    if aggregate > MAX_CONTAINER_BYTES {
        return Err(LockedError::TooLarge);
    }

    let mut used = HashSet::new();
    for entry in &index.entries {
        if entry.kind == LockedEntryKind::Folder {
            if !entry.chunks.is_empty() || entry.size != 0 || !entry.mime.is_empty() {
                return Err(LockedError::Invalid);
            }
            continue;
        }
        if entry.size > MAX_FILE_BYTES {
            return Err(LockedError::TooLarge);
        }
        if entry.chunks.is_empty() {
            if entry.size != 0 {
                return Err(LockedError::Invalid);
            }
            continue;
        }
        let mut seen = BTreeSet::new();
        let mut total = 0u64;
        for chunk_id in &entry.chunks {
            if !seen.insert(*chunk_id) {
                return Err(LockedError::Invalid);
            }
            let chunk = chunks.get(chunk_id).ok_or(LockedError::Invalid)?;
            // Sharing is allowed only with the identical record; the record
            // was validated once, above.
            used.insert(*chunk_id);
            total = total
                .checked_add(chunk.plain_len as u64)
                .ok_or(LockedError::TooLarge)?;
        }
        if total != entry.size {
            return Err(LockedError::Invalid);
        }
    }
    if used.len() != chunks.len() {
        return Err(LockedError::Invalid);
    }
    Ok(())
}

/// The four fixed outer entries or one `chunks/<uuid>.age`. Anything else,
/// including any path separator, dot segment or case variant, is refused.
pub fn outer_entry_kind(name: &str) -> Option<OuterEntryKind> {
    match name {
        "header.json" => return Some(OuterEntryKind::Header),
        "keyslots/password.age" => return Some(OuterEntryKind::PasswordSlot),
        "keyslots/recovery.age" => return Some(OuterEntryKind::RecoverySlot),
        "index.age" => return Some(OuterEntryKind::Index),
        _ => {}
    }
    let rest = name.strip_prefix("chunks/")?;
    let id = rest.strip_suffix(".age")?;
    if id.len() != 36 || id != id.to_ascii_lowercase() {
        return None;
    }
    let parsed = Uuid::parse_str(id).ok()?;
    (parsed.to_string() == id && !parsed.is_nil()).then_some(OuterEntryKind::Chunk(parsed))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OuterEntryKind {
    Header,
    PasswordSlot,
    RecoverySlot,
    Index,
    Chunk(Uuid),
}

pub fn chunk_name(id: Uuid) -> String {
    format!("chunks/{id}.age")
}

pub fn validate_outer_names(names: &[String], header: &LockedHeader) -> LockedResult<Vec<Uuid>> {
    if names.len() < 4 || names.len() > crate::limits::MAX_OUTER_ENTRIES {
        return Err(LockedError::TooLarge);
    }
    let mut exact = HashSet::new();
    let mut folded = HashSet::new();
    let mut chunk_ids = Vec::new();
    for name in names {
        if !exact.insert(name.clone()) || !folded.insert(name.to_lowercase()) {
            return Err(LockedError::Invalid);
        }
        match outer_entry_kind(name) {
            Some(OuterEntryKind::Chunk(id)) => chunk_ids.push(id),
            Some(_) => {}
            None => return Err(LockedError::Invalid),
        }
    }
    if chunk_ids.len() != header.chunk_count as usize {
        return Err(LockedError::Invalid);
    }
    Ok(chunk_ids)
}

/// Test helper: the visible relative path of an entry, using only the
/// already validated parent links.
pub fn relative_path(index: &LockedIndex, entry: &LockedEntry) -> LockedResult<String> {
    let by_id: HashMap<Uuid, &LockedEntry> =
        index.entries.iter().map(|item| (item.id, item)).collect();
    let mut parts = Vec::new();
    let mut current = Some(entry.id);
    let mut seen = HashSet::new();
    while let Some(id) = current {
        if !seen.insert(id) {
            return Err(LockedError::Invalid);
        }
        let item = by_id.get(&id).ok_or(LockedError::Invalid)?;
        parts.push(item.name.clone());
        current = item.parent_id;
    }
    parts.reverse();
    Ok(parts.join("\\"))
}

pub fn path_is_inside_directory(child: &Path, parent: &Path) -> bool {
    let Ok(child) = child.canonicalize() else {
        return false;
    };
    let Ok(parent) = parent.canonicalize() else {
        return false;
    };
    child.starts_with(&parent)
}
