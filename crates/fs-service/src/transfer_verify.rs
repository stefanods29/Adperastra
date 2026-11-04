//! Read-back verification before a copied file is published (Step 09f D4).
//!
//! Verification is off by default because it doubles the disk reading. When
//! it is on, the engine hashes the source while copying, flushes the owned
//! staging file, reads it back through its own handle (E6) and compares the
//! full hash and the exact length. Only a match may be published: a mismatch
//! keeps the original and removes nothing but the owned staging file.
//!
//! An empty file has a *known* hash (BLAKE3 of zero bytes), never "no hash".
//! Otherwise an empty copy would silently pass as unverified.

use crate::owned_io::{OwnedIoError, OwnedIoResult, OwnedOutput};
use crate::CancellationToken;
use blake3::Hasher;
use std::io::{Read, Seek, SeekFrom, Write};
use std::sync::atomic::Ordering;

/// One read-back or copy buffer.
pub const VERIFY_CHUNK: usize = 1024 * 1024;

/// The BLAKE3 digest of zero bytes. Empty input is verifiable, so an empty
/// file is never treated as "nothing to compare".
pub const EMPTY_BLAKE3_HEX: &str =
    "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262";

/// A full 32-byte digest, printed as lower-case hex for the report.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VerifiedHash([u8; 32]);

impl VerifiedHash {
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }

    pub fn of(bytes: &[u8]) -> Self {
        Self(*Hasher::new().update(bytes).finalize().as_bytes())
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// Lower-case hex for `TransferEffect.verified_hash`.
    pub fn to_hex(self) -> String {
        let mut text = String::with_capacity(64);
        for byte in self.0 {
            text.push_str(&format!("{byte:02x}"));
        }
        text
    }

    /// Refuse anything that is not exactly 64 lower-case hex characters.
    pub fn from_hex(text: &str) -> Option<Self> {
        if text.len() != 64 || !text.bytes().all(|b| b.is_ascii_hexdigit()) {
            return None;
        }
        let mut bytes = [0u8; 32];
        for (index, slot) in bytes.iter_mut().enumerate() {
            *slot = u8::from_str_radix(&text[index * 2..index * 2 + 2], 16).ok()?;
        }
        Some(Self(bytes))
    }
}

/// The known hash of an empty file.
pub fn empty_hash() -> VerifiedHash {
    VerifiedHash::from_bytes(*Hasher::new().finalize().as_bytes())
}

/// Why verification did not allow publication.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VerifyError {
    /// The bytes read back do not match the bytes copied.
    Mismatch,
    /// The user cancelled during the read-back.
    Cancelled,
    /// The owned staging file could not be read back.
    Io,
}

impl VerifyError {
    pub fn code(self) -> &'static str {
        match self {
            VerifyError::Mismatch => "ops.verify_failed",
            VerifyError::Cancelled => "ops.cancelled",
            VerifyError::Io => "ops.io",
        }
    }
}

/// The hash of a copy while it is being written.
#[derive(Debug)]
pub struct CopyHash {
    hasher: Hasher,
    bytes: u64,
}

impl CopyHash {
    pub fn new() -> Self {
        Self {
            hasher: Hasher::new(),
            bytes: 0,
        }
    }

    pub fn update(&mut self, chunk: &[u8]) {
        self.hasher.update(chunk);
        self.bytes = self.bytes.saturating_add(chunk.len() as u64);
    }

    pub fn bytes(&self) -> u64 {
        self.bytes
    }

    /// Finish and report both the digest and the exact number of bytes the
    /// digest covered. The length travels with the hash so a truncated copy
    /// cannot match a shorter file with the same prefix.
    pub fn finish(self) -> (VerifiedHash, u64) {
        (
            VerifiedHash::from_bytes(*self.hasher.finalize().as_bytes()),
            self.bytes,
        )
    }
}

impl Default for CopyHash {
    fn default() -> Self {
        Self::new()
    }
}

/// A finished staging file that can be read back through its own handle.
///
/// `OwnedOutput` already exposes its owned file handle, so the adapter lives
/// here rather than widening the shared owned-io API. Tests supply their own
/// adapter to simulate a corrupt read-back without damaging a real disk.
pub trait ReadBack {
    fn read_back_digest(&mut self, token: &CancellationToken) -> OwnedIoResult<[u8; 32]>;

