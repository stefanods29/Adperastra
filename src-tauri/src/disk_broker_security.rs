//! Security rules for the one-operation disk broker (Step 09j T3).
//!
//! The broker is this executable started elevated with `--disk-broker`.
//! It is not a general remote procedure channel: the parent and child are
//! bound by the pipe's OS access control list, the broker verifies the
//! peer process id, creation time and user SID, and after the first
//! authorized mount it accepts only `eject` for that same mount or
//! `status`. A second mount, another path or any other operation ends the
//! session and detaches. No user-supplied command line is ever elevated.

use std::io::{Read, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::disk_image_types::{
    valid_image_path, valid_volume_root, MountRequest, MAX_BROKER_FRAME, MAX_DISK_PATH_UNITS,
    MAX_VOLUME_ROOTS,
};

/// The identity of one Windows process, as observed from its handle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PeerIdentity {
    pub pid: u32,
    /// Creation time as decimal Windows FILETIME ticks.
    pub start_ticks: String,
    pub sid: String,
}

/// The peer must match every field. Arguments only say what to expect;
/// the actual values come from the OS handle, never from the command line.
/// Both sides are also checked for the shape a real Windows process
/// identity has, so a zero pid, a non-numeric creation time or a foreign
/// SID string is denied before the comparison.
pub fn verify_peer(expected: &PeerIdentity, actual: &PeerIdentity) -> Result<(), String> {
    if !valid_peer_identity(expected) || !valid_peer_identity(actual) {
        return Err("disk.denied".to_string());
    }
    if actual.pid != expected.pid
        || actual.start_ticks != expected.start_ticks
        || !actual.sid.eq_ignore_ascii_case(&expected.sid)
    {
        return Err("disk.denied".to_string());
    }
    Ok(())
}

fn valid_peer_identity(identity: &PeerIdentity) -> bool {
    identity.pid != 0
        && !identity.start_ticks.is_empty()
        && identity.start_ticks.len() <= 20
        && identity.start_ticks.bytes().all(|b| b.is_ascii_digit())
        && identity.start_ticks.parse::<u64>().is_ok()
        && identity.sid.len() <= 184
        && identity.sid.starts_with("S-")
        && identity
            .sid
            .bytes()
            .all(|b| b == b'S' || b.is_ascii_digit() || b == b'-')
}

/// A pipe name is one path-free component whose last 36 characters are
/// the parent-generated UUID nonce; a fixed or reused name is refused
/// before a pipe is created.
pub fn valid_pipe_name(name: &str) -> bool {
    const NONCE_LEN: usize = 36;
    if name.len() <= NONCE_LEN
        || name.len() > 128
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
    {
        return false;
    }
    let (prefix, nonce) = name.split_at(name.len() - NONCE_LEN);
    !prefix.is_empty() && uuid::Uuid::parse_str(nonce).is_ok()
}

/// UAC cancellation is a clean outcome, not a failure to report as a bug.
pub fn launch_cancelled(code: u32) -> bool {
    const ERROR_CANCELLED: u32 = 1223;
    code == ERROR_CANCELLED
}

