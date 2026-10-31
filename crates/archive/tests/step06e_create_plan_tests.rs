//! Bounded source planning for creation (Step 06e T5). Nothing here creates
//! an archive; every case only inspects the plan.

use std::path::Path;

use archive::{plan_create, ArchiveError, CreateLimits};
use fs_service::new_cancellation_token;

fn plan(
    sources: &[&Path],
    include_hidden: bool,
    limits: &CreateLimits,
) -> Result<archive::CreatePlan, ArchiveError> {
    let sources: Vec<String> = sources
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    let token = new_cancellation_token();
    plan_create(&sources, include_hidden, limits, &token, &mut |_| {})
}

fn write(path: &Path, text: &str) {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).unwrap();
    }
    std::fs::write(path, text).unwrap();
}

#[test]
fn parent_selection_subsumes_its_child() {
    let folder = tempfile::tempdir().unwrap();
    let docs = folder.path().join("docs");
    write(&docs.join("a.txt"), "a");
    write(&docs.join("sub").join("b.txt"), "b");

    let plan = plan(
        &[&docs, &docs.join("a.txt")],
        true,
        &CreateLimits::default(),
    )
    .unwrap();

    let inner: Vec<&str> = plan
        .entries
        .iter()
        .map(|entry| entry.inner_path.as_str())
        .collect();
    assert_eq!(
        inner.iter().filter(|path| **path == "docs/a.txt").count(),
        1,
        "the child is not listed twice"
    );
    assert!(inner.contains(&"docs/sub/b.txt"));
    assert!(inner.contains(&"docs/a.txt"));
}

#[test]
fn unrelated_roots_with_same_name_are_rejected() {
    let folder = tempfile::tempdir().unwrap();
    let first = folder.path().join("one").join("docs");
    let second = folder.path().join("two").join("docs");
    write(&first.join("a.txt"), "a");
    write(&second.join("b.txt"), "b");

    let result = plan(&[&first, &second], true, &CreateLimits::default());
    assert!(
        matches!(result, Err(ArchiveError::BadRequest)),
        "{result:?}"
    );
}

/// Set Windows attributes on a path.
fn set_attributes(path: &Path, attributes: u32) {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{SetFileAttributesW, FILE_FLAGS_AND_ATTRIBUTES};
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
    // SAFETY: the buffer is NUL-terminated and outlives the call.
    unsafe { SetFileAttributesW(PCWSTR(wide.as_ptr()), FILE_FLAGS_AND_ATTRIBUTES(attributes)) }
        .unwrap();
}

#[test]
fn walk_skips_links_hidden_online_and_denied() {
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    const FILE_ATTRIBUTE_OFFLINE: u32 = 0x1000;

    let folder = tempfile::tempdir().unwrap();
    let docs = folder.path().join("docs");
    write(&docs.join("normal.txt"), "normal");
    write(&docs.join("hidden.txt"), "hidden");
    write(&docs.join("offline.txt"), "offline");
    set_attributes(&docs.join("hidden.txt"), FILE_ATTRIBUTE_HIDDEN);
    set_attributes(&docs.join("offline.txt"), FILE_ATTRIBUTE_OFFLINE);
    let linked =
        std::os::windows::fs::symlink_file(docs.join("normal.txt"), docs.join("link.txt")).is_ok();

    let visible = plan(&[&docs], false, &CreateLimits::default()).unwrap();
    let names: Vec<&str> = visible
        .entries
        .iter()
        .map(|entry| entry.inner_path.as_str())
        .collect();
    assert!(names.contains(&"docs/normal.txt"));
    assert!(!names.iter().any(|path| path.contains("hidden.txt")));
    assert!(!names.iter().any(|path| path.contains("offline.txt")));
    let reasons: Vec<&str> = visible
        .skipped
        .iter()
        .map(|skip| skip.reason.as_str())
        .collect();
    assert!(reasons.contains(&"hidden"));
    assert!(reasons.contains(&"online_only"));
    if linked {
        assert!(!names.iter().any(|path| path.contains("link.txt")));
        assert!(reasons.contains(&"link_entry"));
    }

    let all = plan(&[&docs], true, &CreateLimits::default()).unwrap();
    assert!(all
        .entries
        .iter()
        .any(|entry| entry.inner_path == "docs/hidden.txt"));
}

#[test]
fn create_plan_caps_roots_entries_depth_and_text() {
    let folder = tempfile::tempdir().unwrap();
    let first = folder.path().join("first");
    let second = folder.path().join("second");
    write(&first.join("a.txt"), "a");
    write(&second.join("b.txt"), "b");
    let many = CreateLimits {
        max_sources: 1,
        ..CreateLimits::default()
    };
    assert!(matches!(
        plan(&[&first, &second], true, &many),
        Err(ArchiveError::TooManySources)
    ));

    let docs = folder.path().join("docs");
    write(&docs.join("a.txt"), "a");
    write(&docs.join("b.txt"), "b");
    write(&docs.join("c.txt"), "c");
    let few = CreateLimits {
        max_entries: 2,
        ..CreateLimits::default()
    };
    assert!(matches!(
        plan(&[&docs], true, &few),
        Err(ArchiveError::TooManySources)
    ));

    let deep = folder.path().join("deep");
    write(&deep.join("one").join("two").join("file.txt"), "deep");
    let shallow = CreateLimits {
        max_depth: 2,
        ..CreateLimits::default()
    };
    assert!(matches!(
        plan(&[&deep], true, &shallow),
        Err(ArchiveError::BadRequest)
    ));

    let small_text = CreateLimits {
        max_manifest_bytes: 1,
        ..CreateLimits::default()
    };
    assert!(matches!(
        plan(&[&docs], true, &small_text),
        Err(ArchiveError::BadRequest)
    ));
}

#[test]
fn empty_folders_are_explicit_entries() {
    let folder = tempfile::tempdir().unwrap();
    let docs = folder.path().join("docs");
    std::fs::create_dir_all(docs.join("empty")).unwrap();

    let plan = plan(&[&docs], true, &CreateLimits::default()).unwrap();
    assert!(plan
        .entries
        .iter()
        .any(|entry| entry.inner_path == "docs/empty" && entry.kind == archive::EntryKind::Folder));
}

#[test]
fn cancelled_walk_creates_no_spool() {
    let folder = tempfile::tempdir().unwrap();
    let docs = folder.path().join("docs");
    write(&docs.join("a.txt"), "a");
    let sources = vec![docs.to_string_lossy().into_owned()];
    let token = new_cancellation_token();
    token.store(true, std::sync::atomic::Ordering::Relaxed);

    let result = plan_create(
        &sources,
        true,
        &CreateLimits::default(),
        &token,
        &mut |_| {},
    );
    assert!(matches!(result, Err(ArchiveError::Cancelled)));
    assert!(
        !folder.path().join("archive.spool").exists(),
        "a cancelled walk never makes output"
    );
}
