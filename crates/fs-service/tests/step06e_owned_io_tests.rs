//! Owned staging and pinned sources (Step 06e T2). Every case checks that a
//! failure touches only what this process created.

use std::io::Write;

use fs_service::owned_io::{
    dispose_orphaned_staging, OwnedIoError, OwnedOutput, PinnedDirectory, PinnedSource,
    SourceIdentity,
};

fn write(path: &std::path::Path, text: &str) {
    std::fs::write(path, text).unwrap();
}

fn read(path: &std::path::Path) -> String {
    std::fs::read_to_string(path).unwrap()
}

#[test]
fn foreign_partial_survives_create_failure() {
    let folder = tempfile::tempdir().unwrap();
    let foreign = folder.path().join("~adp-notes-0000.partial");
    write(&foreign, "foreign");
    let pinned = PinnedDirectory::open(folder.path()).unwrap();

    let result = OwnedOutput::create_named(&pinned, "~adp-notes-0000.partial");

    assert!(matches!(result, Err(OwnedIoError::StagingTaken)));
    assert_eq!(read(&foreign), "foreign", "the other partial is untouched");
    assert_eq!(
        std::fs::read_dir(folder.path()).unwrap().count(),
        1,
        "no owned file was created"
    );
}

#[test]
fn publication_never_replaces_an_arrival() {
    let folder = tempfile::tempdir().unwrap();
    let pinned = PinnedDirectory::open(folder.path()).unwrap();
    let mut output = OwnedOutput::create_named(&pinned, "~adp-report.partial").unwrap();
    output.file_mut().write_all(b"new archive").unwrap();
    let staging = output.staging_path().to_path_buf();

    let target = folder.path().join("report.zip");
    write(&target, "older archive that arrived first");

    let result = output.publish_name("report.zip");
    assert!(matches!(result, Err(OwnedIoError::TargetExists)));
    assert_eq!(read(&target), "older archive that arrived first");
    drop(output);
    assert!(!staging.exists(), "only the owned staging file was cleaned");
    assert_eq!(read(&target), "older archive that arrived first");
}

#[test]
fn cancel_disposes_only_the_owned_handle() {
    let folder = tempfile::tempdir().unwrap();
    let pinned = PinnedDirectory::open(folder.path()).unwrap();
    let mut output = OwnedOutput::create_named(&pinned, "~adp-cancel.partial").unwrap();
    output.file_mut().write_all(b"one chunk").unwrap();
    let staging = output.staging_path().to_path_buf();
    let foreign = folder.path().join("~adp-other.partial");
    write(&foreign, "someone else");

    drop(output);

    assert!(!staging.exists(), "our staging is gone");
    assert_eq!(read(&foreign), "someone else", "the other partial remains");
    assert!(!folder.path().join("cancel.zip").exists());
}

#[test]
fn pinned_ancestor_cannot_be_swapped() {
    let folder = tempfile::tempdir().unwrap();
    let base = folder.path().join("base");
    let inside = base.join("inside");
    std::fs::create_dir_all(&inside).unwrap();
    let pinned = PinnedDirectory::open(&inside).unwrap();
    let mut output = OwnedOutput::create(&pinned, "notes.txt").unwrap();
    output.file_mut().write_all(b"archive").unwrap();

    // Renaming the pinned folder or its ancestor is refused while held.
    let moved = folder.path().join("moved");
    assert!(
        std::fs::rename(&inside, &moved).is_err(),
        "the pinned folder cannot be renamed"
    );
    let moved_base = folder.path().join("moved-base");
    assert!(
        std::fs::rename(&base, &moved_base).is_err(),
        "the pinned ancestor cannot be renamed"
    );
    // Deleting it is refused as well.
    assert!(std::fs::remove_dir(&inside).is_err());

    let published = output.publish_name("archive.zip").unwrap();
    assert!(
        published.starts_with(std::fs::canonicalize(&inside).unwrap()),
        "no write left the pinned folder"
    );
}

#[test]
fn source_guard_refuses_changed_identity() {
    let folder = tempfile::tempdir().unwrap();
    let path = folder.path().join("notes.txt");
    write(&path, "enumerated text");
    let expected = SourceIdentity::capture(&path).unwrap();

    std::fs::remove_file(&path).unwrap();
    write(&path, "a different file with a different size");

    let result = PinnedSource::open(&path, &expected);
    assert!(matches!(result, Err(OwnedIoError::SourceChanged)));
    assert!(!folder.path().join("archive.zip").exists());
}

#[test]
fn flush_failure_leaves_old_names_untouched() {
    let folder = tempfile::tempdir().unwrap();
    let target = folder.path().join("report.zip");
    write(&target, "old archive");
    let pinned = PinnedDirectory::open(folder.path()).unwrap();
    let mut output = OwnedOutput::create_named(&pinned, "~adp-report.partial").unwrap();
    output.file_mut().write_all(b"half written").unwrap();

    let result = output.flush_sync_with(|_| Err(std::io::Error::other("disk said no")));
    assert!(result.is_err());
    drop(output);

    assert_eq!(read(&target), "old archive");
    assert!(!folder.path().join("~adp-report.partial").exists());
}

#[test]
fn a_guarded_source_refuses_writes_while_open() {
    let folder = tempfile::tempdir().unwrap();
    let path = folder.path().join("notes.txt");
    write(&path, "steady");
    let expected = SourceIdentity::capture(&path).unwrap();
    let mut source = PinnedSource::open(&path, &expected).unwrap();

    let mut buffer = String::new();
    use std::io::Read;
    source.file_mut().read_to_string(&mut buffer).unwrap();
    assert_eq!(buffer, "steady");

    let other_writer = std::fs::OpenOptions::new().write(true).open(&path);
    assert!(other_writer.is_err(), "a writer is refused while we read");
    assert!(
        std::fs::remove_file(&path).is_err(),
        "a delete is refused too"
    );
    source.verify_after_read().unwrap();
}

#[test]
fn orphan_cleanup_removes_only_abandoned_staging_files() {
    let folder = tempfile::tempdir().unwrap();
    let pinned = PinnedDirectory::open(folder.path()).unwrap();
    let target = folder.path().join("notes.txt");

    // Left by a helper that was killed: nobody holds it any more.
    let mut abandoned = OwnedOutput::create(&pinned, "notes.txt").unwrap();
    abandoned.keep();
    let abandoned_path = abandoned.staging_path().to_path_buf();
    drop(abandoned);
    // Still being written by a live operation.
    let live = OwnedOutput::create(&pinned, "notes.txt").unwrap();
    // Files that only look similar, and another file's staging.
    let old_style = folder.path().join("~notes.txt.partial");
    let lookalike = folder.path().join("~adp-notes.txt-not-random.partial");
    std::fs::write(&old_style, "keep").unwrap();
    std::fs::write(&lookalike, "keep").unwrap();
    let mut other = OwnedOutput::create(&pinned, "other.txt").unwrap();
    other.keep();
    let other_path = other.staging_path().to_path_buf();
    drop(other);

    assert_eq!(dispose_orphaned_staging(&target), 1);

    assert!(!abandoned_path.exists());
    assert!(live.staging_path().exists());
    assert!(old_style.exists());
    assert!(lookalike.exists());
    assert!(other_path.exists());
}
