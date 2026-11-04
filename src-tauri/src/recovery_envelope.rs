//! The authenticated envelope of one recovery record (Step 09h decision 6).
//!
//! Layout: `ADPREC1`, version, record UUID, metadata cipher length (u32),
//! content cipher length (u64), then exactly two DPAPI blobs. Inside the
//! protected metadata and before the protected encoded bytes, the record,
//! document, revision, content identity, length and SHA-256 are repeated so
//! a swapped blob, a truncated file or a mixed pair is refused.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::document_types::DocumentRef;
use crate::recovery_types::{
    source_path, RecoveryMetadata, CONTENT_PREFIX_LEN, DPAPI_OVERHEAD, ENVELOPE_HEADER_LEN,
    ENVELOPE_MAGIC, ENVELOPE_VERSION, MAX_METADATA_BYTES, MAX_RECORD_BYTES, RECOVERY_VERSION,
};

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

pub fn is_sha256_hex(text: &str) -> bool {
    text.len() == 64 && text.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

/// The metadata plaintext: public identity plus both content hashes.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthenticatedMetadata {
    pub version: u32,
    pub record_id: Uuid,
    pub document_id: Uuid,
    pub revision: u64,
    pub content_id: Uuid,
    pub captured_unix: u64,
    pub source: DocumentRef,
    #[serde(default)]
    pub source_stamp: Option<fs_service::SourceStamp>,
    #[serde(default)]
    pub original_path: Option<String>,
    pub name: String,
    pub mime: String,
    pub handler_id: String,
    pub from_internet: bool,
    pub sensitive: bool,
    pub encoded_len: u64,
    pub plaintext_sha256: String,
    pub ciphertext_sha256: String,
}

impl AuthenticatedMetadata {
    pub fn from_metadata(
        metadata: &RecoveryMetadata,
        plaintext_sha256: String,
        ciphertext_sha256: String,
    ) -> Self {
        Self {
            version: RECOVERY_VERSION,
            record_id: metadata.record_id,
            document_id: metadata.document_id,
            revision: metadata.captured_revision,
            content_id: metadata.content_id,
            captured_unix: metadata.captured_unix,
            source: metadata.source.clone(),
            source_stamp: metadata.source_stamp.clone(),
            original_path: source_path(&metadata.source),
            name: metadata.name.clone(),
            mime: metadata.mime.clone(),
            handler_id: metadata.handler_id.clone(),
            from_internet: metadata.from_internet,
            sensitive: metadata.sensitive,
            encoded_len: metadata.byte_len,
            plaintext_sha256,
            ciphertext_sha256,
        }
    }

    /// Check every repeated identity against the caller's metadata. A blob
    /// that belongs to another record, revision, length or source is refused.
    pub fn matches(&self, metadata: &RecoveryMetadata) -> bool {
        self.version == RECOVERY_VERSION
            && self.record_id == metadata.record_id
            && self.document_id == metadata.document_id
            && self.revision == metadata.captured_revision
            && self.content_id == metadata.content_id
            && self.captured_unix == metadata.captured_unix
            && self.name == metadata.name
            && self.mime == metadata.mime
            && self.handler_id == metadata.handler_id
            && self.from_internet == metadata.from_internet
            && self.sensitive == metadata.sensitive
            && self.encoded_len == metadata.byte_len
            && self.original_path == source_path(&metadata.source)
            && same_json(&self.source, &metadata.source)
            && same_json(&self.source_stamp, &metadata.source_stamp)
            && is_sha256_hex(&self.plaintext_sha256)
            && is_sha256_hex(&self.ciphertext_sha256)
    }
}

