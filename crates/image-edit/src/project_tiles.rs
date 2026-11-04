//! Bounded zstd tile payloads for editable image projects (Step 18b D6).
//!
//! A tile is at most 256x256: 262,144 decoded bytes for RGBA and 65,536 for
//! an alpha mask. The decoder trusts the manifest's declared raw length only
//! as a cap: it stops one byte past that length, so a crafted stream that
//! expands further is refused before the caller allocates or publishes it.

use crate::project::ProjectError;
use std::io::Read;

/// Largest decoded tile payload (256 x 256 x 4).
pub const MAX_TILE_RAW_BYTES: u64 = 256 * 256 * 4;
/// A zstd frame of stored data is only a few bytes larger than its input.
pub const MAX_TILE_COMPRESSED_BYTES: u64 = 2 * 256 * 1024 + 64 * 1024;
const ZSTD_LEVEL: i32 = 3;

pub fn compress_tile(raw: &[u8]) -> Result<Vec<u8>, ProjectError> {
    if raw.len() as u64 > MAX_TILE_RAW_BYTES {
        return Err(ProjectError::TooLarge);
    }
    let compressed = zstd::stream::encode_all(raw, ZSTD_LEVEL).map_err(|_| ProjectError::Failed)?;
    if compressed.len() as u64 > MAX_TILE_COMPRESSED_BYTES {
        return Err(ProjectError::TooLarge);
    }
    Ok(compressed)
}

/// Decodes exactly `expected` bytes. Any shorter or longer result is refused;
/// the extra byte in the limit makes an overlong stream observable.
pub fn decompress_tile(compressed: &[u8], expected: u64) -> Result<Vec<u8>, ProjectError> {
    if expected > MAX_TILE_RAW_BYTES {
        return Err(ProjectError::TooLarge);
    }
    if compressed.is_empty() || compressed.len() as u64 > MAX_TILE_COMPRESSED_BYTES {
        return Err(ProjectError::TooLarge);
    }
    let decoder =
        zstd::stream::read::Decoder::new(compressed).map_err(|_| ProjectError::Corrupt)?;
    let mut limited = decoder.take(expected.saturating_add(1));
    let mut output = Vec::with_capacity(expected as usize);
    limited
        .read_to_end(&mut output)
        .map_err(|_| ProjectError::Corrupt)?;
    if output.len() as u64 > expected {
        return Err(ProjectError::TooLarge);
    }
    if output.len() as u64 != expected {
        return Err(ProjectError::Corrupt);
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrips_and_refuses_an_overlong_stream() {
        let raw = vec![7u8; 16];
        let compressed = compress_tile(&raw).expect("compress");
        assert_eq!(decompress_tile(&compressed, 16).expect("decode"), raw);
        assert_eq!(
            decompress_tile(&compressed, 15),
            Err(ProjectError::TooLarge)
        );
        assert_eq!(decompress_tile(&compressed, 17), Err(ProjectError::Corrupt));
    }
}
