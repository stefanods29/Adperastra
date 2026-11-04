//! Deterministic release inventory (Step 08d T1/E6).
//!
//! The fixed public artifact names come from `installer/artifacts.json`, the
//! same file the release content checker reads. Records are produced only
//! after a build; no signing key or secret is read. The helper flag lets the
//! package script write and verify `release-manifest.json` and
//! `SHA256SUMS.txt` without a second implementation of the rules.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

use crate::release_version::ReleaseVersion;

/// Helper flag handled in `main()` before Tauri starts.
pub const HELPER_FLAG: &str = "--release-tool";
/// Generated record file in the release folder.
pub const MANIFEST_FILE: &str = "release-manifest.json";
/// Generated checksum list in the release folder.
pub const CHECKSUMS_FILE: &str = "SHA256SUMS.txt";
/// Fixed target of every v0.1 artifact.
pub const TARGET: &str = "windows-x86_64";
/// A release artifact is never larger than this (guards a wrong file).
pub const MAX_ARTIFACT_BYTES: u64 = 8 * 1024 * 1024 * 1024;

#[derive(Debug, Clone, Deserialize)]
struct ArtifactCatalog {
    schema: u32,
    target: String,
    names: Vec<String>,
    #[serde(default)]
    derived: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactRecord {
    pub name: String,
    pub sha256: String,
    pub byte_len: u64,
    pub source_commit: String,
    pub version: String,
    pub target: String,
    pub unsigned: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseManifest {
    pub schema: u32,
    pub records: Vec<ArtifactRecord>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReleaseBuildMetadata {
    pub version: String,
    pub source_commit: String,
    pub profile: String,
    #[serde(default)]
    pub debug_port: Option<u16>,
    #[serde(default)]
    pub signing_key_present: bool,
    #[serde(default)]
    pub model_files: u32,
}

fn catalog() -> Result<ArtifactCatalog, String> {
    let catalog: ArtifactCatalog =
        serde_json::from_str(include_str!("../../installer/artifacts.json"))
            .map_err(|_| "release.catalog_invalid".to_string())?;
    if catalog.schema != 1
        || catalog.target != TARGET
        || catalog.names.len() != 7
        || !catalog.derived.iter().any(|name| name == CHECKSUMS_FILE)
    {
        return Err("release.catalog_invalid".to_string());
    }
    Ok(catalog)
}

/// The exact artifact names for `version`, in publication order.
pub fn expected_artifact_names(version: &str) -> Result<Vec<String>, String> {
    let parsed = ReleaseVersion::parse(version)?;
    let canonical = parsed.to_string();
    catalog()?
        .names
        .into_iter()
        .map(|template| {
            let name = template.replace("{version}", &canonical);
            if name.contains('{') || name.contains('}') || name.contains('/') || name.contains('\\') {
                return Err("release.catalog_invalid".to_string());
            }
            Ok(name)
        })
        .collect()
}

/// Files with their own `ArtifactRecord`. `SHA256SUMS.txt` is derived from
/// the others and cannot contain its own hash, so it stays a public file but
/// not a record. `release-manifest.json` is also not a record.
pub fn record_artifact_names(version: &str) -> Result<Vec<String>, String> {
    let catalog = catalog()?;
    let derived = catalog.derived.clone();
    for name in &derived {
        if !catalog.names.contains(name) || name.contains('{') {
            return Err("release.catalog_invalid".to_string());
        }
    }
    Ok(expected_artifact_names(version)?
        .into_iter()
        .filter(|name| !derived.contains(name))
        .collect())
}

/// E1/E6 identity check: package version, git tag and manifest version agree.
pub fn validate_release_identity(
    version: &str,
    tag: &str,
    manifest_version: &str,
) -> Result<ReleaseVersion, String> {
    let from_version = ReleaseVersion::parse(version)?;
    let from_tag = ReleaseVersion::parse_tag(tag)?;
    let from_manifest = ReleaseVersion::parse(manifest_version)?;
    if from_version != from_tag || from_version != from_manifest {
        return Err("release.version_mismatch".to_string());
    }
    Ok(from_version)
}

/// Every version source must be the same SemVer value as the tag.
pub fn validate_version_sources(
    cargo_version: &str,
    tauri_conf: &serde_json::Value,
    package: &serde_json::Value,
    expected: &str,
) -> Result<(), String> {
    let expected = ReleaseVersion::parse(expected)?;
    let sources = [
        ("Cargo", cargo_version),
        (
            "tauri.conf.json",
            tauri_conf.get("version").and_then(|v| v.as_str()).unwrap_or(""),
        ),
        (
            "package.json",
            package.get("version").and_then(|v| v.as_str()).unwrap_or(""),
        ),
    ];
    for (label, value) in sources {
        let parsed = ReleaseVersion::parse(value)
            .map_err(|_| format!("release.version_mismatch:{label}"))?;
        if parsed != expected {
            return Err(format!("release.version_mismatch:{label}"));
        }
    }
    Ok(())
}

pub fn validate_sha256(value: &str) -> Result<(), String> {
    let ok = value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    if ok {
        Ok(())
    } else {
        Err("release.bad_hash".to_string())
    }
}

fn validate_commit(value: &str) -> Result<(), String> {
    let ok = value.len() == 40
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
    if ok {
        Ok(())
    } else {
        Err("release.bad_commit".to_string())
    }
}

pub fn validate_artifact_record(record: &ArtifactRecord) -> Result<(), String> {
    let names = record_artifact_names(&record.version)?;
    if !names.contains(&record.name) {
        return Err("release.unexpected_artifact".to_string());
    }
    validate_sha256(&record.sha256)?;
    validate_commit(&record.source_commit)?;
    if record.byte_len == 0 || record.byte_len > MAX_ARTIFACT_BYTES {
        return Err("release.bad_size".to_string());
    }
    if record.target != TARGET {
        return Err("release.bad_target".to_string());
    }
    if !record.unsigned {
        return Err("release.unexpected_signature".to_string());
    }
    let canonical = ReleaseVersion::parse(&record.version)?.to_string();
    if record.version != canonical {
        return Err("release.version_not_canonical".to_string());
    }
    Ok(())
}

pub fn validate_release_set(
    records: &[ArtifactRecord],
    version: &str,
    commit: &str,
) -> Result<(), String> {
    let expected = record_artifact_names(version)?;
    if records.len() != expected.len() {
        return Err("release.artifact_count".to_string());
    }
    validate_commit(commit)?;
    let mut seen = BTreeSet::new();
    let canonical = ReleaseVersion::parse(version)?.to_string();
    for record in records {
        validate_artifact_record(record)?;
        if record.version != canonical {
            return Err("release.version_mismatch".to_string());
        }
        if record.source_commit != commit {
            return Err("release.source_commit_mismatch".to_string());
        }
        if !seen.insert(record.name.clone()) {
            return Err("release.duplicate_artifact".to_string());
        }
    }
    for name in expected {
        if !seen.contains(&name) {
            return Err(format!("release.missing_artifact:{name}"));
        }
    }
    Ok(())
}

pub fn validate_build_metadata(metadata: &ReleaseBuildMetadata) -> Result<(), String> {
    if metadata.profile != "release" {
        return Err("release.debug_build".to_string());
    }
    if metadata.debug_port.is_some() {
        return Err("release.debug_port".to_string());
    }
    if metadata.signing_key_present {
        return Err("release.signing_key".to_string());
    }
    if metadata.model_files != 0 {
        return Err("release.model_file".to_string());
    }
    ReleaseVersion::parse(&metadata.version)?;
    validate_commit(&metadata.source_commit)
}

pub fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|_| "release.read_failed".to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65_536];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|_| "release.read_failed".to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

pub fn checksums_text(records: &[ArtifactRecord]) -> String {
    let mut text = String::new();
    for record in records {
        text.push_str(&record.sha256);
        text.push_str("  ");
        text.push_str(&record.name);
        text.push('\n');
    }
    text
}

fn verify_artifact_file(directory: &Path, record: &ArtifactRecord) -> Result<(), String> {
    if record.name.contains('/') || record.name.contains('\\') || record.name == ".." {
        return Err("release.unexpected_artifact".to_string());
    }
    let path = directory.join(&record.name);
    let metadata = fs::metadata(&path).map_err(|_| format!("release.missing_artifact:{}", record.name))?;
    if !metadata.is_file() || metadata.len() != record.byte_len {
        return Err(format!("release.size_mismatch:{}", record.name));
    }
    let actual = sha256_file(&path)?;
    if actual != record.sha256 {
        return Err(format!("release.hash_mismatch:{}", record.name));
    }
    Ok(())
}

fn verify_release_directory(directory: &Path, records: &[ArtifactRecord]) -> Result<(), String> {
    let mut expected: BTreeSet<String> =
        records.iter().map(|record| record.name.clone()).collect();
    if let Some(first) = records.first() {
        for name in expected_artifact_names(&first.version)? {
            expected.insert(name);
        }
    }
    let entries = fs::read_dir(directory).map_err(|_| "release.read_failed".to_string())?;
    for entry in entries {
        let entry = entry.map_err(|_| "release.read_failed".to_string())?;
        let file_type = entry
            .file_type()
            .map_err(|_| "release.read_failed".to_string())?;
        if file_type.is_dir() {
            return Err(format!(
                "release.unexpected_entry:{}",
                entry.file_name().to_string_lossy()
            ));
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
            if fs::symlink_metadata(entry.path())
                .map(|meta| meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
                .unwrap_or(true)
            {
                return Err(format!(
                    "release.unexpected_entry:{}",
                    entry.file_name().to_string_lossy()
                ));
            }
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == MANIFEST_FILE {
            continue;
        }
        if !expected.contains(&name) {
            return Err(format!("release.unexpected_entry:{name}"));
        }
    }
    for record in records {
        verify_artifact_file(directory, record)?;
    }
    Ok(())
}

/// Writes the manifest and checksum list after hashing every fixed artifact.
pub fn write_release_manifest(
    directory: &Path,
    version: &str,
    commit: &str,
) -> Result<ReleaseManifest, String> {
    let canonical = ReleaseVersion::parse(version)?.to_string();
    validate_release_identity(&canonical, &format!("v{canonical}"), &canonical)?;
    let mut records = Vec::new();
    for name in record_artifact_names(&canonical)? {
        let path = directory.join(&name);
        let metadata =
            fs::metadata(&path).map_err(|_| format!("release.missing_artifact:{name}"))?;
        if !metadata.is_file() {
            return Err(format!("release.missing_artifact:{name}"));
        }
        records.push(ArtifactRecord {
            name,
            sha256: sha256_file(&path)?,
            byte_len: metadata.len(),
            source_commit: commit.to_string(),
            version: canonical.clone(),
            target: TARGET.to_string(),
            unsigned: true,
        });
    }
    validate_release_set(&records, &canonical, commit)?;
    let manifest = ReleaseManifest {
        schema: 1,
        records,
    };
    let mut json = serde_json::to_string_pretty(&manifest)
        .map_err(|_| "release.manifest_failed".to_string())?;
    json.push('\n');
    crate::atomic_write(&directory.join(MANIFEST_FILE), json.as_bytes())
        .map_err(|_| "release.manifest_failed".to_string())?;
    let sums = checksums_text(&manifest.records);
    crate::atomic_write(&directory.join(CHECKSUMS_FILE), sums.as_bytes())
        .map_err(|_| "release.manifest_failed".to_string())?;
    Ok(manifest)
}

/// Verifies an existing release folder without writing to it.
pub fn verify_release_manifest(directory: &Path) -> Result<ReleaseManifest, String> {
    let text = fs::read_to_string(directory.join(MANIFEST_FILE))
        .map_err(|_| "release.manifest_missing".to_string())?;
    let manifest: ReleaseManifest =
        serde_json::from_str(&text).map_err(|_| "release.manifest_invalid".to_string())?;
    if manifest.schema != 1 {
        return Err("release.manifest_invalid".to_string());
    }
    let version = manifest
        .records
        .first()
        .map(|record| record.version.clone())
        .ok_or_else(|| "release.artifact_count".to_string())?;
    let commit = manifest
        .records
        .first()
        .map(|record| record.source_commit.clone())
        .ok_or_else(|| "release.artifact_count".to_string())?;
    validate_release_set(&manifest.records, &version, &commit)?;
    verify_release_directory(directory, &manifest.records)?;
    let sums = fs::read_to_string(directory.join(CHECKSUMS_FILE))
        .map_err(|_| "release.checksums_missing".to_string())?;
    if sums != checksums_text(&manifest.records) {
        return Err("release.checksums_mismatch".to_string());
    }
    Ok(manifest)
}

/// Runtime files that may ship next to the app or inside the portable ZIP.
/// Test pages, fixtures, debug files, keys and model weights are refused.
pub fn validate_runtime_asset(relative: &str) -> Result<(), String> {
    let components = safe_components(relative)?;
    let joined = components.join("/");
    let lower = joined.to_ascii_lowercase();
    for forbidden in [
        "test",
        "fixture",
        "sample",
        "debug",
        "measurement",
        "private",
        ".adperastra",
        ".key",
        ".gguf",
        ".onnx",
        ".safetensors",
        ".pt",
        ".pdb",
    ] {
        if lower.contains(forbidden) {
            return Err(format!("release.forbidden_runtime_asset:{joined}"));
        }
    }
    const EXACT: [&str; 8] = [
        "Adperastra.exe",
        "WebView2Loader.dll",
        "LICENSE",
        "THIRD_PARTY_LICENSES.txt",
        "SOURCE-NOTICES.txt",
        "dependencies.json",
        "portable-mode.marker",
        "README.txt",
    ];
    if EXACT.contains(&joined.as_str()) {
        return Ok(());
    }
    if is_help_page(&components) || is_template(&components) || is_font_asset(&components) {
        return Ok(());
    }
    Err(format!("release.unexpected_runtime_asset:{joined}"))
}

fn safe_components(relative: &str) -> Result<Vec<String>, String> {
    if relative.is_empty()
        || relative.len() > 32_768
        || relative.starts_with('/')
        || relative.starts_with('\\')
        || relative.contains(':')
        || relative.chars().any(|c| c.is_control())
    {
        return Err("release.bad_runtime_path".to_string());
    }
    let normalized = relative.replace('\\', "/");
    let mut result = Vec::new();
    for component in normalized.split('/') {
        if component.is_empty()
            || component == "."
            || component == ".."
            || component.ends_with('.')
            || component.ends_with(' ')
        {
            return Err("release.bad_runtime_path".to_string());
        }
        result.push(component.to_string());
    }
    Ok(result)
}

fn is_help_page(parts: &[String]) -> bool {
    if parts.len() != 3 || parts[0] != "help" || !matches!(parts[1].as_str(), "en" | "es") {
        return false;
    }
    let slug = parts[2].strip_suffix(".md").unwrap_or("");
    !slug.is_empty()
        && slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        && !slug.starts_with('-')
        && !slug.ends_with('-')
        && !slug.contains("--")
}

fn is_template(parts: &[String]) -> bool {
    if parts.len() == 2 && parts[0] == "templates" && parts[1] == "README.md" {
        return true;
    }
    if parts.len() == 3 && parts[0] == "templates" && parts[1] == "blank" {
        return matches!(extension(&parts[2]).as_deref(), Some("docx" | "xlsx" | "pptx"));
    }
    if parts.len() == 4
        && parts[0] == "templates"
        && parts[1] == "builtin"
        && matches!(parts[2].as_str(), "en" | "es")
    {
        return matches!(
            extension(&parts[3]).as_deref(),
            Some("docx" | "xlsx" | "pptx" | "md")
        );
    }
    false
}

fn is_font_asset(parts: &[String]) -> bool {
    if parts.len() != 4 || parts[0] != "assets" || parts[1] != "fonts" {
        return false;
    }
    matches!(
        extension(&parts[3]).as_deref(),
        Some("ttf" | "otf" | "woff2" | "txt" | "md")
    )
}

fn extension(name: &str) -> Option<String> {
    name.rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
}

/// Walks an installed or portable folder without following reparse points.
pub fn validate_runtime_tree(root: &Path) -> Result<usize, String> {
    let mut stack = vec![root.to_path_buf()];
    let mut visited = BTreeSet::new();
    let mut count = 0usize;
    while let Some(directory) = stack.pop() {
        let canonical =
            fs::canonicalize(&directory).map_err(|_| "release.read_failed".to_string())?;
        if !visited.insert(canonical) {
            continue;
        }
        for entry in fs::read_dir(&directory).map_err(|_| "release.read_failed".to_string())? {
            let entry = entry.map_err(|_| "release.read_failed".to_string())?;
            let path = entry.path();
            let metadata =
                fs::symlink_metadata(&path).map_err(|_| "release.read_failed".to_string())?;
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
                if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                    return Err("release.reparse_point".to_string());
                }
            }
            if metadata.is_dir() {
                stack.push(path);
            } else {
                let relative = path
                    .strip_prefix(root)
                    .map_err(|_| "release.bad_runtime_path".to_string())?;
                let relative = relative.to_string_lossy().replace('\\', "/");
                validate_runtime_asset(&relative)?;
                count += 1;
            }
        }
    }
    Ok(count)
}

fn read_json(path: &Path) -> Result<serde_json::Value, String> {
    let text = fs::read_to_string(path).map_err(|_| "release.read_failed".to_string())?;
    serde_json::from_str(&text).map_err(|_| "release.catalog_invalid".to_string())
}

/// `--release-tool write <dir> <version> <commit>`
/// `--release-tool verify <dir>`
/// `--release-tool versions <repo-root> <version>`
/// `--release-tool build <version> <commit> <profile> <debug-port|none> <key-present:true|false> <model-count>`
/// `--release-tool tree <app-dir>` (portable stage content)
pub fn run_helper() -> i32 {
    run_helper_with(std::env::args().skip(2).collect())
}

fn build_metadata_from_args(args: &[String]) -> Result<(), String> {
    let debug_port = match args[4].as_str() {
        "none" => None,
        value => Some(
            value
                .parse::<u16>()
                .map_err(|_| "release.bad_request".to_string())?,
        ),
    };
    let signing_key_present = match args[5].as_str() {
        "true" => true,
        "false" => false,
        _ => return Err("release.bad_request".to_string()),
    };
    let model_files = args[6]
        .parse::<u32>()
        .map_err(|_| "release.bad_request".to_string())?;
    validate_build_metadata(&ReleaseBuildMetadata {
        version: args[1].clone(),
        source_commit: args[2].clone(),
        profile: args[3].clone(),
        debug_port,
        signing_key_present,
        model_files,
    })
}

fn version_sources_from_args(args: &[String]) -> Result<(), String> {
    let root = PathBuf::from(&args[1]);
    let tauri = read_json(&root.join("src-tauri/tauri.conf.json"))?;
    let package = read_json(&root.join("package.json"))?;
    // dependencies.json is the signed setup manifest. Its app.version is a
    // setup-package field, not the public release version, and changing it
    // would invalidate the owner's signature. It is deliberately not checked
    // here; the artifact manifest records the release version instead.
    validate_version_sources(
        env!("CARGO_PKG_VERSION"),
        &tauri,
        &package,
        &args[2],
    )
}

pub fn run_helper_with(args: Vec<String>) -> i32 {
    let result = match args.first().map(String::as_str) {
        Some("write") if args.len() == 4 => write_release_manifest(
            Path::new(&args[1]),
            &args[2],
            &args[3],
        )
        .map(|_| ()),
        Some("build") if args.len() == 7 => build_metadata_from_args(&args),
        Some("verify") if args.len() == 2 => {
            verify_release_manifest(Path::new(&args[1])).map(|_| ())
        }
        Some("tree") if args.len() == 2 => {
            validate_runtime_tree(Path::new(&args[1])).map(|_| ())
        }
        Some("versions") if args.len() == 3 => version_sources_from_args(&args),
        _ => Err("release.bad_request".to_string()),
    };
    match result {
        Ok(()) => 0,
        Err(code) => {
            eprintln!("{code}");
            2
        }
    }
}

#[cfg(test)]
#[path = "artifact_inventory_tests.rs"]
mod tests;
