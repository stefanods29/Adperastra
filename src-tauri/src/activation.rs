//! User-scoped single-instance activation (Step 09c, D9/D10, E6).
//!
//! A second Adperastra process sends a bounded batch of absolute file
//! paths plus an optional fixed `--open`/`--convert` intent through a
//! per-user named pipe. This module owns the request shape, its validation,
//! argument parsing and the queue that holds requests until the running
//! window says it is ready. It never opens a file or converts anything, so
//! the pipe thread can validate and enqueue without touching the
//! filesystem; the frontend later opens every accepted path through the
//! normal `planOpen` pipeline, and `--convert` only opens the review.

use crate::windows_integration_types::ActivationIntent;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use uuid::Uuid;

/// The only request version this build understands.
pub const ACTIVATION_VERSION: u32 = 1;
/// Most paths one invocation may carry.
pub const MAX_ACTIVATION_PATHS: usize = 256;
/// A path longer than this (UTF-16 units) is refused.
pub const MAX_PATH_UTF16: usize = 32_768;
/// Protocol cap for the serialized request, length prefix excluded.
pub const MAX_ACTIVATION_BYTES: usize = 768 * 1024;
/// Requests the queue holds while the window is starting.
pub const MAX_QUEUED_ACTIVATIONS: usize = 16;
/// Total time a second instance waits for an ack.
pub const ACTIVATION_TIMEOUT_MS: u32 = 3_000;
/// Request ids remembered for duplicate suppression.
pub const ACTIVATION_DEDUPE_CAPACITY: usize = 256;
/// Duplicate suppression window.
pub const ACTIVATION_DEDUPE_WINDOW: Duration = Duration::from_secs(10 * 60);
/// `sent_unix` must survive a JSON number round trip in the webview.
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub const ERR_INVALID: &str = "activation.invalid";
pub const ERR_BUSY: &str = "activation.busy";
pub const ERR_DENIED: &str = "activation.denied";
pub const ERR_TIMEOUT: &str = "activation.timeout";
const ERR_FAILED: &str = "activation.failed";

/// One file-opening request from a second instance. `working_directory`
/// is deliberately absent: D9 forbids forwarding arbitrary commands. The
/// optional intent is the fixed `--open`/`--convert` flag as data; an
/// absent intent keeps the pre-Step-16 behavior and opens.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActivationRequest {
    pub version: u32,
    pub request_id: String,
    pub paths: Vec<String>,
    pub sent_unix: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub intent: Option<ActivationIntent>,
}

/// What the primary instance tells the second one. `accepted` means the
/// request was queued, never that a file was opened.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActivationAck {
    pub request_id: String,
    pub accepted: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Parse and validate one UTF-8 request frame. No filesystem access.
pub fn validate_activation(bytes: &[u8]) -> Result<ActivationRequest, String> {
    if bytes.is_empty() || bytes.len() > MAX_ACTIVATION_BYTES {
        return Err(ERR_INVALID.to_string());
    }
    let mut request: ActivationRequest =
        serde_json::from_slice(bytes).map_err(|_| ERR_INVALID.to_string())?;
    normalize_request(&mut request)?;
    Ok(request)
}

/// Validate and enqueue a request. Duplicate ids are accepted without a
/// second queue entry; a full queue answers busy instead of blocking.
pub fn process_activation(
    mut request: ActivationRequest,
    queue: &ActivationQueue,
) -> Result<ActivationAck, String> {
    normalize_request(&mut request)?;
    queue.enqueue(request)
}

/// Parse the command line of a second instance. Only the two fixed
/// intent flags (`--open`, `--convert`), one literal `--` delimiter and
/// absolute paths are allowed; every other switch, including the helper
/// flags, is refused rather than forwarded. A missing intent means open.
pub fn parse_activation_args(
    args: &[String],
) -> Result<(ActivationIntent, Vec<String>), String> {
    let (intent, paths) = crate::integration_commands::classify_arguments(args)
        .map_err(|_| ERR_INVALID.to_string())?;
    if paths.is_empty() || paths.len() > MAX_ACTIVATION_PATHS {
        return Err(ERR_INVALID.to_string());
    }
    for path in &paths {
        if !is_absolute_activation_path(path)
            || path.encode_utf16().count() > MAX_PATH_UTF16
        {
            return Err(ERR_INVALID.to_string());
        }
    }
    Ok((intent, paths))
}

/// Build the primary instance's initial request from its own launch
/// arguments (D9: initial and later activation share one queue). Startup
/// switches named by `is_startup_switch` (`--background` and the helper
/// flags) are consumed by the entry point and dropped before the literal
/// `--` delimiter, so none can become a path; after the delimiter every
/// argument stays literal and is parsed by `parse_activation_args`, which
/// still refuses unknown switches and relative paths. `None` means the
/// launch carries nothing to open. The id is always fresh, so a primary
/// request can never collide with a forwarded one.
pub fn initial_activation_request(
    args: &[String],
    is_startup_switch: impl Fn(&str) -> bool,
) -> Option<ActivationRequest> {
    let mut filtered: Vec<String> = Vec::with_capacity(args.len());
    let mut end_of_options = false;
    for argument in args {
        if !end_of_options {
            if argument == "--" {
                end_of_options = true;
            } else if is_startup_switch(argument) {
                continue;
            }
        }
        filtered.push(argument.clone());
    }
    let (intent, paths) = parse_activation_args(&filtered).ok()?;
    Some(ActivationRequest {
        version: ACTIVATION_VERSION,
        request_id: Uuid::new_v4().to_string(),
        paths,
        sent_unix: now_unix(),
        intent: Some(intent),
    })
}

