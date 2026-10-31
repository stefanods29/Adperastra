//! The browsing index of an archive (Step 06d D3). The listing is read
//! once; this tree answers "what is in this folder", "find this name" and
//! "how much is in here" without touching the file again.
//!
//! Folders the archive does not store as entries (many tools only write the
//! files) are made from the paths, with `IMPLICIT_INDEX`.

use crate::entry::{ArchiveEntry, EntryKind, IMPLICIT_INDEX};
use crate::path::{name_of, parent_of};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// What the status bar and the notes say about a whole archive.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TreeStats {
    pub files: u64,
    pub folders: u64,
    pub links: u64,
    pub encrypted: u64,
    pub total_size: u64,
    pub packed_size: u64,
    pub hidden: u64,
}

/// One archive, arranged as folders of entries. Paths are compared exactly
/// (case matters inside an archive).
#[derive(Debug, Default)]
pub struct ArchiveTree {
    entries: Vec<ArchiveEntry>,
    /// Folder path to the entries directly inside it, in insertion order.
    children: HashMap<String, Vec<usize>>,
    /// Folder path to its entry (explicit or made from the paths).
    folders: HashMap<String, usize>,
    hidden: u64,
}

impl ArchiveTree {
    pub fn build(entries: Vec<ArchiveEntry>) -> ArchiveTree {
        let mut tree = ArchiveTree::default();
        tree.children.insert(String::new(), Vec::new());
        for entry in entries {
            if entry.problem.is_some() {
                tree.hidden += 1;
                continue;
            }
            if entry.kind == EntryKind::Folder {
                if let Some(&existing) = tree.folders.get(&entry.path) {
                    // The folder was already made from a deeper path: it
                    // takes over the index and date but keeps its place.
                    let stored = &mut tree.entries[existing];
                    stored.index = entry.index;
                    stored.modified_unix = entry.modified_unix;
                    continue;
                }
            }
            tree.add_parents(&entry.path);
            let parent = parent_of(&entry.path).to_string();
            let index = tree.entries.len();
            tree.entries.push(entry.clone());
            if entry.kind == EntryKind::Folder {
                tree.folders.insert(entry.path.clone(), index);
            }
            tree.children.entry(parent).or_default().push(index);
        }
        tree
    }

    /// Make sure every folder above `path` exists and is listed.
    fn add_parents(&mut self, path: &str) {
        let mut current = parent_of(path).to_string();
        let mut wanted: Vec<String> = Vec::new();
        while !current.is_empty() && !self.folders.contains_key(&current) {
            wanted.push(current.clone());
            current = parent_of(&current).to_string();
        }
        for folder in wanted.into_iter().rev() {
            let parent = parent_of(&folder).to_string();
            let index = self.entries.len();
            self.entries.push(implicit_folder(&folder));
            self.folders.insert(folder.clone(), index);
            self.children.entry(parent).or_default().push(index);
        }
    }

    pub fn entry(&self, index: usize) -> &ArchiveEntry {
        &self.entries[index]
    }

    pub fn entries(&self) -> &[ArchiveEntry] {
        &self.entries
    }

    /// The entries directly inside `folder`, in archive order; `None` when
    /// no such folder exists.
    pub fn children(&self, folder: &str) -> Option<&[usize]> {
        self.children.get(folder).map(|list| list.as_slice())
    }

    pub fn is_folder(&self, path: &str) -> bool {
        self.folders.contains_key(path)
    }

    /// The children of `folder` ordered like the Explorer's Details list.
    pub fn sorted_children(&self, folder: &str, spec: fs_service::SortSpec) -> Option<Vec<usize>> {
        use fs_service::{SortDirection, SortKey};
        use std::cmp::Ordering;
        let mut list = self.children.get(folder)?.clone();
        list.sort_by(|left, right| {
            let x = &self.entries[*left];
            let y = &self.entries[*right];
            let group = |entry: &ArchiveEntry| usize::from(entry.kind != EntryKind::Folder);
            let ord = group(x).cmp(&group(y));
            if ord != Ordering::Equal {
                return ord;
            }
            let key_ord = match spec.key {
                SortKey::Name => fs_service::natural_cmp(&x.name, &y.name),
                SortKey::Modified => x.modified_unix.cmp(&y.modified_unix),
                SortKey::Size => x.size.cmp(&y.size),
                SortKey::Kind => type_key(x).cmp(&type_key(y)),
            };
            let directed = match spec.direction {
                SortDirection::Ascending => key_ord,
                SortDirection::Descending => key_ord.reverse(),
            };
            directed.then_with(|| fs_service::natural_cmp(&x.name, &y.name))
        });
        Some(list)
    }

    /// Entries whose name holds `text`, ignoring case: the first `limit`
    /// and how many there are in total.
    pub fn search(&self, text: &str, limit: usize) -> (Vec<usize>, usize) {
        let needle = text.to_lowercase();
        let mut found = Vec::new();
        let mut total = 0;
        for (index, entry) in self.entries.iter().enumerate() {
            if !entry.name.to_lowercase().contains(&needle) {
                continue;
            }
            total += 1;
            if found.len() < limit {
                found.push(index);
            }
        }
        (found, total)
    }

    pub fn stats(&self) -> TreeStats {
        let mut stats = TreeStats {
            hidden: self.hidden,
            ..TreeStats::default()
        };
        for entry in &self.entries {
            match entry.kind {
                EntryKind::Folder => stats.folders += 1,
                EntryKind::Link => stats.links += 1,
                EntryKind::File => {
                    stats.files += 1;
                    stats.total_size += entry.size;
                    stats.packed_size += entry.packed_size;
                }
            }
            if entry.encrypted {
                stats.encrypted += 1;
            }
        }
        stats
    }
}

/// The extension the Type column sorts by: the lower-case text after the
/// last dot, empty for a folder or a name without one.
fn type_key(entry: &ArchiveEntry) -> String {
    if entry.kind == EntryKind::Folder {
        return String::new();
    }
    entry
        .name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_lowercase())
        .unwrap_or_default()
}

fn implicit_folder(path: &str) -> ArchiveEntry {
    ArchiveEntry {
        index: IMPLICIT_INDEX,
        path: path.to_string(),
        name: name_of(path).to_string(),
        kind: EntryKind::Folder,
        size: 0,
        packed_size: 0,
        modified_unix: 0,
        encrypted: false,
        problem: None,
    }
}
