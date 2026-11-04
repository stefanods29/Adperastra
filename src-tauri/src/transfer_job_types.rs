//! Wire shapes of the controlled transfer queue (Step 09f, `transfer-jobs-1`).
//!
//! Everything here is data and validation: no disk access, no Tauri types,
//! so the rules can be tested without a window. Native fields are snake_case;
//! the TypeScript mirrors in `src/services/transferJobs.ts` use the same
//! names, and only the outer invoke arguments are camelCase.
//!
//! Replace is not part of these shapes. `conflict` is a plain string so a
//! request that says `replace` is refused *by name* with
//! `ops.replace_unavailable` instead of failing as an unknown value, and the
//! UI union stays `skip | keepBoth | merge`.
#![allow(dead_code)]


use std::path::PathBuf;

use fs_service::conflict_policy::{self, ConflictChoice, PolicyError};
use fs_service::{OpProgress, SourceStamp};
use serde::{Deserialize, Serialize};

/// Top-level items one transfer may name.
pub const MAX_TRANSFER_SOURCES: usize = 10_000;
/// Length limit shared with the rest of the app for one path.
pub const MAX_PATH_UTF16: usize = 32_768;
/// Items in one report page.
pub const MAX_REPORT_ITEMS: usize = 200;
/// Serialized size limit of one report page.
pub const MAX_REPORT_BYTES: usize = 768 * 1024;
/// Report cursors one job may hand out.
pub const MAX_REPORT_PAGES: usize = 64;
/// A report cursor is valid for five minutes.
pub const REPORT_CURSOR_TTL_SECS: u64 = 300;
/// Registered (unfinished) transfer jobs.
pub const MAX_REGISTERED_JOBS: usize = 32;
/// Transfers executing at the same time, across all volumes.
pub const MAX_GLOBAL_TRANSFERS: usize = 2;
/// Transfers executing per destination volume.
pub const MAX_PER_VOLUME_TRANSFERS: usize = 1;
/// A size that survives a round trip through a JavaScript number.
pub const MAX_WIRE_SIZE: u64 = (1 << 53) - 1;
/// Longest path key a stamp may carry.
pub const MAX_STAMP_PATH_UTF16: usize = 32_768;

/// Copy or move.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferKind {
    Copy,
    Move,
}

impl TransferKind {
    pub fn as_code(self) -> &'static str {
        match self {
            TransferKind::Copy => "copy",
            TransferKind::Move => "move",
        }
    }
}

/// What the job is doing right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TransferPhase {
    Queued,
    Running,
    Paused,
    AwaitingConflict,
    AwaitingError,
    Cancelling,
    Done,
}

/// Foreground jobs may take the thread priority of the whole app.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferPriority {
    #[default]
    Normal,
    Foreground,
}

/// How one item ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransferItemStatus {
    Done,
    Skipped,
    Failed,
    Cancelled,
}

impl TransferItemStatus {
    pub fn as_code(self) -> &'static str {
        match self {
            TransferItemStatus::Done => "done",
            TransferItemStatus::Skipped => "skipped",
            TransferItemStatus::Failed => "failed",
            TransferItemStatus::Cancelled => "cancelled",
        }
    }
}

fn default_conflict() -> String {
    "skip".to_string()
}

/// What the UI asks for. One struct, validated once, before anything moves.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferRequest {
    pub kind: TransferKind,
    pub sources: Vec<String>,
    /// Reviewed source identities, one per entry of `sources` in the same
    /// order. Omitted by ordinary manual copies; never inferred from a
    /// preview the user did not see.
    #[serde(default)]
    pub expected_sources: Option<Vec<SourceStamp>>,
    pub dest_dir: String,
    #[serde(default = "default_conflict")]
    pub conflict: String,
    /// `None` means "use the setting" (`transfers.verify_copies`).
    #[serde(default)]
    pub verify: Option<bool>,
    #[serde(default)]
    pub allow_system: bool,
    #[serde(default)]
    pub priority: TransferPriority,
}

