//! Bounded pack helper (Step 12a H04): `Adperastra.exe --pack-helper`
//! parses exactly one pack ZIP in its own memory-limited process and exits
//! (plan/rules.md R-SEC-9).
//!
//! The parent sends one framed JSON request containing the signed descriptor
//! and two app-owned paths: the completed `<packs>/downloads/<uuid>.part`
//! archive and an empty `<packs>/staging/<uuid>` destination. The helper
//! validates both paths, checks the complete archive SHA-256 *before* the ZIP
//! parser runs, extracts with the bounded `pack-store` guards and answers
//! with the archive hash, descriptor digest, file count and total bytes.
//! The parent verifies the staged tree independently and only then activates
//! it; this app process never opens a pack archive.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use fs_service::CancellationToken;
use pack_store::download_state::validate_download_id;
use pack_store::error::map_io;
use pack_store::install::{verify_staging, ActiveVersion, VerifiedStaging};
use pack_store::inventory::hash_file;
use pack_store::types::{PackCatalog, PackDescriptor, PackId, MAX_PACK_FILES};
use pack_store::validation::{parse_https_url, validate_descriptor, CatalogPolicy};
use serde::{Deserialize, Serialize};

use crate::helper::HelperProcess;
use crate::helper_frames::{encode_frame, read_frame, HelperFrameEvent, MAX_FRAME_BYTES};

/// The static flag that turns this executable into the pack helper.
pub const HELPER_FLAG: &str = "--pack-helper";
/// One ZIP parser at a time, with a 1 GiB job-object limit.
pub const HELPER_MEMORY_LIMIT: usize = 1_073_741_824;
/// The largest request the helper accepts (a signed catalog is <= 1 MiB).
pub const MAX_REQUEST_BYTES: usize = 2 * 1024 * 1024;
/// The largest answer the parent accepts.
pub const MAX_REPLY_BYTES: usize = 64 * 1024;
/// The parent's hard wall-clock limit for one extraction. The user can
/// cancel earlier through the job token.
pub const HELPER_WALL_LIMIT: Duration = Duration::from_secs(30 * 60);

/// One request frame: the exact signed descriptor plus app-owned paths.
pub const FRAME_REQUEST: u8 = 1;
/// One successful answer frame.
pub const FRAME_EXTRACTED: u8 = 2;
/// One stable `packs.*` error frame.
pub const FRAME_ERROR: u8 = 3;

pub const REQUEST_SCHEMA_VERSION: u32 = 1;
pub const REPLY_SCHEMA_VERSION: u32 = 1;

/// Everything the helper needs. The archive is already complete and verified
/// by the download path; the helper repeats the full hash before parsing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackHelperRequest {
    pub schema_version: u32,
    pub id: PackId,
    pub version: String,
    pub packs_root: String,
    pub archive_path: String,
    pub staging_path: String,
    pub descriptor: PackDescriptor,
}

/// What one successful extraction proves. The parent checks every field and
/// then verifies the actual tree against the descriptor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PackHelperReply {
    pub schema_version: u32,
    pub archive_sha256: String,
    pub descriptor_digest: String,
    pub file_count: u32,
    pub total_bytes: u64,
}

struct OwnedPaths {
    archive: PathBuf,
    staging: PathBuf,
}

/// Child entry point; returns the process exit code. A protocol error also
/// sends a bounded error frame before exiting.
pub fn run_helper() -> i32 {
    let mut input = std::io::stdin().lock();
    let mut output = std::io::stdout().lock();
    run_helper_with(&mut input, &mut output)
}

fn run_helper_with<R: Read, W: Write>(input: &mut R, output: &mut W) -> i32 {
    let request = match receive_request(input) {
        Ok(request) => request,
        Err(code) => {
            let _ = send_frame(output, FRAME_ERROR, code.as_bytes());
            return 2;
        }
    };
    match process_request(&request) {
        Ok(reply) => match send_reply(output, &reply) {
            Ok(()) => 0,
            Err(_) => 1,
        },
        Err(code) => {
            let _ = send_frame(output, FRAME_ERROR, code.as_bytes());
            0
        }
    }
}

