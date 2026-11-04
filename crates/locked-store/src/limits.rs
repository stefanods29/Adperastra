//! Fixed bounds for locked containers (Step 09k D3-D7). Every parser and
//! writer checks these before allocating or reading anything the user did
//! not explicitly open. Tests inject smaller values through [`Limits`].

/// The only outer container schema this build reads or writes.
pub const CONTAINER_SCHEMA_VERSION: u32 = 1;
/// The only key-slot and recovery-file schema.
pub const KEYS_SLOT_SCHEMA_VERSION: u32 = 1;
pub const RECOVERY_FILE_SCHEMA_VERSION: u32 = 1;

/// Plain header table, before any age processing.
pub const MAX_HEADER_BYTES: u64 = 64 * 1024;
/// Encrypted index plaintext.
pub const MAX_INDEX_PLAIN_BYTES: u64 = 64 * 1024 * 1024;
/// Encrypted index ciphertext (age framing is a few bytes per 64 KiB).
pub const MAX_INDEX_CIPHER_BYTES: u64 = MAX_INDEX_PLAIN_BYTES + 1024 * 1024;
/// One chunk of plaintext.
pub const MAX_CHUNK_PLAIN_BYTES: u64 = 8 * 1024 * 1024;
/// One encrypted chunk, including the age header and final tag.
pub const MAX_CHUNK_CIPHER_BYTES: u64 = 9 * 1024 * 1024;
/// A key slot (age scrypt or X25519 file holding a small JSON record).
pub const MAX_KEY_SLOT_BYTES: u64 = 1024 * 1024;
/// A recovery key file is a small UTF-8 JSON record.
pub const MAX_RECOVERY_FILE_BYTES: u64 = 16 * 1024;

/// Four fixed entries plus one per chunk.
pub const MAX_OUTER_ENTRIES: usize = 1_000_004;
pub const MAX_INDEX_ENTRIES: usize = 100_000;
pub const MAX_INDEX_CHUNKS: usize = 1_000_000;

pub const MAX_NAME_UTF16: usize = 255;
pub const MAX_RELATIVE_PATH_UTF16: usize = 32_768;
pub const MAX_DEPTH: usize = 128;
pub const MAX_MIME_CHARS: usize = 128;
pub const MAX_RECIPIENT_CHARS: usize = 128;

pub const MAX_FILE_BYTES: u64 = 1024 * 1024 * 1024 * 1024; // 1 TiB
pub const MAX_CONTAINER_BYTES: u64 = 4 * 1024 * 1024 * 1024 * 1024; // 4 TiB
pub const MAX_EDITABLE_ENTRY_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_OPEN_ENTRY_MEMORY: u64 = 256 * 1024 * 1024;
pub const MAX_GLOBAL_OPEN_MEMORY: u64 = 1024 * 1024 * 1024;

pub const MIN_PASSWORD_SCALARS: usize = 12;
pub const MAX_PASSWORD_BYTES: usize = 1024;

/// scrypt work factor `log_n` fixed for every new slot.
pub const SCRYPT_WORK_FACTOR: u8 = 18;
/// The highest work factor this build agrees to evaluate.
pub const SCRYPT_MAX_WORK_FACTOR: u8 = 18;
/// One KDF at a time; the helper budget.
pub const KDF_MEMORY_BYTES: u64 = 768 * 1024 * 1024;
pub const KDF_TIMEOUT_SECS: u64 = 30;

pub const MAX_PENDING_GENERATION_BYTES: u64 = 2 * 1024 * 1024 * 1024;
pub const MAX_PENDING_STORE_BYTES: u64 = 4 * 1024 * 1024 * 1024;
pub const MAX_RECOVERY_REVISIONS: usize = 32;

/// The largest range one `readLockedEntry` call accepts at its wrapper.
pub const MAX_READ_RANGE: u64 = 8 * 1024 * 1024;
/// The protocol's existing maximum for one range request.
pub const MAX_PROTOCOL_RANGE: u64 = 4 * 1024 * 1024;
/// Interactive bad-password attempts before the delay.
pub const MAX_INTERACTIVE_FAILURES: u32 = 3;
pub const FAILURE_DELAY_MS: u64 = 5_000;

/// How long a lock waits for protocol reads that already hold a grant.
pub const LOCK_READ_GRACE: std::time::Duration = std::time::Duration::from_secs(2);

/// Seconds since the Unix epoch.
pub fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|age| age.as_secs())
        .unwrap_or(0)
}

/// Limits a test can lower. Production always uses [`Limits::default`].
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub max_header_bytes: u64,
    pub max_index_plain_bytes: u64,
    pub max_index_cipher_bytes: u64,
    pub max_chunk_plain_bytes: u64,
    pub max_chunk_cipher_bytes: u64,
    pub max_key_slot_bytes: u64,
    pub max_outer_entries: usize,
    pub max_index_entries: usize,
    pub max_index_chunks: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_header_bytes: MAX_HEADER_BYTES,
            max_index_plain_bytes: MAX_INDEX_PLAIN_BYTES,
            max_index_cipher_bytes: MAX_INDEX_CIPHER_BYTES,
            max_chunk_plain_bytes: MAX_CHUNK_PLAIN_BYTES,
            max_chunk_cipher_bytes: MAX_CHUNK_CIPHER_BYTES,
            max_key_slot_bytes: MAX_KEY_SLOT_BYTES,
            max_outer_entries: MAX_OUTER_ENTRIES,
            max_index_entries: MAX_INDEX_ENTRIES,
            max_index_chunks: MAX_INDEX_CHUNKS,
        }
    }
}