/// The request after validation, with parsed enums and real paths.
#[derive(Debug, Clone)]
pub struct ResolvedRequest {
    pub kind: TransferKind,
    pub sources: Vec<PathBuf>,
    pub expected: Option<Vec<SourceStamp>>,
    pub dest_dir: PathBuf,
    pub conflict: ConflictChoice,
    pub verify: bool,
    pub allow_system: bool,
    pub priority: TransferPriority,
}

/// The question the window is asking, bound to a generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferDecisionRequest {
    pub decision_id: String,
    pub item_id: String,
    /// `conflict` or `error`.
    pub kind: String,
    pub source_path: String,
    #[serde(default)]
    pub target_path: Option<String>,
    #[serde(default)]
    pub source: Option<SourceStamp>,
    #[serde(default)]
    pub target: Option<SourceStamp>,
    #[serde(default)]
    pub source_kind: Option<String>,
    #[serde(default)]
    pub target_kind: Option<String>,
    #[serde(default)]
    pub error_code: Option<String>,
    pub attempt: u8,
    pub allowed: Vec<String>,
    /// Always false in this interface revision (`replace-capability-0`).
    pub replace_available: bool,
}

/// The answer. No variant of this struct can ask for a replacement.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferDecision {
    pub decision_id: String,
    pub generation: u64,
    pub action: String,
    #[serde(default)]
    pub apply_to_all: bool,
}

/// Pause, resume, skip the current item, or cancel.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferControl {
    pub action: String,
    /// The generation the window last saw; a stale number changes nothing.
    pub expected_generation: u64,
}

/// One line of the report. Paths stay complete; only the UI truncates them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransferItemResult {
    pub item_id: String,
    pub from: String,
    #[serde(default)]
    pub to: Option<String>,
    pub status: TransferItemStatus,
    #[serde(default)]
    pub reason: Option<String>,
    pub bytes_written: u64,
    pub verified: bool,
    pub source_removed: bool,
    pub destination_created: bool,
}

/// One page of the report.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TransferReport {
    pub report_id: String,
    #[serde(default)]
    pub transfer_id: Option<String>,
    pub items: Vec<TransferItemResult>,
    #[serde(default)]
    pub next_cursor: Option<String>,
    pub done: u32,
    pub skipped: u32,
    pub failed: u32,
    pub cancelled: bool,
    /// The job itself finished (as opposed to this page ending).
    pub job_finished: bool,
    /// False while more pages exist.
    pub complete: bool,
    pub replace_available: bool,
}

/// One observable state of a job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferState {
    pub job_id: String,
    pub state: TransferPhase,
    pub progress: OpProgress,
    #[serde(default)]
    pub bytes_per_second: Option<f64>,
    #[serde(default)]
    pub eta_seconds: Option<u64>,
    #[serde(default)]
    pub current_item_id: Option<String>,
    #[serde(default)]
    pub decision: Option<TransferDecisionRequest>,
    pub generation: u64,
}

/// Every refusal of this area, as a stable code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransferError {
    InvalidRequest,
    QueueFull,
    /// The job's generation moved on (a stale answer or control).
    Changed,
    /// A source is no longer the reviewed object.
    SourceChanged,
    /// A file is held by another program.
    InUse,
    /// The read-back did not match.
    VerifyFailed,
    /// The answer belongs to a conflict that is no longer current.
    DecisionStale,
    /// Replace, or replace-if-newer, was requested.
    ReplaceUnavailable,
    /// Undo cannot be proved safe for this object.
    UndoUnavailable,
    /// Undo history has no room for this job's exact effects.
    UndoLimit,
    Io,
    NoSpace,
    Cancelled,
}