fn receive_request<R: Read>(input: &mut R) -> Result<PackHelperRequest, String> {
    match read_frame(input, MAX_FRAME_BYTES) {
        HelperFrameEvent::Frame {
            kind: FRAME_REQUEST,
            body,
        } if body.len() <= MAX_REQUEST_BYTES => {
            let request: PackHelperRequest = serde_json::from_slice(&body)
                .map_err(|_| "packs.bad_request".to_string())?;
            if request.schema_version != REQUEST_SCHEMA_VERSION {
                return Err("packs.bad_request".to_string());
            }
            Ok(request)
        }
        _ => Err("packs.bad_request".to_string()),
    }
}

fn send_reply<W: Write>(output: &mut W, reply: &PackHelperReply) -> Result<(), String> {
    let body = serde_json::to_vec(reply).map_err(|_| "packs.failed".to_string())?;
    if body.len() > MAX_REPLY_BYTES {
        return Err("packs.failed".to_string());
    }
    send_frame(output, FRAME_EXTRACTED, &body)
}

fn send_frame<W: Write>(output: &mut W, kind: u8, body: &[u8]) -> Result<(), String> {
    let frame = encode_frame(kind, body)?;
    output
        .write_all(&frame)
        .and_then(|()| output.flush())
        .map_err(|_| "packs.failed".to_string())
}

fn process_request(request: &PackHelperRequest) -> Result<PackHelperReply, String> {
    let paths = validate_request(request)?;
    let archive_sha256 = verify_archive_hash(&paths.archive, &request.descriptor)?;
    pack_store::install::extract_archive(&paths.archive, &request.descriptor, &paths.staging)
        .map_err(|error| error.code().to_string())?;
    let total_bytes = declared_total(&request.descriptor)?;
    let file_count = u32::try_from(request.descriptor.files.len())
        .map_err(|_| "packs.bad_request".to_string())?;
    Ok(PackHelperReply {
        schema_version: REPLY_SCHEMA_VERSION,
        archive_sha256,
        descriptor_digest: request.descriptor.digest(),
        file_count,
        total_bytes,
    })
}

fn validate_request(request: &PackHelperRequest) -> Result<OwnedPaths, String> {
    if request.descriptor.id != request.id || request.descriptor.version != request.version {
        return Err("packs.bad_request".to_string());
    }
    validate_descriptor_context(&request.descriptor)?;
    validate_owned_paths(
        Path::new(&request.packs_root),
        Path::new(&request.archive_path),
        Path::new(&request.staging_path),
    )
}

/// The helper and the parent accept only a completed owned download and an
/// empty owned staging directory. Both paths are canonicalized before use.
fn validate_owned_paths(
    packs_root: &Path,
    archive: &Path,
    staging: &Path,
) -> Result<OwnedPaths, String> {
    let root = canonical_dir(packs_root)?;
    let downloads = canonical_dir(&root.join("downloads"))?;
    let staging_root = canonical_dir(&root.join("staging"))?;
    if !downloads.starts_with(&root) || !staging_root.starts_with(&root) {
        return Err("packs.bad_request".to_string());
    }
    let archive = canonical_file(archive)?;
    if archive.parent() != Some(downloads.as_path()) {
        return Err("packs.bad_request".to_string());
    }
    let name = archive
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "packs.bad_request".to_string())?;
    let download_id = name
        .strip_suffix(".part")
        .ok_or_else(|| "packs.bad_request".to_string())?;
    validate_download_id(download_id).map_err(|error| error.code().to_string())?;
    let staging = canonical_dir(staging)?;
    if staging.parent() != Some(staging_root.as_path()) {
        return Err("packs.bad_request".to_string());
    }
    let staging_name = staging
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "packs.bad_request".to_string())?;
    validate_download_id(staging_name).map_err(|error| error.code().to_string())?;
    if std::fs::read_dir(&staging)
        .map_err(|error| map_io(&error).code().to_string())?
        .next()
        .is_some()
    {
        return Err("packs.bad_request".to_string());
    }
    Ok(OwnedPaths { archive, staging })
}

