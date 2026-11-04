//! Signed-catalog validation: sizes, names, URLs, hashes and the dependency
//! DAG. Everything here runs before a catalog or archive may be written.

use std::collections::{HashMap, HashSet};

use sha2::{Digest, Sha256};

use crate::error::{PackError, PackResult};
use crate::types::{
    is_safe_integer, PackCatalog, PackDescriptor, PackFile, PackId, MAX_ALLOWED_ORIGINS,
    MAX_CATALOG_PACKS, MAX_PACK_DEPENDENCIES, MAX_PACK_ENABLES, MAX_PACK_FILES, MAX_PACK_KEY_CHARS,
    MAX_PACK_LICENSES, MAX_PACK_PATH_UNITS, MAX_PACK_SOURCES,
};

/// Test-only relaxations. Production callers use [`CatalogPolicy::production`].
#[derive(Debug, Clone, Copy, Default)]
pub struct CatalogPolicy {
    /// Allows `test_fixture` in an injected test catalog.
    pub allow_test_fixture: bool,
    /// Allows a loopback HTTPS download fixture inside tests only.
    pub allow_test_loopback: bool,
}

impl CatalogPolicy {
    /// The policy every installed build uses.
    pub fn production() -> Self {
        Self::default()
    }
}

/// The most extra bytes an archive may unpack beyond the declared install
/// size before extraction refuses it (Step 12a D4).
pub const INSTALL_SLACK_BYTES: u64 = 64 * 1024 * 1024;
/// The largest total an archive may unpack (Step 12a D4).
pub const MAX_INSTALLED_BYTES: u64 = 8 * 1024 * 1024 * 1024;
/// The highest decompression ratio one entry may have (Step 12a D4).
pub const MAX_ENTRY_RATIO: u64 = 1_000;

/// SHA-256 as 64 lowercase hexadecimal characters.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut text = String::with_capacity(64);
    for byte in digest {
        use std::fmt::Write;
        let _ = write!(text, "{byte:02x}");
    }
    text
}