impl TransferError {
    pub fn code(self) -> &'static str {
        match self {
            TransferError::InvalidRequest => "ops.invalid_request",
            TransferError::QueueFull => "ops.queue_full",
            TransferError::Changed => "ops.changed",
            TransferError::SourceChanged => "ops.source_changed",
            TransferError::InUse => "ops.in_use",
            TransferError::VerifyFailed => "ops.verify_failed",
            TransferError::DecisionStale => "ops.decision_stale",
            TransferError::ReplaceUnavailable => "ops.replace_unavailable",
            TransferError::UndoUnavailable => "ops.undo_unavailable",
            TransferError::UndoLimit => "ops.undo_limit",
            TransferError::Io => "ops.io",
            TransferError::NoSpace => "ops.no_space",
            TransferError::Cancelled => "ops.cancelled",
        }
    }

    /// The string a Tauri command returns.
    pub fn to_code(self) -> String {
        self.code().to_string()
    }
}

impl From<TransferError> for String {
    fn from(error: TransferError) -> Self {
        error.to_code()
    }
}

impl From<PolicyError> for TransferError {
    fn from(error: PolicyError) -> Self {
        match error {
            PolicyError::ReplaceUnavailable => TransferError::ReplaceUnavailable,
            PolicyError::Invalid | PolicyError::MergeNeedsFolders => {
                TransferError::InvalidRequest
            }
        }
    }
}

/// A path the app may touch: absolute, bounded, never with `..`.
pub fn validate_path(text: &str) -> Result<PathBuf, TransferError> {
    if text.is_empty() || text.encode_utf16().count() > MAX_PATH_UTF16 {
        return Err(TransferError::InvalidRequest);
    }
    let path = PathBuf::from(text);
    if !path.is_absolute() {
        return Err(TransferError::InvalidRequest);
    }
    if path
        .components()
        .any(|component| matches!(component, std::path::Component::ParentDir))
    {
        return Err(TransferError::InvalidRequest);
    }
    Ok(path)
}

fn is_lower_hex(text: &str, width: usize) -> bool {
    text.len() == width
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// A stamp is either complete and well formed, or the request is refused.
pub fn validate_stamp(stamp: &SourceStamp) -> Result<(), TransferError> {
    if stamp.path_key.is_empty()
        || stamp.path_key.encode_utf16().count() > MAX_STAMP_PATH_UTF16
        || !is_lower_hex(&stamp.volume_id, 8)
        || !is_lower_hex(&stamp.file_id, 16)
        || stamp.modified_ticks.is_empty()
        || stamp.modified_ticks.len() > 20
        || !stamp.modified_ticks.bytes().all(|byte| byte.is_ascii_digit())
        || stamp.size_bytes > MAX_WIRE_SIZE
    {
        return Err(TransferError::InvalidRequest);
    }
    Ok(())
}

/// `expected_sources` must name the same items in the same order. A shorter,
/// longer, reordered or malformed array is refused: a reviewed list cannot
/// be silently permuted after approval.
pub fn expected_sources_check(
    sources: &[PathBuf],
    expected: Option<&[SourceStamp]>,
) -> Result<(), TransferError> {
    let Some(expected) = expected else {
        return Ok(());
    };
    if expected.len() != sources.len() {
        return Err(TransferError::InvalidRequest);
    }
    for (stamp, source) in expected.iter().zip(sources) {
        validate_stamp(stamp)?;
        if !fs_service::transfer_conflicts::stamp_matches_path(stamp, source) {
            return Err(TransferError::InvalidRequest);
        }
    }
    Ok(())
}

/// Validate the whole request. `verify_default` is the current setting.
pub fn resolve_request(
    request: TransferRequest,
    verify_default: bool,
) -> Result<ResolvedRequest, TransferError> {
    if request.sources.is_empty() || request.sources.len() > MAX_TRANSFER_SOURCES {
        return Err(TransferError::InvalidRequest);
    }
    let mut sources = Vec::with_capacity(request.sources.len());
    for text in &request.sources {
        sources.push(validate_path(text)?);
    }
    let dest_dir = validate_path(&request.dest_dir)?;
    // Refused before anything else can happen: no version hook, no recycle,
    // no staging file.
    let conflict = conflict_policy::parse_choice(&request.conflict)?;
    expected_sources_check(&sources, request.expected_sources.as_deref())?;
    Ok(ResolvedRequest {
        kind: request.kind,
        sources,
        expected: request.expected_sources,
        dest_dir,
        conflict,
        verify: request.verify.unwrap_or(verify_default),
        allow_system: request.allow_system,
        priority: request.priority,
    })
}

/// The four words `transfer_control` accepts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ControlAction {
    Pause,
    Resume,
    SkipCurrent,
    Cancel,
}