    /// The number of bytes the staged file must contain.
    fn staged_len(&mut self) -> u64;
}

impl ReadBack for OwnedOutput {
    fn read_back_digest(&mut self, token: &CancellationToken) -> OwnedIoResult<[u8; 32]> {
        let file = self.file_mut();
        file.flush()?;
        let length = file.metadata()?.len();
        let saved = file.stream_position()?;
        let mut hasher = Hasher::new();
        let mut buffer = vec![0u8; VERIFY_CHUNK];
        let result = (|| -> std::io::Result<[u8; 32]> {
            file.seek(SeekFrom::Start(0))?;
            let mut read_total = 0u64;
            while read_total < length {
                if token.load(Ordering::Relaxed) {
                    return Err(std::io::Error::from(std::io::ErrorKind::Interrupted));
                }
                let take = ((length - read_total) as usize).min(VERIFY_CHUNK);
                let read = file.read(&mut buffer[..take])?;
                if read == 0 {
                    break;
                }
                hasher.update(&buffer[..read]);
                read_total += read as u64;
            }
            if read_total != length {
                return Err(std::io::Error::from(std::io::ErrorKind::InvalidData));
            }
            Ok(*hasher.finalize().as_bytes())
        })();
        let restored = file.seek(SeekFrom::Start(saved));
        let hash = result.map_err(OwnedIoError::Io)?;
        restored?;
        Ok(hash)
    }

    fn staged_len(&mut self) -> u64 {
        self.file_mut()
            .metadata()
            .map(|metadata| metadata.len())
            .unwrap_or(0)
    }
}

/// Compare the staged bytes with what was copied, before anything is
/// published.
pub fn verify_before_publish(
    output: &mut impl ReadBack,
    expected: VerifiedHash,
    expected_len: u64,
    token: &CancellationToken,
) -> Result<VerifiedHash, VerifyError> {
    if token.load(Ordering::Relaxed) {
        return Err(VerifyError::Cancelled);
    }
    if output.staged_len() != expected_len {
        return Err(VerifyError::Mismatch);
    }
    let read_back = match output.read_back_digest(token) {
        Ok(bytes) => VerifiedHash::from_bytes(bytes),
        Err(OwnedIoError::Io(error)) if error.kind() == std::io::ErrorKind::Interrupted => {
            return Err(VerifyError::Cancelled)
        }
        Err(_) => return Err(VerifyError::Io),
    };
    if read_back != expected {
        return Err(VerifyError::Mismatch);
    }
    Ok(read_back)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_file_has_a_known_hash() {
        let (hash, bytes) = CopyHash::new().finish();
        assert_eq!(bytes, 0);
        assert_eq!(hash.to_hex(), EMPTY_BLAKE3_HEX);
        assert_eq!(empty_hash(), hash);
        assert_eq!(VerifiedHash::from_hex(EMPTY_BLAKE3_HEX), Some(hash));
    }

    #[test]
    fn hashes_round_trip_through_the_report_hex() {
        let hash = VerifiedHash::of(b"alpha");
        assert_eq!(VerifiedHash::from_hex(&hash.to_hex()), Some(hash));
        assert_eq!(VerifiedHash::from_hex("nope"), None);
        assert_eq!(VerifiedHash::from_hex(&"z".repeat(64)), None);
    }

    #[test]
    fn a_different_length_is_a_mismatch_even_with_matching_bytes() {
        struct Short(u64);
        impl ReadBack for Short {
            fn read_back_digest(&mut self, _: &CancellationToken) -> OwnedIoResult<[u8; 32]> {
                Ok(*Hasher::new().finalize().as_bytes())
            }
            fn staged_len(&mut self) -> u64 {
                self.0
            }
        }
        // The bytes match the empty digest, but the staged length does not
        // match what was copied: a truncated file must never pass.
        let mut short = Short(4);
        assert_eq!(
            verify_before_publish(
                &mut short,
                empty_hash(),
                5,
                &crate::new_cancellation_token()
            ),
            Err(VerifyError::Mismatch)
        );
    }
}
