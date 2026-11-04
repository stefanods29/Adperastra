//! Step 06d T4: the extraction plan.

use archive::{
    plan_extract, top_level_names, ArchiveEntry, ArchiveError, ArchiveFacts, ArchiveFormat,
    EntryKind, ExtractRequest, Limits, Listing,
};
use std::fs;
use std::path::PathBuf;

fn entry(index: u32, path: &str, kind: EntryKind, size: u64, encrypted: bool) -> ArchiveEntry {
    ArchiveEntry {
        index,
        path: path.to_string(),
        name: archive::name_of(path).to_string(),
        kind,
        size,
        packed_size: 0,
        modified_unix: 0,
        encrypted,
        problem: None,
    }
}

fn listing() -> Listing {
    let mut unsafe_entry = entry(5, "../evil.txt", EntryKind::File, 1, false);
    unsafe_entry.problem = Some("unsafe_path".to_string());
    let mut readme = entry(0, "README.txt", EntryKind::File, 5, false);
    readme.packed_size = 3;
    Listing {
        format: ArchiveFormat::Zip,
        partial: false,
        entries: vec![
            readme,
            entry(1, "docs", EntryKind::Folder, 0, false),
            entry(2, "docs/plan.md", EntryKind::File, 7, false),
            entry(3, "docs/old/x.md", EntryKind::File, 1, false),
            entry(4, "link", EntryKind::Link, 0, false),
            unsafe_entry,
            entry(6, "secret.txt", EntryKind::File, 4, true),
        ],
    }
}

fn request(paths: &[&str], base: &str) -> ExtractRequest {
    ExtractRequest {
        paths: paths.iter().map(|path| (*path).to_string()).collect(),
        base: base.to_string(),
        dest_dir: "C:\\Out".to_string(),
        new_folder: None,
        expected_size: 1_000,
        expected_modified: 50,
        single_file: false,
        zone: None,
    }
}

fn facts() -> ArchiveFacts {
    ArchiveFacts {
        size: 1_000,
        modified_unix: 50,
    }
}

fn paths_of(entries: &[archive::PlannedEntry]) -> Vec<&str> {
    entries.iter().map(|entry| entry.inner.as_str()).collect()
}

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "adperastra-test-06d-plan-{}-{name}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn extract_all_skips_what_is_unsafe() {
    let listing = listing();
    let plan = plan_extract(&listing, &request(&[], ""), facts(), &Limits::default()).unwrap();
    assert_eq!(
        paths_of(&plan.files),
        ["README.txt", "docs/plan.md", "docs/old/x.md"]
    );
    assert_eq!(paths_of(&plan.folders), ["docs"]);
    assert_eq!(plan.bytes_total, 13);
    let skipped: Vec<(&str, &str)> = plan
        .skipped
        .iter()
        .map(|skip| (skip.path.as_str(), skip.reason.as_str()))
        .collect();
    assert_eq!(
        skipped,
        [
            ("link", "link_entry"),
            ("../evil.txt", "unsafe_path"),
            ("secret.txt", "password_required"),
        ]
    );
    assert_eq!(plan.top_names, ["README.txt", "docs"]);
}

#[test]
fn a_selection_is_relative_to_the_base() {
    let plan = plan_extract(
        &listing(),
        &request(&["docs/old"], "docs"),
        facts(),
        &Limits::default(),
    )
    .unwrap();
    assert_eq!(paths_of(&plan.files), ["docs/old/x.md"]);
    assert_eq!(plan.files[0].relative, ["old", "x.md"]);
    assert!(plan.folders.is_empty());
    assert_eq!(plan.top_names, ["old"]);
    assert_eq!(plan.bytes_total, 1);
}

#[test]
fn a_folder_selection_takes_everything_below() {
    let plan = plan_extract(
        &listing(),
        &request(&["docs"], ""),
        facts(),
        &Limits::default(),
    )
    .unwrap();
    assert_eq!(paths_of(&plan.files), ["docs/plan.md", "docs/old/x.md"]);
    assert_eq!(paths_of(&plan.folders), ["docs"]);
    assert_eq!(plan.top_names, ["docs"]);
}