/// Parse a control word; anything else is refused before it touches a job.
pub fn parse_control(action: &str) -> Result<ControlAction, TransferError> {
    match action {
        "pause" => Ok(ControlAction::Pause),
        "resume" => Ok(ControlAction::Resume),
        "skip_current" => Ok(ControlAction::SkipCurrent),
        "cancel" => Ok(ControlAction::Cancel),
        _ => Err(TransferError::InvalidRequest),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stamp(key: &str) -> SourceStamp {
        SourceStamp {
            path_key: key.to_string(),
            volume_id: "1a2b3c4d".to_string(),
            file_id: "00000000000000ff".to_string(),
            modified_ticks: "133500000000000000".to_string(),
            size_bytes: 4,
        }
    }

    fn request(sources: &[&str], dest: &str) -> TransferRequest {
        TransferRequest {
            kind: TransferKind::Copy,
            sources: sources.iter().map(|text| (*text).to_string()).collect(),
            expected_sources: None,
            dest_dir: dest.to_string(),
            conflict: "skip".to_string(),
            verify: None,
            allow_system: false,
            priority: TransferPriority::Normal,
        }
    }

    #[test]
    fn replace_is_refused_by_name_before_anything_else() {
        let mut ask = request(&[r"C:\A\a.txt"], r"C:\B");
        ask.conflict = "replace".to_string();
        assert_eq!(
            resolve_request(ask, false).unwrap_err(),
            TransferError::ReplaceUnavailable
        );
        assert_eq!(TransferError::ReplaceUnavailable.code(), "ops.replace_unavailable");
    }

    #[test]
    fn expected_sources_length_and_order_must_match() {
        let sources = [PathBuf::from(r"C:\A\a.txt"), PathBuf::from(r"C:\A\b.txt")];
        assert!(expected_sources_check(&sources, None).is_ok());
        let good = vec![stamp(r"C:\A\a.txt"), stamp(r"C:\A\b.txt")];
        assert!(expected_sources_check(&sources, Some(&good)).is_ok());
        let swapped = vec![stamp(r"C:\A\b.txt"), stamp(r"C:\A\a.txt")];
        assert_eq!(
            expected_sources_check(&sources, Some(&swapped)),
            Err(TransferError::InvalidRequest)
        );
        assert_eq!(
            expected_sources_check(&sources, Some(&good[..1])),
            Err(TransferError::InvalidRequest)
        );
        let mut malformed = good.clone();
        malformed[0].volume_id = "XYZ".to_string();
        assert_eq!(
            expected_sources_check(&sources, Some(&malformed)),
            Err(TransferError::InvalidRequest)
        );
    }

    #[test]
    fn relative_and_dotdot_paths_are_refused() {
        assert!(validate_path(r"C:\A\a.txt").is_ok());
        assert_eq!(validate_path("a.txt"), Err(TransferError::InvalidRequest));
        assert_eq!(
            validate_path(r"C:\A\..\b.txt"),
            Err(TransferError::InvalidRequest)
        );
        assert_eq!(validate_path(""), Err(TransferError::InvalidRequest));
    }

    #[test]
    fn sizes_above_the_wire_limit_are_refused() {
        let mut large = stamp(r"C:\A\a.txt");
        large.size_bytes = MAX_WIRE_SIZE + 1;
        assert_eq!(validate_stamp(&large), Err(TransferError::InvalidRequest));
    }

    #[test]
    fn verify_falls_back_to_the_setting_only_when_omitted() {
        let ask = request(&[r"C:\A\a.txt"], r"C:\B");
        assert!(resolve_request(ask.clone(), true).unwrap().verify);
        let mut asked = ask;
        asked.verify = Some(false);
        assert!(!resolve_request(asked, true).unwrap().verify);
    }
}