fn same_json<T: Serialize>(left: &T, right: &T) -> bool {
    match (serde_json::to_value(left), serde_json::to_value(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

/// One parsed envelope; lengths were checked before any allocation.
#[derive(Debug, Clone)]
pub struct EnvelopeParts {
    pub record_id: Uuid,
    pub metadata_cipher: Vec<u8>,
    pub content_cipher: Vec<u8>,
}

/// The identity and the two declared lengths of an envelope header. Both
/// the whole-file parser and the metadata-only listing use these checks.
#[derive(Debug, Clone, Copy)]
pub struct EnvelopeLengths {
    pub record_id: Uuid,
    pub metadata_len: u64,
    pub content_len: u64,
}

pub fn build_envelope(record_id: Uuid, metadata_cipher: &[u8], content_cipher: &[u8]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(ENVELOPE_HEADER_LEN + metadata_cipher.len() + content_cipher.len());
    bytes.extend_from_slice(ENVELOPE_MAGIC);
    bytes.extend_from_slice(&ENVELOPE_VERSION.to_le_bytes());
    bytes.extend_from_slice(record_id.as_bytes());
    bytes.extend_from_slice(&(metadata_cipher.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&(content_cipher.len() as u64).to_le_bytes());
    bytes.extend_from_slice(metadata_cipher);
    bytes.extend_from_slice(content_cipher);
    bytes
}

/// Parse and bound the fixed header. A newer version is unsupported, never
/// overwritten; a zero or oversized length is corrupt before allocation.
pub fn parse_envelope_header(header: &[u8]) -> Result<EnvelopeLengths, String> {
    if header.len() < ENVELOPE_HEADER_LEN || &header[..7] != ENVELOPE_MAGIC {
        return Err("recovery.corrupt".to_string());
    }
    let version = u32::from_le_bytes(
        header[7..11]
            .try_into()
            .map_err(|_| "recovery.corrupt".to_string())?,
    );
    if version > ENVELOPE_VERSION {
        return Err("recovery.unsupported".to_string());
    }
    if version != ENVELOPE_VERSION {
        return Err("recovery.corrupt".to_string());
    }
    let record_id =
        Uuid::from_slice(&header[11..27]).map_err(|_| "recovery.corrupt".to_string())?;
    let metadata_len = u32::from_le_bytes(
        header[27..31]
            .try_into()
            .map_err(|_| "recovery.corrupt".to_string())?,
    ) as u64;
    let content_len = u64::from_le_bytes(
        header[31..39]
            .try_into()
            .map_err(|_| "recovery.corrupt".to_string())?,
    );
    if metadata_len == 0
        || metadata_len > MAX_METADATA_BYTES as u64 + DPAPI_OVERHEAD
        || content_len == 0
        || content_len > MAX_RECORD_BYTES + CONTENT_PREFIX_LEN as u64 + DPAPI_OVERHEAD
    {
        return Err("recovery.corrupt".to_string());
    }
    Ok(EnvelopeLengths {
        record_id,
        metadata_len,
        content_len,
    })
}

/// The whole file must be exactly the header plus the two declared blobs.
/// Trailing and truncated bytes are refused.
pub fn check_envelope_size(lengths: &EnvelopeLengths, total: u64) -> Result<(), String> {
    let expected = (ENVELOPE_HEADER_LEN as u64)
        .saturating_add(lengths.metadata_len)
        .saturating_add(lengths.content_len);
    if expected != total {
        return Err("recovery.corrupt".to_string());
    }
    Ok(())
}

/// Parse one whole envelope. Trailing bytes, an unknown newer version and
/// out-of-bounds lengths are refused; nothing is allocated from the header
/// until its length is compared with the actual file size.
pub fn parse_envelope(bytes: &[u8]) -> Result<EnvelopeParts, String> {
    let lengths = parse_envelope_header(bytes)?;
    check_envelope_size(&lengths, bytes.len() as u64)?;
    let metadata_end = ENVELOPE_HEADER_LEN + lengths.metadata_len as usize;
    Ok(EnvelopeParts {
        record_id: lengths.record_id,
        metadata_cipher: bytes[ENVELOPE_HEADER_LEN..metadata_end].to_vec(),
        content_cipher: bytes[metadata_end..].to_vec(),
    })
}

/// Build the protected content: an authenticated prefix followed by the
/// exact encoded revision. The returned hash covers only the encoded bytes.
pub fn build_content_plaintext_with_hash(
    metadata: &RecoveryMetadata,
    encoded: &[u8],
) -> (Vec<u8>, String) {
    let mut hasher = Sha256::new();
    hasher.update(encoded);
    let digest = hasher.finalize();
    let plaintext_sha256 = hex::encode(digest);
    let mut bytes = Vec::with_capacity(CONTENT_PREFIX_LEN + encoded.len());
    bytes.extend_from_slice(metadata.record_id.as_bytes());
    bytes.extend_from_slice(metadata.document_id.as_bytes());
    bytes.extend_from_slice(&metadata.captured_revision.to_le_bytes());
    bytes.extend_from_slice(metadata.content_id.as_bytes());
    bytes.extend_from_slice(&metadata.byte_len.to_le_bytes());
    bytes.extend_from_slice(digest.as_slice());
    bytes.extend_from_slice(encoded);
    (bytes, plaintext_sha256)
}

/// Build the protected content without returning the plaintext hash.
pub fn build_content_plaintext(metadata: &RecoveryMetadata, encoded: &[u8]) -> Vec<u8> {
    build_content_plaintext_with_hash(metadata, encoded).0
}

pub struct ContentParts<'a> {
    pub record_id: Uuid,
    pub document_id: Uuid,
    pub revision: u64,
    pub content_id: Uuid,
    pub byte_len: u64,
    pub plaintext_sha256: String,
    pub encoded: &'a [u8],
}

impl std::fmt::Debug for ContentParts<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ContentParts")
            .field("record_id", &self.record_id)
            .field("document_id", &self.document_id)
            .field("revision", &self.revision)
            .field("content_id", &self.content_id)
            .field("byte_len", &self.byte_len)
            .field("encoded_len", &self.encoded.len())
            .finish()
    }
}

/// Parse the protected content. Every length is checked against the actual
/// buffer; the returned slice is the exact encoded revision, never a
/// remainder of another blob.
pub fn parse_content_plaintext(bytes: &[u8]) -> Result<ContentParts<'_>, String> {
    if bytes.len() < CONTENT_PREFIX_LEN {
        return Err("recovery.corrupt".to_string());
    }
    let record_id = Uuid::from_slice(&bytes[0..16]).map_err(|_| "recovery.corrupt".to_string())?;
    let document_id = Uuid::from_slice(&bytes[16..32]).map_err(|_| "recovery.corrupt".to_string())?;
    let revision = u64::from_le_bytes(bytes[32..40].try_into().map_err(|_| "recovery.corrupt".to_string())?);
    let content_id = Uuid::from_slice(&bytes[40..56]).map_err(|_| "recovery.corrupt".to_string())?;
    let byte_len = u64::from_le_bytes(bytes[56..64].try_into().map_err(|_| "recovery.corrupt".to_string())?);
    if byte_len > MAX_RECORD_BYTES {
        return Err("recovery.corrupt".to_string());
    }
    let encoded = &bytes[CONTENT_PREFIX_LEN..];
    let hash = sha256_hex(encoded);
    if encoded.len() as u64 != byte_len || hash != hex::encode(&bytes[64..96]) {
        return Err("recovery.corrupt".to_string());
    }
    Ok(ContentParts {
        record_id,
        document_id,
        revision,
        content_id,
        byte_len,
        plaintext_sha256: hash,
        encoded,
    })
}

