//! Detached-minisign catalog verification. The exact catalog bytes are
//! verified *before* any JSON parser sees them; a newer schema is retained,
//! never overwritten by an older app.

use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};

use crate::error::{map_io, PackError, PackResult};
use crate::types::PackCatalog;
use crate::validation::{validate_catalog, CatalogPolicy};

/// The largest catalog the app will read (Step 12a D1).
pub const MAX_CATALOG_BYTES: u64 = 1024 * 1024;
/// The largest detached signature box the app will read.
pub const MAX_SIGNATURE_BYTES: u64 = 8 * 1024;
/// The catalog file name inside the catalog directory.
pub const CATALOG_FILE: &str = "pack-catalog.json";
/// The detached signature file name.
pub const CATALOG_SIGNATURE_FILE: &str = "pack-catalog.minisig";

/// The trusted public key supplied by setup/build configuration. Never a key
/// advertised by the downloaded catalog.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogTrust {
    public_key_b64: String,
}

impl CatalogTrust {
    pub fn new(public_key_b64: impl Into<String>) -> Self {
        Self {
            public_key_b64: public_key_b64.into(),
        }
    }

    /// Verify the detached signature over the exact UTF-8 bytes.
    pub fn verify(&self, bytes: &[u8], signature_box: &str) -> PackResult<()> {
        if self.public_key_b64.trim().is_empty()
            || signature_box.trim().is_empty()
            || bytes.is_empty()
            || bytes.len() as u64 > MAX_CATALOG_BYTES
            || signature_box.len() as u64 > MAX_SIGNATURE_BYTES
        {
            return Err(PackError::BadSignature);
        }
        let public_key = parse_public_key(&self.public_key_b64)?;
        let boxed = minisign::SignatureBox::from_string(signature_box.trim())
            .map_err(|_| PackError::BadSignature)?;
        minisign::verify(&public_key, &boxed, Cursor::new(bytes), true, false, false)
            .map_err(|_| PackError::BadSignature)
    }
}

fn parse_public_key(text: &str) -> PackResult<minisign::PublicKey> {
    let trimmed = text.trim();
    if trimmed.contains('\n') {
        minisign::PublicKeyBox::from_string(trimmed)
            .and_then(|boxed| boxed.into_public_key())
            .map_err(|_| PackError::BadSignature)
    } else {
        minisign::PublicKey::from_base64(trimmed).map_err(|_| PackError::BadSignature)
    }
}

/// Verify first, then hand the verified bytes to `parse`. The callback is
/// never called when the signature does not match.
pub fn verify_and_parse<F>(
    bytes: &[u8],
    signature_box: &str,
    trust: &CatalogTrust,
    parse: F,
) -> PackResult<PackCatalog>
where
    F: FnOnce(&[u8]) -> PackResult<PackCatalog>,
{
    trust.verify(bytes, signature_box)?;
    let catalog = parse(bytes)?;
    Ok(catalog)
}

/// Verify, parse and validate a complete catalog.
pub fn parse_catalog_verified(
    bytes: &[u8],
    signature_box: &str,
    trust: &CatalogTrust,
    policy: CatalogPolicy,
) -> PackResult<PackCatalog> {
    let catalog = verify_and_parse(bytes, signature_box, trust, |verified| {
        serde_json::from_slice::<PackCatalog>(verified).map_err(|_| PackError::BadRequest)
    })?;
    validate_catalog(&catalog, policy)?;
    Ok(catalog)
}

/// Read at most `max` bytes; a larger file is refused instead of truncated.
pub fn read_bounded(path: &Path, max: u64) -> PackResult<Vec<u8>> {
    let file = std::fs::File::open(path).map_err(|error| map_io(&error))?;
    let mut bytes = Vec::new();
    file.take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| map_io(&error))?;
    if bytes.len() as u64 > max {
        return Err(PackError::BadRequest);
    }
    Ok(bytes)
}

/// Reads and writes the two catalog files under `<packs>/catalog`.
#[derive(Debug, Clone)]
pub struct CatalogStore {
    directory: PathBuf,
}

