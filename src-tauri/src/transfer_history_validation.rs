//! Prove the objects of an Undo or Redo before replaying it (Step 09f T5).
//!
//! A transfer effect used to record only paths. A path is not an object: by
//! the time the user presses Undo, the file at that path may be a different
//! file, or no file at all. New effects therefore carry the full-precision
//! source stamp of both sides, and replay refuses to start when either side
//! is no longer the reviewed object.
//!
//! Two outcomes are deliberate:
//!
//! * A changed source makes Redo fail with `ops.source_changed`. Redo never
//!   pretends the modified file is the original bytes.
//! * Undoing a *copy* would have to recycle the item that was created. This
//!   build cannot bind a recycle to an object (the same reason Replace is
//!   unavailable), so it refuses with `ops.undo_unavailable` and leaves the
//!   files and the history cursor exactly as they were. Undoing a *move* is
//!   a rename back, which is object-bound and therefore allowed.
//!
//! Legacy effects without stamps keep the behaviour they already had; they
//! are labelled unverified history in the UI.

use std::path::Path;

use fs_service::{SourceStamp, TransferEffect};

/// Why an Undo or Redo must not run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HistoryValidationError {
    /// The source is no longer the recorded object (Redo).
    SourceChanged,
    /// The destination is no longer the recorded object (Undo).
    TargetChanged,
    /// The required object-bound operation cannot be proved safe.
    Unavailable,
}

impl HistoryValidationError {
    pub fn code(self) -> &'static str {
        match self {
            HistoryValidationError::SourceChanged => "ops.source_changed",
            HistoryValidationError::TargetChanged
            | HistoryValidationError::Unavailable => "ops.undo_unavailable",
        }
    }
}

/// True when the item at `path` is still exactly `stamp`.
///
/// Metadata only: the same stamp builder the transfer engine records with,
/// so a file and a folder are both comparable and neither call reads
/// content or recalls an online-only placeholder.
pub fn current_stamp_matches(path: &Path, stamp: &SourceStamp) -> bool {
    match fs_service::transfer_copy::entry_stamp(path) {
        Ok(current) => current == *stamp,
        Err(_) => false,
    }
}

/// Undoing this effect would have to recycle something. That is only ever
/// permitted when the recycle can be tied to the exact object, which this
/// build cannot prove.
pub fn copy_undo_needs_recycle(effect: &TransferEffect) -> bool {
    !effect.source_removed && effect.destination_created
}

