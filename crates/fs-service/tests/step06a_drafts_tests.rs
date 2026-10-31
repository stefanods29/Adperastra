//! Step 06a: recovery copies of unsaved text.

use std::time::Duration;

use fs_service::{
    delete_draft, draft_key, read_draft, write_draft, Draft, DRAFTS_SCHEMA, MAX_DRAFTS,
    MAX_DRAFT_BYTES,
};

fn draft(path: &str, text: &str) -> Draft {
    Draft {
        schema_version: DRAFTS_SCHEMA,
        path: path.to_string(),
        text: text.to_string(),
        saved_unix: 10,
        file_modified_unix: 5,
    }
}

#[test]
fn draft_key_ignores_case_and_the_long_path_prefix() {
    let plain = draft_key(r"C:\A\b.txt");
    assert_eq!(plain.len(), 16);
    assert_eq!(draft_key(r"c:\a\B.TXT"), plain);
    assert_eq!(draft_key(r"\\?\C:\A\b.txt"), plain);
    assert_ne!(draft_key(r"C:\A\c.txt"), plain);
}

#[test]
fn writes_reads_and_deletes_a_draft() {
    let dir = tempfile::tempdir().unwrap();
    let written = draft(r"C:\A\b.txt", "unsaved");

    write_draft(dir.path(), &written).unwrap();
    assert_eq!(read_draft(dir.path(), r"c:\a\b.txt"), Some(written));

    delete_draft(dir.path(), r"C:\A\b.txt").unwrap();
    assert_eq!(read_draft(dir.path(), r"C:\A\b.txt"), None);
}

#[test]
fn refuses_a_too_large_text() {
    let dir = tempfile::tempdir().unwrap();
    let text = "a".repeat(MAX_DRAFT_BYTES as usize + 1);

    assert_eq!(
        write_draft(dir.path(), &draft(r"C:\A\b.txt", &text)),
        Err("recovery.too_large".to_string())
    );
    let files = std::fs::read_dir(dir.path())
        .map(|entries| entries.count())
        .unwrap_or(0);
    assert_eq!(files, 0);
}

#[test]
fn keeps_at_most_50_drafts() {
    let dir = tempfile::tempdir().unwrap();
    for index in 0..52 {
        let path = format!(r"C:\A\{index}.txt");
        write_draft(dir.path(), &draft(&path, "unsaved")).unwrap();
        std::thread::sleep(Duration::from_millis(10));
    }

    let files = std::fs::read_dir(dir.path()).unwrap().count();
    assert_eq!(files, MAX_DRAFTS);
    assert_eq!(read_draft(dir.path(), r"C:\A\0.txt"), None);
    assert_eq!(read_draft(dir.path(), r"C:\A\1.txt"), None);
    assert!(read_draft(dir.path(), r"C:\A\2.txt").is_some());
}