/// What the broker may open elevated: an existing, local, non-reparse
/// image outside the protected Windows roots.
pub fn privileged_source_allowed(path: &Path) -> Result<(), String> {
    let text = path.to_string_lossy().into_owned();
    if !valid_image_path(&text) {
        return Err("disk.denied".to_string());
    }
    if is_network_path(&text) {
        return Err("disk.denied".to_string());
    }
    let meta = std::fs::symlink_metadata(path).map_err(|_| "disk.denied".to_string())?;
    if is_reparse(&meta) || !meta.file_type().is_file() {
        return Err("disk.denied".to_string());
    }
    let canonical = std::fs::canonicalize(path).map_err(|_| "disk.denied".to_string())?;
    let canonical_text = canonical.to_string_lossy();
    let canonical_text = canonical_text
        .strip_prefix(r"\\?\")
        .unwrap_or(&canonical_text);
    if is_network_path(canonical_text) {
        return Err("disk.denied".to_string());
    }
    for root in protected_roots() {
        if is_under(canonical_text, &root) {
            return Err("disk.denied".to_string());
        }
    }
    Ok(())
}

fn is_network_path(path: &str) -> bool {
    let plain = path.strip_prefix(r"\\?\").unwrap_or(path);
    plain.starts_with(r"\\") || plain.starts_with(r"UNC\")
}

#[cfg(windows)]
fn is_reparse(meta: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse(meta: &std::fs::Metadata) -> bool {
    meta.file_type().is_symlink()
}

fn protected_roots() -> Vec<String> {
    let mut roots = Vec::new();
    for key in ["SystemRoot", "WINDIR", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(value) = std::env::var_os(key) {
            let text = value.to_string_lossy().into_owned();
            if !text.is_empty() {
                roots.push(text);
            }
        }
    }
    roots
}

fn is_under(path: &str, root: &str) -> bool {
    let path = normalized(path);
    let root = normalized(root);
    path == root || path.starts_with(&format!("{root}\\"))
}

fn normalized(path: &str) -> String {
    path.strip_prefix(r"\\?\")
        .unwrap_or(path)
        .trim_end_matches(['\\', '/'])
        .to_ascii_lowercase()
}

/// One request from the parent. The tagged shape has no free-form
/// command, executable or shell text.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum BrokerRequest {
    Mount {
        mount_id: String,
        request: MountRequest,
    },
    Eject {
        mount_id: String,
    },
    Status,
}

/// What the broker reports after one operation. It contains no path the
/// parent did not already know and no raw bytes. The broker only ever
/// attaches read-only, and says so; the parent refuses any other reply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrokerMountInfo {
    pub physical_path: String,
    pub volume_roots: Vec<String>,
    pub readonly: bool,
}

/// Every mount and eject reply echoes the mount UUID of the request it
/// answers, so the parent can prove the answer belongs to the operation
/// it just sent. Status carries no UUID and is never used for a mount
/// decision.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BrokerReply {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mount_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mount: Option<BrokerMountInfo>,
}

impl BrokerReply {
    /// A correlated success with no mount (eject, status). `None` is only
    /// for a request that carries no mount UUID of its own.
    pub fn ok(mount_id: Option<&str>) -> Self {
        BrokerReply {
            ok: true,
            mount_id: mount_id.map(str::to_string),
            error: None,
            mount: None,
        }
    }

    pub fn with_mount(mount_id: &str, mount: BrokerMountInfo) -> Self {
        BrokerReply {
            ok: true,
            mount_id: Some(mount_id.to_string()),
            error: None,
            mount: Some(mount),
        }
    }

    pub fn err(mount_id: Option<&str>, code: &str) -> Self {
        BrokerReply {
            ok: false,
            mount_id: mount_id.map(str::to_string),
            error: Some(code.to_string()),
            mount: None,
        }
    }
}

/// The parent accepts a reply only when it echoes the exact request UUID
/// and its fields are consistent: `ok` never carries an error, a failure
/// always carries a bounded `disk.*` code and never a mount, a mount
/// answer carries exactly one read-only mount with bounded volume roots
/// and a real Windows device path.
pub fn verify_reply(
    reply: &BrokerReply,
    expected_mount_id: &str,
    expects_mount: bool,
) -> Result<(), String> {
    if uuid::Uuid::parse_str(expected_mount_id).is_err()
        || reply.mount_id.as_deref() != Some(expected_mount_id)
    {
        return Err("disk.denied".to_string());
    }
    if reply.ok {
        if reply.error.is_some() {
            return Err("disk.denied".to_string());
        }
        match (&reply.mount, expects_mount) {
            (Some(info), true) if valid_mount_info(info) => Ok(()),
            (None, false) => Ok(()),
            _ => Err("disk.denied".to_string()),
        }
    } else if reply.mount.is_none() && reply.error.as_deref().is_some_and(valid_error_code) {
        Ok(())
    } else {
        Err("disk.denied".to_string())
    }
}

fn valid_error_code(code: &str) -> bool {
    let Some(rest) = code.strip_prefix("disk.") else {
        return false;
    };
    !rest.is_empty()
        && code.len() <= 32
        && rest
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

/// The physical path the VHD API reports is one Windows device path:
/// `\\.\PhysicalDriveN` or `\\.\CdRomN`, optionally with the `\\?\`
/// prefix. Any other text is refused instead of being shown to the user.
pub fn valid_physical_path(path: &str) -> bool {
    let Some(rest) = path
        .strip_prefix(r"\\.\")
        .or_else(|| path.strip_prefix(r"\\?\"))
    else {
        return false;
    };
    let lower = rest.to_ascii_lowercase();
    let Some(digits) = lower
        .strip_prefix("physicaldrive")
        .or_else(|| lower.strip_prefix("cdrom"))
    else {
        return false;
    };
    !digits.is_empty()
        && digits.len() <= 10
        && digits.bytes().all(|b| b.is_ascii_digit())
        && digits.parse::<u32>().is_ok()
}

/// Read one length-prefixed frame. `None` is a clean disconnect before a
/// new frame; a partial or oversized frame is a protocol failure.
pub fn read_frame<R: Read>(reader: &mut R) -> Result<Option<Vec<u8>>, String> {
    let mut header = [0u8; 4];
    let mut read = 0usize;
    while read < header.len() {
        match reader.read(&mut header[read..]) {
            Ok(0) if read == 0 => return Ok(None),
            Ok(0) => return Err("disk.denied".to_string()),
            Ok(count) => read += count,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => return Err("disk.denied".to_string()),
        }
    }
    let length = u32::from_le_bytes(header) as usize;
    if length == 0 || length > MAX_BROKER_FRAME {
        return Err("disk.denied".to_string());
    }
    let mut payload = vec![0u8; length];
    reader
        .read_exact(&mut payload)
        .map_err(|_| "disk.denied".to_string())?;
    Ok(Some(payload))
}

pub fn write_frame<W: Write>(writer: &mut W, payload: &[u8]) -> Result<(), String> {
    if payload.is_empty() || payload.len() > MAX_BROKER_FRAME {
        return Err("disk.denied".to_string());
    }
    let length = (payload.len() as u32).to_le_bytes();
    writer
        .write_all(&length)
        .and_then(|_| writer.write_all(payload))
        .and_then(|_| writer.flush())
        .map_err(|_| "disk.unavailable".to_string())
}

/// What the broker can do to Windows. The real implementation lives in
/// `disk_broker.rs`; tests use a fake to prove the state machine.
pub trait BrokerHost {
    fn open_readonly(
        &mut self,
        mount_id: &str,
        request: &MountRequest,
    ) -> Result<BrokerMountInfo, String>;
    fn detach(&mut self) -> Result<(), String>;
}

/// Run one broker conversation. The first frame may mount; after that
/// only eject (same id) and status are accepted. Disconnect detaches.
pub fn run_session<H: BrokerHost, R: Read, W: Write>(
    host: &mut H,
    reader: &mut R,
    writer: &mut W,
) -> Result<(), String> {
    let mut bound: Option<String> = None;
    loop {
        let frame = match read_frame(reader) {
            Ok(Some(frame)) => frame,
            Ok(None) => {
                if bound.is_some() {
                    let _ = host.detach();
                }
                return Ok(());
            }
            Err(_) => {
                if bound.is_some() {
                    let _ = host.detach();
                }
                return Ok(());
            }
        };
        let request: BrokerRequest = match serde_json::from_slice(&frame) {
            Ok(request) => request,
            Err(_) => {
                deny(host, writer, bound.is_some(), None)?;
                return Err("disk.denied".to_string());
            }
        };
        match request {
            BrokerRequest::Mount { mount_id, request } if bound.is_none() => {
                if uuid::Uuid::parse_str(&mount_id).is_err() {
                    deny(host, writer, false, Some(mount_id.as_str()))?;
                    return Err("disk.denied".to_string());
                }
                // The command path and the broker share one contract:
                // supported family, read only, bounded identity.
                if let Err(code) = request.validate() {
                    reply(writer, &BrokerReply::err(Some(mount_id.as_str()), &code));
                    return Ok(());
                }
                // The authorized request names both the source and the
                // exact identity captured by the parent; a request without
                // a stamp can never be revalidated and is refused.
                if request.expected.is_none()
                    || privileged_source_allowed(Path::new(&request.path)).is_err()
                {
                    reply(writer, &BrokerReply::err(Some(mount_id.as_str()), "disk.denied"));
                    return Ok(());
                }
                match host.open_readonly(&mount_id, &request) {
                    Ok(info) if valid_mount_info(&info) => {
                        reply(writer, &BrokerReply::with_mount(&mount_id, info));
                        bound = Some(mount_id);
                    }
                    Ok(_) => {
                        reply(writer, &BrokerReply::err(Some(mount_id.as_str()), "disk.denied"));
                        return Ok(());
                    }
                    Err(code) if code.starts_with("disk.") => {
                        reply(writer, &BrokerReply::err(Some(mount_id.as_str()), &code));
                        return Ok(());
                    }
                    Err(_) => {
                        reply(writer, &BrokerReply::err(Some(mount_id.as_str()), "disk.denied"));
                        return Ok(());
                    }
                }
            }
            BrokerRequest::Eject { mount_id } if bound.as_deref() == Some(mount_id.as_str()) => {
                match host.detach() {
                    Ok(()) => {
                        reply(writer, &BrokerReply::ok(Some(mount_id.as_str())));
                        return Ok(());
                    }
                    Err(code) => {
                        // The mount stays alive so the user can close its
                        // files and retry the eject.
                        reply(writer, &BrokerReply::err(Some(mount_id.as_str()), &code));
                    }
                }
            }
            BrokerRequest::Status if bound.is_some() => {
                // Status carries no UUID of its own; it is never used for
                // a mount decision.
                reply(writer, &BrokerReply::ok(None));
            }
            // A second mount, another id or any other operation is a
            // protocol violation: detach and end the session.
            _ => {
                let echoed = match &request {
                    BrokerRequest::Mount { mount_id, .. }
                    | BrokerRequest::Eject { mount_id } => Some(mount_id.as_str()),
                    BrokerRequest::Status => None,
                };
                deny(host, writer, bound.is_some(), echoed)?;
                return Err("disk.denied".to_string());
            }
        }
    }
}

fn reply<W: Write>(writer: &mut W, answer: &BrokerReply) {
    if let Ok(bytes) = serde_json::to_vec(answer) {
        let _ = write_frame(writer, &bytes);
    }
}

fn deny<H: BrokerHost, W: Write>(
    host: &mut H,
    writer: &mut W,
    has_mount: bool,
    mount_id: Option<&str>,
) -> Result<(), String> {
    if has_mount {
        let _ = host.detach();
    }
    reply(writer, &BrokerReply::err(mount_id, "disk.denied"));
    Ok(())
}

fn valid_mount_info(info: &BrokerMountInfo) -> bool {
    info.readonly
        && valid_physical_path(&info.physical_path)
        && info.physical_path.encode_utf16().count() <= MAX_DISK_PATH_UNITS
        && !info.volume_roots.is_empty()
        && info.volume_roots.len() <= MAX_VOLUME_ROOTS
        && info.volume_roots.iter().all(|root| valid_volume_root(root))
}

#[cfg(test)]
#[path = "disk_broker_security_step09j_tests.rs"]
mod step09j_tests;