/// Validate every effect before the first one is replayed.
///
/// The caller must not touch a file when this returns `Err`: a partial Undo
/// is worse than a refused one, and the history cursor has to stay put.
pub fn validate_before_replay(
    effects: &[TransferEffect],
    reverse: bool,
) -> Result<(), HistoryValidationError> {
    for effect in effects {
        if reverse {
            // A folder move is replayed as a tree/directory effect whose
            // object-bound identity cannot be proved here. Refuse it instead
            // of letting `apply_transfer` rebuild scaffolds and move children
            // by path. Its files and the history cursor stay unchanged.
            if effect.kind != fs_service::TransferKind::File {
                return Err(HistoryValidationError::Unavailable);
            }
            // An empty folder rename is recorded as a file effect, so the
            // kind alone cannot tell it apart. Either side being a folder at
            // replay time refuses the Undo before it moves anything.
            if effect.source_removed && (effect.from.is_dir() || effect.to.is_dir()) {
                return Err(HistoryValidationError::Unavailable);
            }
            if copy_undo_needs_recycle(effect) {
                // Any copy Undo. With a stamp we know it is a new effect and
                // the recycle cannot be bound; without one it is legacy
                // history, which keeps its previous behaviour.
                if effect.after_destination.is_some() {
                    return Err(HistoryValidationError::Unavailable);
                }
                continue;
            }
            if effect.source_removed {
                if let Some(stamp) = &effect.after_destination {
                    if !current_stamp_matches(&effect.to, stamp) {
                        return Err(HistoryValidationError::TargetChanged);
                    }
                }
            }
        } else if let Some(stamp) = &effect.before_source {
            if !current_stamp_matches(&effect.from, stamp) {
                return Err(HistoryValidationError::SourceChanged);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use fs_service::ops::{TransferEffect, TransferKind};

    fn stamp(path: &Path) -> SourceStamp {
        fs_service::capture_source_stamp(path).expect("file stamps are capture-able")
    }

    fn directory_stamp(path: &Path) -> SourceStamp {
        SourceStamp {
            path_key: path.to_string_lossy().to_ascii_lowercase(),
            volume_id: "00112233".to_string(),
            file_id: "0011223344556677".to_string(),
            modified_ticks: "1".to_string(),
            size_bytes: 0,
        }
    }

    fn effect(
        from: &Path,
        to: &Path,
        source_removed: bool,
        destination_created: bool,
        before: Option<SourceStamp>,
        after: Option<SourceStamp>,
    ) -> TransferEffect {
        TransferEffect {
            from: from.to_path_buf(),
            to: to.to_path_buf(),
            kind: TransferKind::File,
            source_removed,
            destination_created,
            before_source: before,
            after_destination: after,
            verified_hash: None,
        }
    }

    #[test]
    fn a_changed_source_fails_redo_before_anything_is_written() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("a.txt");
        let destination = dir.path().join("b.txt");
        std::fs::write(&source, b"original").unwrap();
        std::fs::write(&destination, b"copy").unwrap();
        let recorded = stamp(&source);
        std::fs::write(&source, b"changed elsewhere").unwrap();
        let effect = effect(
            &source,
            &destination,
            false,
            true,
            Some(recorded),
            Some(stamp(&destination)),
        );
        assert_eq!(
            validate_before_replay(&[effect], false),
            Err(HistoryValidationError::SourceChanged)
        );
        assert_eq!(
            HistoryValidationError::SourceChanged.code(),
            "ops.source_changed"
        );
        assert_eq!(std::fs::read(&source).unwrap(), b"changed elsewhere");
        assert_eq!(std::fs::read(&destination).unwrap(), b"copy");
    }

    #[test]
    fn a_changed_target_fails_undo_closed() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("moved.txt");
        let destination = dir.path().join("landed.txt");
        std::fs::write(&source, b"moved back").unwrap();
        std::fs::write(&destination, b"moved").unwrap();
        let effect = effect(
            &source,
            &destination,
            true,
            true,
            Some(stamp(&source)),
            Some(stamp(&destination)),
        );
        // Somebody replaced the landed file after the move.
        std::fs::write(&destination, b"a different file").unwrap();
        assert_eq!(
            validate_before_replay(&[effect], true),
            Err(HistoryValidationError::TargetChanged)
        );
        assert_eq!(
            HistoryValidationError::TargetChanged.code(),
            "ops.undo_unavailable"
        );
        assert_eq!(std::fs::read(&destination).unwrap(), b"a different file");
    }

    #[test]
    fn copy_undo_never_recycles_without_an_object_bound_proof() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("a.txt");
        let destination = dir.path().join("b.txt");
        std::fs::write(&source, b"original").unwrap();
        std::fs::write(&destination, b"copy").unwrap();
        let effect = effect(
            &source,
            &destination,
            false,
            true,
            Some(stamp(&source)),
            Some(stamp(&destination)),
        );
        assert!(copy_undo_needs_recycle(&effect));
        assert_eq!(
            validate_before_replay(&[effect], true),
            Err(HistoryValidationError::Unavailable)
        );
        // Nothing was removed on the way to that answer.
        assert!(destination.is_file());
        assert!(source.is_file());
    }

    #[test]
    fn legacy_effects_keep_their_previous_behaviour() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("a.txt");
        let destination = dir.path().join("b.txt");
        std::fs::write(&source, b"original").unwrap();
        std::fs::write(&destination, b"copy").unwrap();
        let legacy = effect(&source, &destination, false, true, None, None);
        assert_eq!(validate_before_replay(&[legacy], true), Ok(()));
        let legacy_move = effect(&source, &destination, true, true, None, None);
        assert_eq!(validate_before_replay(&[legacy_move], true), Ok(()));
    }

    #[test]
    fn a_fully_matching_move_undo_is_allowed() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("moved.txt");
        let destination = dir.path().join("landed.txt");
        std::fs::write(&source, b"payload").unwrap();
        std::fs::write(&destination, b"payload").unwrap();
        let effect = effect(
            &source,
            &destination,
            true,
            true,
            Some(stamp(&source)),
            Some(stamp(&destination)),
        );
        assert_eq!(validate_before_replay(std::slice::from_ref(&effect), true), Ok(()));
        assert_eq!(validate_before_replay(std::slice::from_ref(&effect), false), Ok(()));
    }

    #[test]
    fn a_folder_move_undo_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("moved-folder");
        let destination = dir.path().join("landed-folder");
        std::fs::create_dir(&source).unwrap();
        std::fs::create_dir(&destination).unwrap();
        let mut folder = effect(
            &source,
            &destination,
            true,
            true,
            Some(directory_stamp(&source)),
            Some(directory_stamp(&destination)),
        );
        folder.kind = TransferKind::Tree;
        assert_eq!(
            validate_before_replay(&[folder.clone()], true),
            Err(HistoryValidationError::Unavailable)
        );
        folder.kind = TransferKind::Directory;
        assert_eq!(
            validate_before_replay(&[folder.clone()], true),
            Err(HistoryValidationError::Unavailable)
        );
        // An empty folder rename is recorded as a file effect.
        folder.kind = TransferKind::File;
        assert_eq!(
            validate_before_replay(&[folder], true),
            Err(HistoryValidationError::Unavailable)
        );
        // Both folders are still where they were.
        assert!(source.is_dir());
        assert!(destination.is_dir());
    }

    #[test]
    fn an_empty_plan_replays_nothing_and_reports_nothing() {
        let temp = tempfile::tempdir().unwrap();
        assert_eq!(validate_before_replay(&[], true), Ok(()));
        assert_eq!(validate_before_replay(&[], false), Ok(()));
        assert!(temp.path().is_dir());
    }
}
