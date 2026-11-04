//! What a copy or move may do when a name is already in use (Step 09f D7).
//!
//! Replace is *fixed unavailable* for the `transfer-jobs-1` /
//! `replace-capability-0` interface. A request that names it is refused
//! before the version hook, before anything is recycled and before a single
//! staging byte is written. No amount of metadata agreement makes it
//! allowed: comparing modification times is not proof that the item the user
//! saw is the item that would be removed, so it never authorizes a
//! replacement.
//!
//! This module is deliberately the only place that answers the question, so
//! the UI can show a disabled action with a reason instead of discovering
//! the refusal after work started.

/// The published Replace capability. `false` until an independently reviewed
/// object-bound recycle-first protocol exists (contract 10, Step 03b).
pub const REPLACE_CAPABILITY: bool = false;

/// Why a conflict choice was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyError {
    /// The request asked for a capability this build does not have.
    ReplaceUnavailable,
    /// The code is not a conflict choice this build understands.
    Invalid,
    /// Merge was asked for two items that are not both folders.
    MergeNeedsFolders,
}

impl PolicyError {
    /// Stable error code; the UI translates `errors.<area>.<code>`.
    pub fn code(self) -> &'static str {
        match self {
            PolicyError::ReplaceUnavailable => "ops.replace_unavailable",
            PolicyError::Invalid => "ops.invalid_request",
            PolicyError::MergeNeedsFolders => "ops.kind_mismatch",
        }
    }
}

/// The choices a user can actually make today.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictChoice {
    Skip,
    KeepBoth,
    Merge,
}

impl ConflictChoice {
    pub fn as_code(self) -> &'static str {
        match self {
            ConflictChoice::Skip => "skip",
            ConflictChoice::KeepBoth => "keepBoth",
            ConflictChoice::Merge => "merge",
        }
    }

    pub fn parse(code: &str) -> Result<Self, PolicyError> {
        match code {
            "skip" => Ok(ConflictChoice::Skip),
            "keepBoth" | "keepboth" => Ok(ConflictChoice::KeepBoth),
            "merge" => Ok(ConflictChoice::Merge),
            _ => Err(PolicyError::Invalid),
        }
    }
}

/// Requested-but-unavailable replacements, recognised only so they can be
/// refused by name instead of looking like a typo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReplaceRequest {
    Replace,
    ReplaceIfNewer,
}

impl ReplaceRequest {
    pub fn parse(code: &str) -> Option<Self> {
        match code {
            "replace" => Some(ReplaceRequest::Replace),
            "replaceIfNewer" | "replace_if_newer" => Some(ReplaceRequest::ReplaceIfNewer),
            _ => None,
        }
    }
}

/// True when this build may replace an existing item. Always `false`.
pub fn replace_available() -> bool {
    REPLACE_CAPABILITY
}

/// Refuse a replacement request. Never returns `Ok`, so a caller cannot
/// accidentally treat "asked but unavailable" as permission.
pub fn refuse_replace(_request: ReplaceRequest) -> PolicyError {
    PolicyError::ReplaceUnavailable
}

/// A modification-time comparison is a display fact, never permission.
///
/// Kept as a named function so a future review can find every place that is
/// tempted to use it as an authorization.
pub fn newer_modified_at_authorizes_replace(_source_newer: bool) -> bool {
    REPLACE_CAPABILITY
}

/// Turn a wire code into the choice the engine will honour. This is the one
/// validation entry point for a request's `conflict` field.
pub fn parse_choice(code: &str) -> Result<ConflictChoice, PolicyError> {
    if ReplaceRequest::parse(code).is_some() {
        return Err(refuse_replace(
            ReplaceRequest::parse(code).expect("checked above"),
        ));
    }
    ConflictChoice::parse(code)
}

/// Merge is a folder operation. Adding the new items of a folder into an
/// existing folder never touches a same-named child file: the child is
/// skipped and reported.
pub fn merge_allowed(source_is_folder: bool, target_is_folder: bool) -> Result<(), PolicyError> {
    if source_is_folder && target_is_folder {
        Ok(())
    } else {
        Err(PolicyError::MergeNeedsFolders)
    }
}

/// Where an "apply to all" answer is allowed to reach: the same kind of
/// conflict, inside the same job. Nothing else.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ApplyScope {
    pub job_generation: u64,
    pub conflict_kind: ConflictKind,
}

/// The two shapes a conflict decision can have.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictKind {
    /// A name is already in use (`awaiting_conflict`).
    Name,
    /// A file could not be read, is in use, or hit an I/O error.
    Error,
}

impl ConflictKind {
    pub fn as_code(self) -> &'static str {
        match self {
            ConflictKind::Name => "conflict",
            ConflictKind::Error => "error",
        }
    }
}

/// An "apply to all" answer, remembered only for its own scope.
#[derive(Debug, Clone, Default)]
pub struct ApplyAll {
    answer: Option<(ApplyScope, ConflictChoice)>,
}

impl ApplyAll {
    pub fn remember(&mut self, scope: ApplyScope, choice: ConflictChoice) {
        self.answer = Some((scope, choice));
    }

    /// The remembered choice, when this conflict has the same kind inside
    /// the same job generation. A new generation (a new job) forgets it.
    pub fn for_scope(&self, scope: ApplyScope) -> Option<ConflictChoice> {
        match self.answer {
            Some((remembered, choice)) if remembered == scope => Some(choice),
            _ => None,
        }
    }

    pub fn clear(&mut self) {
        self.answer = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replace_requests_are_refused_by_name() {
        assert_eq!(
            parse_choice("replace"),
            Err(PolicyError::ReplaceUnavailable)
        );
        assert_eq!(
            parse_choice("replaceIfNewer"),
            Err(PolicyError::ReplaceUnavailable)
        );
        assert_eq!(
            parse_choice("replace").unwrap_err().code(),
            "ops.replace_unavailable"
        );
        assert!(!replace_available());
    }

    #[test]
    fn mtime_never_authorizes_replacement() {
        assert!(!newer_modified_at_authorizes_replace(true));
        assert!(!newer_modified_at_authorizes_replace(false));
    }

    #[test]
    fn merge_is_only_for_two_folders() {
        assert_eq!(merge_allowed(true, true), Ok(()));
        assert_eq!(
            merge_allowed(true, false),
            Err(PolicyError::MergeNeedsFolders)
        );
        assert_eq!(
            merge_allowed(false, false),
            Err(PolicyError::MergeNeedsFolders)
        );
    }

    #[test]
    fn apply_all_is_scoped_to_its_own_conflict_kind_and_job() {
        let mut apply_all = ApplyAll::default();
        let scope = ApplyScope {
            job_generation: 3,
            conflict_kind: ConflictKind::Name,
        };
        apply_all.remember(scope, ConflictChoice::KeepBoth);
        assert_eq!(apply_all.for_scope(scope), Some(ConflictChoice::KeepBoth));
        assert_eq!(
            apply_all.for_scope(ApplyScope {
                job_generation: 3,
                conflict_kind: ConflictKind::Error,
            }),
            None
        );
        assert_eq!(
            apply_all.for_scope(ApplyScope {
                job_generation: 4,
                conflict_kind: ConflictKind::Name,
            }),
            None
        );
    }

    #[test]
    fn every_published_choice_round_trips() {
        for choice in [
            ConflictChoice::Skip,
            ConflictChoice::KeepBoth,
            ConflictChoice::Merge,
        ] {
            assert_eq!(ConflictChoice::parse(choice.as_code()), Ok(choice));
        }
    }
}