impl CatalogStore {
    pub fn new(packs_root: &Path) -> Self {
        Self {
            directory: packs_root.join("catalog"),
        }
    }

    pub fn directory(&self) -> &Path {
        &self.directory
    }

    pub fn catalog_path(&self) -> PathBuf {
        self.directory.join(CATALOG_FILE)
    }

    pub fn signature_path(&self) -> PathBuf {
        self.directory.join(CATALOG_SIGNATURE_FILE)
    }

    /// The schema currently on disk, if the bytes are readable JSON.
    pub fn current_schema_version(&self) -> Option<u32> {
        let bytes = read_bounded(&self.catalog_path(), MAX_CATALOG_BYTES).ok()?;
        raw_schema_version(&bytes)
    }

    /// Load, verify and validate the stored catalog.
    pub fn load(&self, trust: &CatalogTrust, policy: CatalogPolicy) -> PackResult<PackCatalog> {
        let bytes = read_bounded(&self.catalog_path(), MAX_CATALOG_BYTES)?;
        let signature = read_bounded(&self.signature_path(), MAX_SIGNATURE_BYTES)?;
        let signature = String::from_utf8(signature).map_err(|_| PackError::BadSignature)?;
        trust.verify(&bytes, &signature)?;
        let schema = inspect_schema(&bytes)?;
        if schema != 1 {
            return Err(PackError::UnsupportedSchema);
        }
        let catalog =
            serde_json::from_slice::<PackCatalog>(&bytes).map_err(|_| PackError::BadRequest)?;
        validate_catalog(&catalog, policy)?;
        Ok(catalog)
    }

    /// Store a refreshed catalog only after signature, schema and content
    /// validation. A newer schema already on disk is never downgraded.
    pub fn store(
        &self,
        bytes: &[u8],
        signature_box: &str,
        trust: &CatalogTrust,
        policy: CatalogPolicy,
    ) -> PackResult<PackCatalog> {
        trust.verify(bytes, signature_box)?;
        if bytes.len() as u64 > MAX_CATALOG_BYTES
            || signature_box.len() as u64 > MAX_SIGNATURE_BYTES
        {
            return Err(PackError::BadRequest);
        }
        let schema = inspect_schema(bytes)?;
        if schema != 1 {
            return Err(PackError::UnsupportedSchema);
        }
        if self
            .current_schema_version()
            .is_some_and(|current| current > 1)
        {
            return Err(PackError::UnsupportedSchema);
        }
        let catalog =
            serde_json::from_slice::<PackCatalog>(bytes).map_err(|_| PackError::BadRequest)?;
        validate_catalog(&catalog, policy)?;
        std::fs::create_dir_all(&self.directory).map_err(|error| map_io(&error))?;
        // The signature is written first: a crash between the two renames
        // leaves a mismatched pair, which the next load refuses safely.
        write_atomic(&self.signature_path(), signature_box.trim().as_bytes())?;
        write_atomic(&self.catalog_path(), bytes)?;
        Ok(catalog)
    }
}

fn raw_schema_version(bytes: &[u8]) -> Option<u32> {
    let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    let schema = value.get("schema_version")?.as_u64()?;
    u32::try_from(schema).ok()
}

fn inspect_schema(bytes: &[u8]) -> PackResult<u32> {
    match raw_schema_version(bytes) {
        Some(1) => Ok(1),
        Some(_) => Err(PackError::UnsupportedSchema),
        None => Err(PackError::BadRequest),
    }
}

fn write_atomic(path: &Path, bytes: &[u8]) -> PackResult<()> {
    use std::io::Write;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(PackError::BadRequest)?;
    let temp = path.with_file_name(format!(".{name}-{}.partial", uuid::Uuid::new_v4()));
    let result = (|| -> PackResult<()> {
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(|error| map_io(&error))?;
        file.write_all(bytes).map_err(|error| map_io(&error))?;
        file.sync_all().map_err(|error| map_io(&error))?;
        drop(file);
        std::fs::rename(&temp, path).map_err(|error| map_io(&error))?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}