/// The descriptor arrived from the signed catalog. The helper still validates
/// it with the same production rules before parsing; the download URL supplies
/// the only origin this request may use.
fn validate_descriptor_context(descriptor: &PackDescriptor) -> Result<(), String> {
    if descriptor.files.len() > MAX_PACK_FILES {
        return Err("packs.bad_request".to_string());
    }
    let url = parse_https_url(&descriptor.download_url, false)
        .map_err(|error| error.code().to_string())?;
    let origin = url.origin().ascii_serialization();
    if origin == "null" {
        return Err("packs.bad_request".to_string());
    }
    let catalog = PackCatalog {
        schema_version: 1,
        revision: descriptor.catalog_revision.max(1),
        allowed_origins: vec![origin],
        packs: Vec::new(),
    };
    validate_descriptor(descriptor, &catalog, CatalogPolicy::production())
        .map_err(|error| error.code().to_string())
}

fn verify_archive_hash(archive: &Path, descriptor: &PackDescriptor) -> Result<String, String> {
    let metadata =
        std::fs::symlink_metadata(archive).map_err(|error| map_io(&error).code().to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("packs.bad_request".to_string());
    }
    if metadata.len() != descriptor.download_bytes {
        return Err("packs.bad_hash".to_string());
    }
    let hash = hash_file(archive).map_err(|error| error.code().to_string())?;
    if hash != descriptor.sha256 {
        return Err("packs.bad_hash".to_string());
    }
    Ok(hash)
}

fn canonical_dir(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("packs.bad_request".to_string());
    }
    let metadata =
        std::fs::symlink_metadata(path).map_err(|error| map_io(&error).code().to_string())?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("packs.bad_request".to_string());
    }
    path.canonicalize()
        .map_err(|error| map_io(&error).code().to_string())
}

fn canonical_file(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("packs.bad_request".to_string());
    }
    let metadata =
        std::fs::symlink_metadata(path).map_err(|error| map_io(&error).code().to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("packs.bad_request".to_string());
    }
    path.canonicalize()
        .map_err(|error| map_io(&error).code().to_string())
}

fn declared_total(descriptor: &PackDescriptor) -> Result<u64, String> {
    descriptor
        .files
        .iter()
        .try_fold(0u64, |total, file| total.checked_add(file.size))
        .ok_or_else(|| "packs.bad_request".to_string())
}

/// Parent-side extraction. Creates one empty app-owned staging directory,
/// runs the bounded helper, checks its answer and verifies the staged tree in
/// this process. The returned token is the only input [`activate_verified`]
/// accepts.
#[allow(dead_code)] // Consumed by the install path once the signed catalog,
// completed-download and probe contracts of Step 12b are configured.
pub fn extract_verified(
    packs_root: &Path,
    archive_path: &Path,
    descriptor: &PackDescriptor,
    token: &CancellationToken,
) -> Result<VerifiedStaging, String> {
    if token.load(Ordering::Relaxed) {
        return Err("packs.cancelled".to_string());
    }
    let root = canonical_dir(packs_root)?;
    let staging_root = root.join("staging");
    std::fs::create_dir_all(&staging_root)
        .map_err(|error| map_io(&error).code().to_string())?;
    let staging_root = canonical_dir(&staging_root)?;
    let staging = staging_root.join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir(&staging).map_err(|error| map_io(&error).code().to_string())?;
    let archive = match canonical_file(archive_path) {
        Ok(archive) => archive,
        Err(code) => {
            let _ = pack_store::install::retire_to_trash(&root, &staging, "failed-request");
            return Err(code);
        }
    };
    // The helper repeats this validation; doing it here fails before a process
    // starts and keeps a foreign path out of the request entirely.
    let (archive, staging) = match validate_owned_paths(&root, &archive, &staging) {
        Ok(paths) => (paths.archive, paths.staging),
        Err(code) => {
            let _ = pack_store::install::retire_to_trash(&root, &staging, "failed-request");
            return Err(code);
        }
    };
    let request = PackHelperRequest {
        schema_version: REQUEST_SCHEMA_VERSION,
        id: descriptor.id,
        version: descriptor.version.clone(),
        packs_root: path_text(&root)?,
        archive_path: path_text(&archive)?,
        staging_path: path_text(&staging)?,
        descriptor: descriptor.clone(),
    };
    let outcome = run_extract(&request, token);
    let reply = match outcome {
        Ok(reply) => reply,
        Err(code) => {
            let _ = pack_store::install::retire_to_trash(&root, &staging, "failed-helper");
            return Err(code);
        }
    };
    if let Err(code) = check_reply(&reply, descriptor) {
        let _ = pack_store::install::retire_to_trash(&root, &staging, "failed-answer");
        return Err(code);
    }
    match verify_staging(&staging, descriptor) {
        Ok(staged) => Ok(staged),
        Err(error) => {
            let _ = pack_store::install::retire_to_trash(&root, &staging, "failed-inventory");
            Err(error.code().to_string())
        }
    }
}