/// Parse the protected content and bind every repeated identity to the
/// caller's metadata. A swapped record, document, revision, content id or
/// length is corrupt even when the encoded bytes and their hash are intact.
pub fn parse_content_plaintext_bound<'a>(
    metadata: &RecoveryMetadata,
    bytes: &'a [u8],
) -> Result<ContentParts<'a>, String> {
    let parts = parse_content_plaintext(bytes)?;
    if parts.record_id != metadata.record_id
        || parts.document_id != metadata.document_id
        || parts.revision != metadata.captured_revision
        || parts.content_id != metadata.content_id
        || parts.byte_len != metadata.byte_len
    {
        return Err("recovery.corrupt".to_string());
    }
    Ok(parts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::recovery_types::MAX_RECORD_BYTES;

    fn metadata(byte_len: u64) -> RecoveryMetadata {
        RecoveryMetadata {
            version: 1,
            record_id: Uuid::new_v4(),
            document_id: Uuid::new_v4(),
            source: crate::recovery_types::disk_source("C:\\Work\\notes.txt").unwrap(),
            source_stamp: None,
            name: "notes.txt".to_string(),
            mime: "text/plain".to_string(),
            handler_id: "text".to_string(),
            captured_revision: 2,
            content_id: Uuid::new_v4(),
            captured_unix: 1_700_000_000,
            byte_len,
            from_internet: false,
            sensitive: false,
        }
    }

    #[test]
    fn the_prefix_binds_every_identity_and_hash() {
        let metadata = metadata(5);
        let plain = build_content_plaintext(&metadata, b"hello");
        let parts = parse_content_plaintext_bound(&metadata, &plain).unwrap();
        assert_eq!(parts.record_id, metadata.record_id);
        assert_eq!(parts.document_id, metadata.document_id);
        assert_eq!(parts.revision, 2);
        assert_eq!(parts.content_id, metadata.content_id);
        assert_eq!(parts.byte_len, 5);
        assert_eq!(parts.encoded, b"hello");

        let mut swapped = plain.clone();
        swapped[16] ^= 0xFF;
        assert_eq!(
            parse_content_plaintext_bound(&metadata, &swapped).unwrap_err(),
            "recovery.corrupt"
        );

        let mut changed = plain.clone();
        let last = changed.len() - 1;
        changed[last] ^= 0xFF;
        assert_eq!(
            parse_content_plaintext_bound(&metadata, &changed).unwrap_err(),
            "recovery.corrupt"
        );
    }

    #[test]
    fn an_envelope_refuses_trailing_and_truncated_bytes() {
        let record = Uuid::new_v4();
        let bytes = build_envelope(record, b"metadata", b"content");
        let parts = parse_envelope(&bytes).unwrap();
        assert_eq!(parts.record_id, record);
        assert_eq!(parts.metadata_cipher, b"metadata");
        assert_eq!(parts.content_cipher, b"content");

        let mut trailing = bytes.clone();
        trailing.push(0);
        assert_eq!(parse_envelope(&trailing).unwrap_err(), "recovery.corrupt");
        assert_eq!(
            parse_envelope(&bytes[..bytes.len() - 1]).unwrap_err(),
            "recovery.corrupt"
        );
    }

    #[test]
    fn a_newer_envelope_version_is_unsupported_not_overwritten() {
        let record = Uuid::new_v4();
        let mut bytes = build_envelope(record, b"m", b"c");
        bytes[7..11].copy_from_slice(&2u32.to_le_bytes());
        assert_eq!(parse_envelope(&bytes).unwrap_err(), "recovery.unsupported");
    }

    #[test]
    fn the_prefix_carries_the_plaintext_hash() {
        let metadata = metadata(5);
        let (plain, hash) = build_content_plaintext_with_hash(&metadata, b"hello");
        assert_eq!(hash, sha256_hex(b"hello"));
        assert_eq!(plain.len(), CONTENT_PREFIX_LEN + 5);
        assert_eq!(&plain[CONTENT_PREFIX_LEN..], b"hello");
        assert_eq!(build_content_plaintext(&metadata, b"hello"), plain);
    }

    #[test]
    fn metadata_must_match_every_repeated_field() {
        let metadata = metadata(4);
        let ciphertext_hash = sha256_hex(b"cipher");
        let plaintext_hash = sha256_hex(b"data");
        let authenticated =
            AuthenticatedMetadata::from_metadata(&metadata, plaintext_hash.clone(), ciphertext_hash.clone());
        assert!(authenticated.matches(&metadata));

        let mut other = metadata.clone();
        other.captured_revision += 1;
        assert!(!authenticated.matches(&other));

        let mut other = metadata.clone();
        other.name = "other.txt".to_string();
        assert!(!authenticated.matches(&other));

        let mut other = metadata.clone();
        other.source = crate::recovery_types::disk_source("C:\\Work\\other.txt").unwrap();
        assert!(!authenticated.matches(&other));

        let mut other = metadata.clone();
        other.source_stamp = Some(fs_service::SourceStamp {
            path_key: "c:\\work\\notes.txt".to_string(),
            volume_id: "00000000".to_string(),
            file_id: "0000000000000000".to_string(),
            modified_ticks: "1".to_string(),
            size_bytes: 1,
        });
        assert!(!authenticated.matches(&other));

        let mut forged = authenticated.clone();
        forged.ciphertext_sha256 = "not a hash".to_string();
        assert!(!forged.matches(&metadata));

        let mut forged = authenticated.clone();
        forged.plaintext_sha256 = "NOTLOWERHEX".to_string();
        assert!(!forged.matches(&metadata));
    }

    #[test]
    fn a_record_beyond_the_cap_cannot_have_a_prefix() {
        let mut metadata = metadata(MAX_RECORD_BYTES + 1);
        metadata.byte_len = MAX_RECORD_BYTES + 1;
        let bytes = build_content_plaintext(&metadata, b"");
        assert_eq!(parse_content_plaintext(&bytes).unwrap_err(), "recovery.corrupt");
    }
}