/// True for exactly 64 lowercase hexadecimal characters.
pub fn is_sha256_hex(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Rejects placeholder hashes: a real artifact is never all zeros.
pub fn validate_artifact_hash(value: &str) -> PackResult<()> {
    if !is_sha256_hex(value) || value.bytes().all(|byte| byte == b'0') {
        return Err(PackError::BadRequest);
    }
    Ok(())
}

/// A bounded ASCII semantic version (`major.minor.patch`, optional
/// pre-release and build parts). This is deliberately stricter than a free
/// string so dependency matching stays exact.
pub fn is_valid_semver(text: &str) -> bool {
    if text.is_empty() || text.len() > 64 || !text.is_ascii() {
        return false;
    }
    let (without_build, build) = match text.split_once('+') {
        Some((left, right)) => {
            if right.is_empty() || right.contains('+') {
                return false;
            }
            (left, Some(right))
        }
        None => (text, None),
    };
    if let Some(build) = build {
        if !valid_identifiers(build, false) {
            return false;
        }
    }
    let (core, pre) = match without_build.split_once('-') {
        Some((left, right)) => {
            if right.is_empty() {
                return false;
            }
            (left, Some(right))
        }
        None => (without_build, None),
    };
    if let Some(pre) = pre {
        if !valid_identifiers(pre, true) {
            return false;
        }
    }
    let parts: Vec<&str> = core.split('.').collect();
    if parts.len() != 3 {
        return false;
    }
    parts.iter().all(|part| numeric_identifier(part))
}

fn valid_identifiers(text: &str, reject_numeric_leading_zero: bool) -> bool {
    text.split('.').all(|identifier| {
        !identifier.is_empty()
            && identifier
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            && (!reject_numeric_leading_zero
                || !identifier.bytes().all(|byte| byte.is_ascii_digit())
                || numeric_identifier(identifier))
    })
}

fn numeric_identifier(text: &str) -> bool {
    !text.is_empty()
        && text.bytes().all(|byte| byte.is_ascii_digit())
        && (text == "0" || !text.starts_with('0'))
}

/// A relative installed path with forward slashes. Never absolute, never a
/// drive or alternate data stream, never `..`, never a reserved device name.
pub fn validate_relative_path(path: &str) -> PackResult<()> {
    if path.is_empty()
        || path.encode_utf16().count() > MAX_PACK_PATH_UNITS
        || path.starts_with('/')
        || path.contains('\\')
        || path.contains(':')
        || path.ends_with('/')
        || path.chars().any(|character| character.is_control())
    {
        return Err(PackError::BadRequest);
    }
    for component in path.split('/') {
        if component.is_empty() || component == "." || component == ".." {
            return Err(PackError::BadRequest);
        }
        if component.ends_with('.') || component.ends_with(' ') {
            return Err(PackError::BadRequest);
        }
        let stem = component
            .split_once('.')
            .map(|(stem, _)| stem)
            .unwrap_or(component)
            .trim_end_matches(['.', ' '])
            .to_ascii_uppercase();
        if matches!(
            stem.as_str(),
            "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
        ) || is_numbered_device(&stem, "COM")
            || is_numbered_device(&stem, "LPT")
        {
            return Err(PackError::BadRequest);
        }
    }
    Ok(())
}

fn is_numbered_device(stem: &str, prefix: &str) -> bool {
    stem.strip_prefix(prefix)
        .is_some_and(|rest| matches!(rest, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"))
}

pub use crate::url_policy::{is_local_address, normalize_https_origin, parse_https_url};

/// Validate one descriptor against the signed catalog context.
pub fn validate_descriptor(
    descriptor: &PackDescriptor,
    catalog: &PackCatalog,
    policy: CatalogPolicy,
) -> PackResult<()> {
    if descriptor.id == PackId::TestFixture && !policy.allow_test_fixture {
        return Err(PackError::BadRequest);
    }
    if !is_valid_semver(&descriptor.version)
        || descriptor.catalog_revision == 0
        || !valid_key(&descriptor.name_key)
        || !valid_key(&descriptor.description_key)
        || descriptor.download_bytes == 0
        || descriptor.install_bytes == 0
        || !is_safe_integer(descriptor.download_bytes)
        || !is_safe_integer(descriptor.install_bytes)
    {
        return Err(PackError::BadRequest);
    }
    validate_artifact_hash(&descriptor.sha256)?;
    validate_download_url(&descriptor.download_url, &catalog.allowed_origins, policy)?;
    if descriptor.licenses.is_empty()
        || descriptor.licenses.len() > MAX_PACK_LICENSES
        || descriptor
            .licenses
            .iter()
            .any(|license| license.trim().is_empty() || license.chars().count() > 64)
    {
        return Err(PackError::BadRequest);
    }
    if descriptor.source_urls.len() > MAX_PACK_SOURCES {
        return Err(PackError::BadRequest);
    }
    for source in &descriptor.source_urls {
        parse_https_url(source, policy.allow_test_loopback)?;
    }
    if descriptor.files.len() > MAX_PACK_FILES {
        return Err(PackError::BadRequest);
    }
    let mut paths = HashSet::new();
    for file in &descriptor.files {
        validate_pack_file(file)?;
        if !paths.insert(file.path.to_ascii_lowercase()) {
            return Err(PackError::BadRequest);
        }
    }
    let declared_total = descriptor
        .files
        .iter()
        .try_fold(0u64, |total, file| total.checked_add(file.size))
        .ok_or(PackError::BadRequest)?;
    if declared_total > install_limit(descriptor) {
        return Err(PackError::BadRequest);
    }
    if descriptor.dependencies.len() > MAX_PACK_DEPENDENCIES {
        return Err(PackError::BadRequest);
    }
    let mut dependency_ids = HashSet::new();
    for dependency in &descriptor.dependencies {
        if dependency.id == descriptor.id
            || !is_valid_semver(&dependency.version)
            || !dependency_ids.insert(dependency.id)
        {
            return Err(PackError::BadRequest);
        }
    }
    if descriptor.enables.len() > MAX_PACK_ENABLES {
        return Err(PackError::BadRequest);
    }
    let mut enabled = HashSet::new();
    for capability in &descriptor.enables {
        if !valid_key(capability) || !enabled.insert(capability.as_str()) {
            return Err(PackError::BadRequest);
        }
    }
    if descriptor.entrypoints.len() > MAX_PACK_ENABLES {
        return Err(PackError::BadRequest);
    }
    for (capability, path) in &descriptor.entrypoints {
        if !valid_key(capability) {
            return Err(PackError::BadRequest);
        }
        validate_relative_path(path)?;
        if !paths.contains(&path.to_ascii_lowercase()) {
            return Err(PackError::BadRequest);
        }
    }
    Ok(())
}

fn valid_key(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= MAX_PACK_KEY_CHARS
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
}

fn validate_pack_file(file: &PackFile) -> PackResult<()> {
    validate_relative_path(&file.path)?;
    if !is_safe_integer(file.size) {
        return Err(PackError::BadRequest);
    }
    validate_artifact_hash(&file.sha256)
}

/// Validate a complete signed catalog before it is ever written.
pub fn validate_catalog(catalog: &PackCatalog, policy: CatalogPolicy) -> PackResult<()> {
    if catalog.schema_version != 1 {
        return Err(PackError::UnsupportedSchema);
    }
    if catalog.revision == 0 || catalog.packs.len() > MAX_CATALOG_PACKS {
        return Err(PackError::BadRequest);
    }
    if catalog.allowed_origins.is_empty() || catalog.allowed_origins.len() > MAX_ALLOWED_ORIGINS {
        return Err(PackError::BadRequest);
    }
    let mut origins = HashSet::new();
    for origin in &catalog.allowed_origins {
        let normalized = normalize_https_origin(origin, policy.allow_test_loopback)?;
        if !origins.insert(normalized) {
            return Err(PackError::BadRequest);
        }
    }
    let mut identities = HashSet::new();
    for descriptor in &catalog.packs {
        validate_descriptor(descriptor, catalog, policy)?;
        if !identities.insert((descriptor.id, descriptor.version.clone())) {
            return Err(PackError::BadRequest);
        }
    }
    validate_dependency_graph(catalog)
}

/// Refuse a cycle in the signed dependency graph and refuse a dependency
/// whose exact id/version is not in the same catalog.
pub fn validate_dependency_graph(catalog: &PackCatalog) -> PackResult<()> {
    let nodes: HashSet<(PackId, &str)> = catalog
        .packs
        .iter()
        .map(|pack| (pack.id, pack.version.as_str()))
        .collect();
    let mut edges: HashMap<(PackId, &str), Vec<(PackId, &str)>> = HashMap::new();
    for pack in &catalog.packs {
        let mut next = Vec::new();
        for dependency in &pack.dependencies {
            let target = (dependency.id, dependency.version.as_str());
            if !nodes.contains(&target) {
                return Err(PackError::Unavailable);
            }
            next.push(target);
        }
        edges.insert((pack.id, pack.version.as_str()), next);
    }
    let mut visiting = HashSet::new();
    let mut done = HashSet::new();
    for node in nodes.iter() {
        if !done.contains(node) {
            visit(*node, &edges, &mut visiting, &mut done)?;
        }
    }
    Ok(())
}

fn visit<'a>(
    node: (PackId, &'a str),
    edges: &HashMap<(PackId, &'a str), Vec<(PackId, &'a str)>>,
    visiting: &mut HashSet<(PackId, &'a str)>,
    done: &mut HashSet<(PackId, &'a str)>,
) -> PackResult<()> {
    if visiting.contains(&node) {
        return Err(PackError::DependencyCycle);
    }
    if done.contains(&node) {
        return Ok(());
    }
    visiting.insert(node);
    if let Some(next) = edges.get(&node) {
        for target in next {
            visit(*target, edges, visiting, done)?;
        }
    }
    visiting.remove(&node);
    done.insert(node);
    Ok(())
}

/// A pack download URL must use HTTPS and an origin the signed catalog names.
pub fn validate_download_url(
    text: &str,
    allowed_origins: &[String],
    policy: CatalogPolicy,
) -> PackResult<()> {
    let url = parse_https_url(text, policy.allow_test_loopback)?;
    if url.path().is_empty() || url.path() == "/" {
        return Err(PackError::BadRequest);
    }
    let origin = url.origin().ascii_serialization();
    for allowed in allowed_origins {
        if normalize_https_origin(allowed, policy.allow_test_loopback)? == origin {
            return Ok(());
        }
    }
    Err(PackError::BadRequest)
}

/// Check that a descriptor's fixed capability points at an inventoried file.
/// The reserved Office read bridge additionally needs its signed protocol
/// marker; a bare executable or guessed method is not that bridge.
pub fn validate_capability(descriptor: &PackDescriptor, capability: &str) -> PackResult<()> {
    if !valid_key(capability) {
        return Err(PackError::BadRequest);
    }
    let Some(path) = descriptor.entrypoint(capability) else {
        return Err(PackError::CapabilityMissing);
    };
    validate_relative_path(path)?;
    if !descriptor
        .files
        .iter()
        .any(|file| file.path.eq_ignore_ascii_case(path))
    {
        return Err(PackError::CapabilityMissing);
    }
    if capability == "office_read_bridge"
        && (descriptor.id != PackId::Office
            || !descriptor
                .enables
                .iter()
                .any(|value| value == "office_read_v1"))
    {
        return Err(PackError::CapabilityMissing);
    }
    Ok(())
}

/// The most this archive may unpack: the declared install size plus the
/// fixed slack, never beyond the global cap.
pub fn install_limit(descriptor: &PackDescriptor) -> u64 {
    descriptor
        .install_bytes
        .saturating_add(INSTALL_SLACK_BYTES)
        .min(MAX_INSTALLED_BYTES)
}
