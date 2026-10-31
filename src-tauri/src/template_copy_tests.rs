use super::*;
use std::sync::atomic::Ordering;

#[path = "template_copy_test_junction.rs"]
mod junction;

struct Fixture {
    _temp: tempfile::TempDir,
    root: PathBuf,
    source: PathBuf,
    dest: PathBuf,
}

impl Fixture {
    fn new(bytes: &[u8]) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("templates");
        let dest = temp.path().join("destination");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&dest).unwrap();
        let source = root.join("source.docx");
        fs::write(&source, bytes).unwrap();
        Self {
            _temp: temp,
            root,
            source,
            dest,
        }
    }

    fn copy(&self, progress: impl FnMut(&OpProgress)) -> Result<PathBuf, String> {
        copy_template_with_progress(
            &self.source,
            &self.dest,
            "Letter.docx",
            std::slice::from_ref(&self.root),
            &fs_service::new_cancellation_token(),
            progress,
        )
    }
}

#[test]
fn an_existing_partial_is_never_changed_or_removed() {
    let fixture = Fixture::new(b"template");
    let sentinel = fixture.dest.join("~Letter.docx.partial");
    fs::write(&sentinel, b"user data").unwrap();
    let copied = fixture.copy(|_| {}).unwrap();
    assert_eq!(fs::read(copied).unwrap(), b"template");
    assert_eq!(fs::read(&sentinel).unwrap(), b"user data");
    assert_eq!(fs::read_dir(&fixture.dest).unwrap().count(), 2);
}

#[test]
fn a_hard_link_at_the_partial_name_cannot_redirect_a_write() {
    let fixture = Fixture::new(b"template");
    let sentinel = fixture._temp.path().join("outside.txt");
    fs::write(&sentinel, b"outside user data").unwrap();
    fs::hard_link(&sentinel, fixture.dest.join("~Letter.docx.partial")).unwrap();
    fixture.copy(|_| {}).unwrap();
    assert_eq!(fs::read(sentinel).unwrap(), b"outside user data");
}

#[test]
fn a_destination_created_during_copy_survives_publication() {
    let fixture = Fixture::new(&vec![7; COPY_CHUNK_BYTES + 1]);
    let sentinel = fixture.dest.join("Letter.docx");
    let mut inserted = false;
    let copied = fixture
        .copy(|progress| {
            if progress.bytes_done > 0 && !inserted {
                fs::write(&sentinel, b"created by another program").unwrap();
                inserted = true;
            }
        })
        .unwrap();
    assert!(inserted);
    assert_eq!(copied.file_name().unwrap(), "Letter (1).docx");
    assert_eq!(fs::read(sentinel).unwrap(), b"created by another program");
    assert_eq!(
        fs::metadata(copied).unwrap().len(),
        (COPY_CHUNK_BYTES + 1) as u64
    );
}

#[test]
fn exhausted_names_leave_all_existing_targets_untouched() {
    let fixture = Fixture::new(b"template");
    for name in ["Letter.docx", "Letter (1).docx", "Letter (2).docx"] {
        fs::write(fixture.dest.join(name), name.as_bytes()).unwrap();
    }
    let result = copy_with_limit(
        &fixture.source,
        &fixture.dest,
        "Letter.docx",
        std::slice::from_ref(&fixture.root),
        &fs_service::new_cancellation_token(),
        |_| {},
        3,
    );
    assert_eq!(result.unwrap_err(), "templates.other");
    for name in ["Letter.docx", "Letter (1).docx", "Letter (2).docx"] {
        assert_eq!(fs::read(fixture.dest.join(name)).unwrap(), name.as_bytes());
    }
    assert_eq!(fs::read_dir(&fixture.dest).unwrap().count(), 3);
}

#[test]
fn cancellation_removes_only_this_operations_owned_partial() {
    let fixture = Fixture::new(&vec![9; COPY_CHUNK_BYTES * 2]);
    let sentinel = fixture.dest.join("~Letter.docx.partial");
    fs::write(&sentinel, b"existing partial").unwrap();
    let token = fs_service::new_cancellation_token();
    let result = copy_template_with_progress(
        &fixture.source,
        &fixture.dest,
        "Letter.docx",
        std::slice::from_ref(&fixture.root),
        &token,
        |progress| {
            if progress.bytes_done > 0 {
                token.store(true, Ordering::Relaxed);
            }
        },
    );
    assert_eq!(result.unwrap_err(), "templates.cancelled");
    assert_eq!(fs::read(sentinel).unwrap(), b"existing partial");
    assert_eq!(fs::read_dir(&fixture.dest).unwrap().count(), 1);
}