#[test]
fn paths_outside_the_base_are_refused() {
    let listing = listing();
    let limits = Limits::default();
    for (paths, base) in [
        (vec!["README.txt"], "docs"),
        (vec!["nope.txt"], ""),
        (vec!["README.txt"], "nope"),
    ] {
        let result = plan_extract(&listing, &request(&paths, base), facts(), &limits);
        assert!(
            matches!(result, Err(ArchiveError::BadRequest)),
            "{paths:?} base {base}"
        );
    }
}

#[test]
fn single_file_rules() {
    let listing = listing();
    let limits = Limits::default();
    let single = |paths: &[&str]| {
        let mut request = request(paths, "");
        request.single_file = true;
        plan_extract(&listing, &request, facts(), &limits)
    };
    assert!(matches!(single(&["docs"]), Err(ArchiveError::NotAFile)));
    assert!(matches!(
        single(&["secret.txt"]),
        Err(ArchiveError::PasswordRequired)
    ));
    assert!(matches!(single(&["link"]), Err(ArchiveError::NotAFile)));
    let plan = single(&["README.txt"]).unwrap();
    assert_eq!(paths_of(&plan.files), ["README.txt"]);
    assert_eq!(plan.files[0].relative, ["README.txt"]);
}

#[test]
fn a_changed_archive_is_refused() {
    let listing = listing();
    let limits = Limits::default();
    let changed = plan_extract(
        &listing,
        &request(&[], ""),
        ArchiveFacts {
            size: 999,
            modified_unix: 50,
        },
        &limits,
    );
    assert!(matches!(changed, Err(ArchiveError::Changed)));

    let mut unchecked = request(&[], "");
    unchecked.expected_modified = 0;
    assert!(plan_extract(
        &listing,
        &unchecked,
        ArchiveFacts {
            size: 1_000,
            modified_unix: 77,
        },
        &limits,
    )
    .is_ok());
}

#[test]
fn bombs_are_refused() {
    const MIB: u64 = 1_048_576;
    let big = Listing {
        format: ArchiveFormat::Zip,
        partial: false,
        entries: vec![entry(
            0,
            "big.bin",
            EntryKind::File,
            2 * 1_073_741_824,
            false,
        )],
    };
    let limits = Limits::default();
    let mut request = request(&[], "");
    request.expected_size = MIB;
    assert!(matches!(
        plan_extract(
            &big,
            &request,
            ArchiveFacts {
                size: MIB,
                modified_unix: 50
            },
            &limits
        ),
        Err(ArchiveError::Bomb)
    ));
    request.expected_size = 8 * MIB;
    assert!(plan_extract(
        &big,
        &request,
        ArchiveFacts {
            size: 8 * MIB,
            modified_unix: 50
        },
        &limits
    )
    .is_ok());
}

#[test]
fn top_level_names_keep_both() {
    let dir = temp_dir("top");
    fs::create_dir(dir.join("docs")).unwrap();
    fs::write(dir.join("README.txt"), "old").unwrap();
    let plan = plan_extract(&listing(), &request(&[], ""), facts(), &Limits::default()).unwrap();
    let names = top_level_names(&plan, &dir);
    assert_eq!(
        names,
        [
            ("README.txt".to_string(), "README (1).txt".to_string()),
            ("docs".to_string(), "docs (1)".to_string()),
        ]
    );
    let empty = temp_dir("top-empty");
    let names = top_level_names(&plan, &empty);
    assert_eq!(
        names,
        [
            ("README.txt".to_string(), "README.txt".to_string()),
            ("docs".to_string(), "docs".to_string()),
        ]
    );
    let _ = fs::remove_dir_all(&dir);
    let _ = fs::remove_dir_all(&empty);
}
