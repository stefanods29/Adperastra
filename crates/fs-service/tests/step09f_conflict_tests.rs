//! Conflict choices that must never lose an existing file (step 09f T4).

use std::io::Write;

use fs_service::conflict_policy::{
    merge_allowed, newer_modified_at_authorizes_replace, parse_choice, refuse_replace,
    replace_available, ApplyAll, ApplyScope, ConflictChoice, ConflictKind, PolicyError,
    ReplaceRequest,
};
use fs_service::owned_io::{OwnedOutput, PinnedDirectory};
use fs_service::transfer_conflicts::{
    is_taken, merge_child_action, next_keep_both_name, on_publish_collision, MergeChild,
    PublishCollision,
};
use fs_service::transfer_decisions::DecisionTicket;
use fs_service::SourceStamp;

fn stamp(path: &std::path::Path) -> SourceStamp {
    fs_service::transfer_copy::entry_stamp(path).unwrap()
}

#[test]
fn a_new_foreign_file_is_kept() {
    let destination = tempfile::tempdir().unwrap();
    let foreign = destination.path().join("report.txt");
    std::fs::write(&foreign, b"mine, not yours").unwrap();
    // The window proposed "report (1).txt" and somebody created it first.
    let late = destination.path().join("report (1).txt");
    std::fs::write(&late, b"arrived meanwhile").unwrap();
    let directory = PinnedDirectory::open(destination.path()).unwrap();
    let mut output = OwnedOutput::create(&directory, "report.txt").unwrap();
    output.file_mut().write_all(b"new copy").unwrap();
    output.flush_sync().unwrap();
    assert!(
        output.publish_name("report (1).txt").is_err(),
        "a name that appeared meanwhile is never replaced"
    );
    // The engine chooses the next number instead.
    let next = next_keep_both_name(directory.path(), "report.txt", 2).unwrap();
    assert_eq!(next, "report (2).txt");
    output.publish_name(&next).unwrap();
    assert_eq!(std::fs::read(&foreign).unwrap(), b"mine, not yours");
    assert_eq!(std::fs::read(&late).unwrap(), b"arrived meanwhile");
    assert_eq!(
        std::fs::read(destination.path().join("report (2).txt")).unwrap(),
        b"new copy"
    );
}

#[test]
fn folder_merge_keeps_a_same_named_child() {
    let destination = tempfile::tempdir().unwrap();
    let folder = destination.path().join("Project");
    std::fs::create_dir(&folder).unwrap();
    let child = folder.join("notes.txt");
    std::fs::write(&child, b"existing child").unwrap();
    let source_folder = folder.clone();
    assert_eq!(
        merge_child_action(is_taken(&child), false, false),
        MergeChild::SkipSameNamed
    );
    assert_eq!(
        merge_child_action(is_taken(&source_folder), true, true),
        MergeChild::RecurseFolder
    );
    // Merging into an existing folder is allowed and changes nothing here.
    assert_eq!(merge_allowed(true, true), Ok(()));
    assert_eq!(std::fs::read(&child).unwrap(), b"existing child");
}

#[test]
fn a_stale_decision_has_no_effect() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("a.txt");
    let target = dir.path().join("b.txt");
    std::fs::write(&source, b"source").unwrap();
    std::fs::write(&target, b"target").unwrap();
    let ticket = DecisionTicket {
        decision_id: uuid::Uuid::new_v4(),
        item_id: uuid::Uuid::new_v4(),
        generation: 4,
        source: stamp(&source),
        target: Some(stamp(&target)),
    };
    assert!(ticket.accepts(ticket.decision_id, 4));
    assert!(!ticket.accepts(ticket.decision_id, 5));
    // The conflict changed while the window was open: the answer no longer
    // applies to what is on disk.
    std::fs::write(&target, b"a different item").unwrap();
    assert!(!ticket.target_unchanged(Some(&stamp(&target))));
    assert_eq!(std::fs::read(&target).unwrap(), b"a different item");
}

#[test]
fn replace_and_newer_are_rejected_before_write_or_recycle() {
    let dir = tempfile::tempdir().unwrap();
    let source = dir.path().join("a.txt");
    let target = dir.path().join("b.txt");
    std::fs::write(&source, b"new").unwrap();
    std::fs::write(&target, b"old, might be newer").unwrap();
    assert!(!replace_available());
    assert_eq!(
        parse_choice("replace"),
        Err(PolicyError::ReplaceUnavailable)
    );
    assert_eq!(
        parse_choice("replaceIfNewer"),
        Err(PolicyError::ReplaceUnavailable)
    );
    assert_eq!(
        refuse_replace(ReplaceRequest::ReplaceIfNewer),
        PolicyError::ReplaceUnavailable
    );
    // A newer modification time is a fact, never permission.
    assert!(!newer_modified_at_authorizes_replace(true));
    // The refusal came before anything was written or recycled.
    assert_eq!(std::fs::read(&source).unwrap(), b"new");
    assert_eq!(std::fs::read(&target).unwrap(), b"old, might be newer");

    let mut apply_all = ApplyAll::default();
    let scope = ApplyScope {
        job_generation: 1,
        conflict_kind: ConflictKind::Name,
    };
    apply_all.remember(scope, ConflictChoice::Skip);
    assert_eq!(
        on_publish_collision(ConflictChoice::Skip),
        PublishCollision::SkipItem
    );
    assert_eq!(
        apply_all.for_scope(ApplyScope {
            job_generation: 1,
            conflict_kind: ConflictKind::Error,
        }),
        None
    );
}