#[test]
fn an_owned_partial_cannot_be_replaced_before_cleanup() {
    let fixture = Fixture::new(b"template");
    let token = fs_service::new_cancellation_token();
    let mut checked = false;
    let result = copy_template_with_progress(
        &fixture.source,
        &fixture.dest,
        "Letter.docx",
        std::slice::from_ref(&fixture.root),
        &token,
        |progress| {
            if progress.bytes_done > 0 && !checked {
                let partial = fixture.dest.join("~Letter.docx.partial");
                assert!(fs::rename(&partial, fixture.dest.join("stolen")).is_err());
                assert!(fs::write(&partial, b"replacement").is_err());
                token.store(true, Ordering::Relaxed);
                checked = true;
            }
        },
    );
    assert!(checked);
    assert_eq!(result.unwrap_err(), "templates.cancelled");
    assert_eq!(fs::read_dir(&fixture.dest).unwrap().count(), 0);
}

#[test]
fn source_errors_do_not_delete_an_existing_partial() {
    let fixture = Fixture::new(b"template");
    let sentinel = fixture.dest.join("~Letter.docx.partial");
    fs::write(&sentinel, b"existing partial").unwrap();
    let result = copy_template_with_progress(
        &fixture.root.join("missing.docx"),
        &fixture.dest,
        "Letter.docx",
        std::slice::from_ref(&fixture.root),
        &fs_service::new_cancellation_token(),
        |_| {},
    );
    assert_eq!(result.unwrap_err(), "templates.not_found");
    assert_eq!(fs::read(sentinel).unwrap(), b"existing partial");
}

#[test]
fn a_source_outside_every_authorized_root_is_refused() {
    let fixture = Fixture::new(b"template");
    let result = copy_template_with_progress(
        &fixture.source,
        &fixture.dest,
        "Letter.docx",
        std::slice::from_ref(&fixture.dest),
        &fs_service::new_cancellation_token(),
        |_| {},
    );
    assert_eq!(result.unwrap_err(), "templates.not_allowed");
    assert_eq!(fs::read_dir(&fixture.dest).unwrap().count(), 0);
}

#[test]
fn a_junction_cannot_authorize_a_source_outside_the_root() {
    let fixture = Fixture::new(b"template");
    let outside = fixture._temp.path().join("outside");
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("source.docx"), b"outside bytes").unwrap();
    let link = fixture.root.join("link");
    junction::create(&link, &outside).unwrap();
    let result = copy_template_with_progress(
        &link.join("source.docx"),
        &fixture.dest,
        "Letter.docx",
        std::slice::from_ref(&fixture.root),
        &fs_service::new_cancellation_token(),
        |_| {},
    );
    assert_eq!(result.unwrap_err(), "templates.not_allowed");
    assert_eq!(fs::read_dir(&fixture.dest).unwrap().count(), 0);
    fs::remove_dir(link).unwrap();
}

#[test]
fn replacing_a_junction_after_authorization_does_not_change_the_copied_bytes() {
    let fixture = Fixture::new(b"template");
    let inside = fixture.root.join("inside");
    let outside = fixture._temp.path().join("outside");
    fs::create_dir(&inside).unwrap();
    fs::create_dir(&outside).unwrap();
    fs::write(inside.join("source.docx"), b"authorized bytes").unwrap();
    fs::write(outside.join("source.docx"), b"outside bytes").unwrap();
    let link = fixture.root.join("link");
    junction::create(&link, &inside).unwrap();
    let mut replaced = false;
    let copied = copy_template_with_progress(
        &link.join("source.docx"),
        &fixture.dest,
        "Letter.docx",
        std::slice::from_ref(&fixture.root),
        &fs_service::new_cancellation_token(),
        |progress| {
            if progress.bytes_done == 0 && !replaced {
                fs::remove_dir(&link).unwrap();
                junction::create(&link, &outside).unwrap();
                replaced = true;
            }
        },
    )
    .unwrap();
    assert!(replaced);
    assert_eq!(fs::read(copied).unwrap(), b"authorized bytes");
    assert_eq!(
        fs::read(outside.join("source.docx")).unwrap(),
        b"outside bytes"
    );
    fs::remove_dir(link).unwrap();
}

#[test]
fn copying_reports_bytes_and_finishes_with_one_completed_item() {
    let fixture = Fixture::new(&vec![3; COPY_CHUNK_BYTES + 1]);
    let mut updates = Vec::new();
    fixture
        .copy(|progress| updates.push(progress.clone()))
        .unwrap();
    assert_eq!(updates.first().unwrap().bytes_done, 0);
    assert!(updates
        .windows(2)
        .all(|pair| pair[0].bytes_done <= pair[1].bytes_done));
    assert!(updates
        .iter()
        .any(|progress| progress.bytes_done == COPY_CHUNK_BYTES as u64));
    let last = updates.last().unwrap();
    assert_eq!(last.items_done, 1);
    assert_eq!(last.bytes_done, (COPY_CHUNK_BYTES + 1) as u64);
    assert_eq!(last.bytes_done, last.bytes_total);
}