/// Windows absolute path check that also works on non-Windows test hosts.
/// Matches the UI's `isAbsolutePath` contract: drive or UNC form, no NUL,
/// and no `..` segment (a later resolver must not leave the chosen path).
pub fn is_absolute_activation_path(path: &str) -> bool {
    if path.is_empty() || path.contains('\0') {
        return false;
    }
    if path
        .split(['\\', '/'])
        .any(|part| part == "..")
    {
        return false;
    }
    let bytes = path.as_bytes();
    if bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && (bytes[2] == b'\\' || bytes[2] == b'/')
    {
        return true;
    }
    let Some(rest) = path.strip_prefix(r"\\") else {
        return false;
    };
    let mut parts = rest.splitn(2, ['\\', '/']);
    let server = parts.next().unwrap_or_default();
    let share = parts.next().unwrap_or_default();
    !server.is_empty() && !share.is_empty()
}

pub fn now_unix() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// UUID equality regardless of the textual form the sender used.
pub fn same_uuid(left: &str, right: &str) -> bool {
    matches!(
        (Uuid::parse_str(left), Uuid::parse_str(right)),
        (Ok(left), Ok(right)) if left == right
    )
}

fn normalize_request(request: &mut ActivationRequest) -> Result<(), String> {
    let id = Uuid::parse_str(&request.request_id).map_err(|_| ERR_INVALID.to_string())?;
    request.request_id = id.to_string();
    if request.version != ACTIVATION_VERSION
        || request.paths.is_empty()
        || request.paths.len() > MAX_ACTIVATION_PATHS
        || request.sent_unix > MAX_SAFE_INTEGER
    {
        return Err(ERR_INVALID.to_string());
    }
    for path in &request.paths {
        if !is_absolute_activation_path(path)
            || path.encode_utf16().count() > MAX_PATH_UTF16
        {
            return Err(ERR_INVALID.to_string());
        }
    }
    Ok(())
}

struct QueueInner {
    ready: bool,
    pending: VecDeque<ActivationRequest>,
    seen: VecDeque<(String, Instant)>,
}

/// Bounded activation queue shared by the pipe server and the
/// `activation_ready` command. Requests stay here until the window has
/// installed its listener.
pub struct ActivationQueue {
    inner: Mutex<QueueInner>,
}

impl ActivationQueue {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(QueueInner {
                ready: false,
                pending: VecDeque::new(),
                seen: VecDeque::new(),
            }),
        }
    }

    fn enqueue(&self, request: ActivationRequest) -> Result<ActivationAck, String> {
        let mut inner = self.inner.lock().map_err(|_| ERR_FAILED.to_string())?;
        prune_seen(&mut inner);
        if inner
            .seen
            .iter()
            .any(|(request_id, _)| request_id == &request.request_id)
        {
            return Ok(ActivationAck {
                request_id: request.request_id,
                accepted: true,
                error: None,
            });
        }
        if inner.pending.len() >= MAX_QUEUED_ACTIVATIONS {
            return Ok(ActivationAck {
                request_id: request.request_id,
                accepted: false,
                error: Some(ERR_BUSY.to_string()),
            });
        }
        inner
            .seen
            .push_back((request.request_id.clone(), Instant::now()));
        while inner.seen.len() > ACTIVATION_DEDUPE_CAPACITY {
            inner.seen.pop_front();
        }
        let request_id = request.request_id.clone();
        inner.pending.push_back(request);
        Ok(ActivationAck {
            request_id,
            accepted: true,
            error: None,
        })
    }

    /// Install the ready flag and hand over everything the startup window
    /// missed. Called exactly once by `activation_ready`.
    pub fn mark_ready_and_drain(&self) -> Result<Vec<ActivationRequest>, String> {
        let mut inner = self.inner.lock().map_err(|_| ERR_FAILED.to_string())?;
        inner.ready = true;
        Ok(inner.pending.drain(..).collect())
    }

    /// Requests the pipe server may emit as `activation-open`. Empty until
    /// the frontend has said it is ready, so nothing is delivered twice.
    pub fn drain_for_event(&self) -> Vec<ActivationRequest> {
        let Ok(mut inner) = self.inner.lock() else {
            return Vec::new();
        };
        if !inner.ready {
            return Vec::new();
        }
        inner.pending.drain(..).collect()
    }
}

impl Default for ActivationQueue {
    fn default() -> Self {
        Self::new()
    }
}

fn prune_seen(inner: &mut QueueInner) {
    let now = Instant::now();
    while let Some((_, seen_at)) = inner.seen.front() {
        if now.duration_since(*seen_at) <= ACTIVATION_DEDUPE_WINDOW {
            break;
        }
        inner.seen.pop_front();
    }
}