fn path_text(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_string)
        .ok_or_else(|| "packs.bad_request".to_string())
}

fn check_reply(reply: &PackHelperReply, descriptor: &PackDescriptor) -> Result<(), String> {
    if reply.schema_version != REPLY_SCHEMA_VERSION
        || reply.archive_sha256 != descriptor.sha256
        || reply.descriptor_digest != descriptor.digest()
        || reply.file_count as usize != descriptor.files.len()
        || reply.total_bytes != declared_total(descriptor)?
    {
        return Err("packs.changed".to_string());
    }
    Ok(())
}

fn run_extract(
    request: &PackHelperRequest,
    token: &CancellationToken,
) -> Result<PackHelperReply, String> {
    let body = serde_json::to_vec(request).map_err(|_| "packs.bad_request".to_string())?;
    if body.len() > MAX_REQUEST_BYTES {
        return Err("packs.bad_request".to_string());
    }
    let mut helper = HelperProcess::spawn_framed(HELPER_FLAG, HELPER_MEMORY_LIMIT, MAX_FRAME_BYTES)
        .map_err(|_| "packs.failed".to_string())?;
    helper
        .send_frame(FRAME_REQUEST, &body)
        .map_err(|_| "packs.failed".to_string())?;
    let deadline = Instant::now() + HELPER_WALL_LIMIT;
    loop {
        if token.load(Ordering::Relaxed) {
            helper.kill();
            return Err("packs.cancelled".to_string());
        }
        if Instant::now() >= deadline {
            helper.kill();
            return Err("packs.failed".to_string());
        }
        match helper.recv_frame(Duration::from_millis(250)) {
            None => {}
            Some(HelperFrameEvent::Frame {
                kind: FRAME_EXTRACTED,
                body,
            }) => {
                helper.kill();
                if body.len() > MAX_REPLY_BYTES {
                    return Err("packs.failed".to_string());
                }
                return serde_json::from_slice(&body).map_err(|_| "packs.failed".to_string());
            }
            Some(HelperFrameEvent::Frame {
                kind: FRAME_ERROR,
                body,
            }) => {
                helper.kill();
                return Err(stable_code(&body));
            }
            Some(_) => {
                helper.kill();
                return Err("packs.failed".to_string());
            }
        }
    }
}

fn stable_code(body: &[u8]) -> String {
    let code = String::from_utf8_lossy(body);
    if is_stable_pack_code(&code) {
        code.into_owned()
    } else {
        "packs.failed".to_string()
    }
}

fn is_stable_pack_code(code: &str) -> bool {
    matches!(
        code,
        "packs.bad_request"
            | "packs.bad_signature"
            | "packs.bad_hash"
            | "packs.unsupported_schema"
            | "packs.dependency_cycle"
            | "packs.no_space"
            | "packs.changed"
            | "packs.unavailable"
            | "packs.busy"
            | "packs.cancelled"
            | "packs.failed"
            | "packs.capability_missing"
    )
}

/// Parent activation entry. The token proves the staged tree was verified;
/// the archive parser is never loaded in this process.
#[allow(dead_code)] // Consumed by the install path once Step 12b supplies a probe.
pub fn activate_verified(
    staged: VerifiedStaging,
    descriptor: &PackDescriptor,
    packs_root: &Path,
    now_unix: u64,
    probe: &dyn Fn(&Path, &PackDescriptor) -> Result<(), String>,
) -> Result<ActiveVersion, String> {
    let root = canonical_dir(packs_root)?;
    pack_store::install::activate_verified(staged, descriptor, &root, now_unix, probe)
        .map_err(|error| error.code().to_string())
}

#[cfg(test)]
#[path = "pack_helper_step12a_tests.rs"]
mod step12a_tests;
