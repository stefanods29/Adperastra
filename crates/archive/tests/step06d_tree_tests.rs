//! Step 06d T4: the browsing tree.

use archive::{ArchiveEntry, ArchiveTree, EntryKind, IMPLICIT_INDEX};
use fs_service::{SortDirection, SortKey, SortSpec};

fn file(index: u32, path: &str, size: u64) -> ArchiveEntry {
    ArchiveEntry {
        index,
        path: path.to_string(),
        name: archive::name_of(path).to_string(),
        kind: EntryKind::File,
        size,
        packed_size: 0,
        modified_unix: 0,
        encrypted: false,
        problem: None,
    }
}

fn folder(index: u32, path: &str, modified_unix: u64) -> ArchiveEntry {
    ArchiveEntry {
        index,
        path: path.to_string(),
        name: archive::name_of(path).to_string(),
        kind: EntryKind::Folder,
        size: 0,
        packed_size: 0,
        modified_unix,
        encrypted: false,
        problem: None,
    }
}

fn tree() -> ArchiveTree {
    let mut unsafe_entry = file(3, "../x", 1);
    unsafe_entry.problem = Some("unsafe_path".to_string());
    ArchiveTree::build(vec![
        file(0, "a/b/c.txt", 10),
        file(1, "a/d.txt", 20),
        file(2, "e.txt", 5),
        unsafe_entry,
        folder(4, "a", 1_000),
    ])
}

fn names(tree: &ArchiveTree, indices: &[usize]) -> Vec<String> {
    indices
        .iter()
        .map(|index| tree.entry(*index).name.clone())
        .collect()
}

#[test]
fn builds_folders_from_paths() {
    let tree = tree();
    assert_eq!(names(&tree, tree.children("").unwrap()), ["a", "e.txt"]);
    assert_eq!(names(&tree, tree.children("a").unwrap()), ["b", "d.txt"]);
    assert_eq!(names(&tree, tree.children("a/b").unwrap()), ["c.txt"]);
    let a = tree
        .children("")
        .unwrap()
        .iter()
        .filter(|index| tree.entry(**index).name == "a")
        .count();
    assert_eq!(a, 1);
    assert_eq!(
        tree.entry(tree.children("").unwrap()[0]).modified_unix,
        1_000
    );
    assert!(tree.children("zzz").is_none());
    assert!(tree.is_folder("a/b"));
    assert!(!tree.is_folder("e.txt"));
    // The folder made from the paths carries the marker index.
    assert_eq!(
        tree.entry(tree.children("a").unwrap()[0]).index,
        IMPLICIT_INDEX
    );
}

#[test]
fn counts_files_and_hidden_items() {
    let stats = tree().stats();
    assert_eq!(stats.files, 3);
    assert_eq!(stats.folders, 2);
    assert_eq!(stats.total_size, 35);
    assert_eq!(stats.hidden, 1);
}

#[test]
fn sorts_like_the_explorer() {
    let tree = tree();
    let by_name = SortSpec {
        key: SortKey::Name,
        direction: SortDirection::Ascending,
    };
    assert_eq!(
        names(&tree, &tree.sorted_children("", by_name).unwrap()),
        ["a", "e.txt"]
    );
    let by_size_down = SortSpec {
        key: SortKey::Size,
        direction: SortDirection::Descending,
    };
    assert_eq!(
        names(&tree, &tree.sorted_children("a", by_size_down).unwrap()),
        ["b", "d.txt"]
    );

    let extra = ArchiveTree::build(vec![
        file(0, "x.zip", 1),
        file(1, "y.txt", 1),
        file(2, "z.md", 1),
    ]);
    let by_kind = SortSpec {
        key: SortKey::Kind,
        direction: SortDirection::Ascending,
    };
    assert_eq!(
        names(&extra, &extra.sorted_children("", by_kind).unwrap()),
        ["z.md", "y.txt", "x.zip"]
    );

    let numbers = ArchiveTree::build(vec![file(0, "file 10.txt", 1), file(1, "file 9.txt", 1)]);
    assert_eq!(
        names(&numbers, &numbers.sorted_children("", by_name).unwrap()),
        ["file 9.txt", "file 10.txt"]
    );
}

#[test]
fn searches_names_in_the_whole_archive() {
    let tree = tree();
    let (found, total) = tree.search("txt", 1_000);
    assert_eq!(names(&tree, &found), ["c.txt", "d.txt", "e.txt"]);
    assert_eq!(total, 3);
    let (found, total) = tree.search("C.TXT", 1_000);
    assert_eq!(names(&tree, &found), ["c.txt"]);
    assert_eq!(total, 1);
    let (found, total) = tree.search("txt", 2);
    assert_eq!(found.len(), 2);
    assert_eq!(total, 3);
}
