//! Where a new extraction may write (Step 06e D5, D11): a pinned root, one
//! new numbered scaffold per top-level item, and no merging into anything
//! that was already there.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use fs_service::owned_io::{OwnedIoError, OwnedOutput, PinnedDirectory};

use crate::error::ArchiveError;
use crate::plan::ExtractPlan;

/// The most numbered names tried for one top-level item.
pub(crate) const MAX_NUMBERED: usize = 10_000;

fn key(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

/// `report.txt` and 2 give `report (2).txt`; `docs` gives `docs (2)`.
pub(crate) fn numbered(name: &str, number: usize) -> String {
    match name.rfind('.') {
        Some(dot) if dot > 0 => format!("{} ({number}){}", &name[..dot], &name[dot..]),
        _ => format!("{name} ({number})"),
    }
}

fn folder_reason(error: &std::io::Error) -> &'static str {
    if error.kind() == std::io::ErrorKind::PermissionDenied {
        "access_denied"
    } else {
        "other"
    }
}

/// Create the first free numbered folder below `parent`.
pub(crate) fn create_numbered_folder(
    parent: &Path,
    name: &str,
) -> Result<(String, PathBuf), ArchiveError> {
    for number in 0..MAX_NUMBERED {
        let candidate = if number == 0 {
            name.to_string()
        } else {
            numbered(name, number)
        };
        let path = parent.join(&candidate);
        match fs::create_dir(&path) {
            Ok(()) => return Ok((candidate, path)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(ArchiveError::from(error)),
        }
    }
    Err(ArchiveError::BadRequest)
}

/// A brand-new folder for "Extract to a new folder".
pub(crate) fn create_new_folder(parent: &Path, name: &str) -> Result<PathBuf, ArchiveError> {
    Ok(create_numbered_folder(parent, name)?.1)
}

/// The destination tree of one extraction.
pub(crate) struct SecureTree {
    root: PathBuf,
    /// planned top name (lower case) to the name it really gets.
    names: HashMap<String, String>,
    /// planned top names that are folders (lower case).
    folders: HashSet<String>,
    /// Folders this extraction created (lower-case absolute paths).
    created: HashSet<String>,
    _root: PinnedDirectory,
}

impl SecureTree {
    /// Create the scaffolds: every top-level item becomes a new numbered
    /// item, never an existing tree the archive would merge into.
    pub fn prepare(root: PinnedDirectory, plan: &ExtractPlan) -> Result<Self, ArchiveError> {
        let root_path = root.path().to_path_buf();
        let mut tree = Self {
            root: root_path.clone(),
            names: HashMap::new(),
            folders: HashSet::new(),
            created: HashSet::new(),
            _root: root,
        };
        for folder in &plan.folders {
            if let Some(first) = folder.relative.first() {
                tree.folders.insert(first.to_lowercase());
            }
        }
        for file in &plan.files {
            if file.relative.len() > 1 {
                if let Some(first) = file.relative.first() {
                    tree.folders.insert(first.to_lowercase());
                }
            }
        }
        for name in &plan.top_names {
            if tree.folders.contains(&name.to_lowercase()) {
                let (actual, path) = create_numbered_folder(&root_path, name)?;
                tree.names.insert(name.to_lowercase(), actual);
                tree.created.insert(key(&path));
            } else {
                tree.names.insert(name.to_lowercase(), name.clone());
            }
        }
        Ok(tree)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn is_top_folder(&self, planned: &str) -> bool {
        self.folders.contains(&planned.to_lowercase())
    }

    /// The path of a top-level item as it was really created.
    pub fn top_path(&self, planned: &str) -> PathBuf {
        let actual = self
            .names
            .get(&planned.to_lowercase())
            .cloned()
            .unwrap_or_else(|| planned.to_string());
        self.root.join(actual)
    }

    /// The folder a planned entry's parent is, made when the archive did not
    /// list it. Existing items that this extraction did not create are never
    /// merged into or written through.
    fn ensure_parent(&mut self, relative: &[String]) -> Result<PathBuf, &'static str> {
        let Some(first) = relative.first() else {
            return Err("invalid_name");
        };
        let Some(actual) = self.names.get(&first.to_lowercase()).cloned() else {
            return Err("name_taken");
        };
        if relative.len() == 1 {
            return Ok(self.root.clone());
        }
        if !self.folders.contains(&first.to_lowercase()) {
            return Err("name_taken");
        }
        let mut current = self.root.join(actual);
        if is_link(&current) {
            return Err("name_taken");
        }
        for part in &relative[1..relative.len() - 1] {
            current.push(part);
            let text = key(&current);
            if self.created.contains(&text) {
                continue;
            }
            match fs::symlink_metadata(&current) {
                Ok(metadata) => {
                    if metadata.file_type().is_symlink() || !metadata.is_dir() {
                        return Err("name_taken");
                    }
                    // A folder we did not make: never merge into it.
                    return Err("name_taken");
                }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(folder_reason(&error)),
            }
            match fs::create_dir(&current) {
                Ok(()) => {
                    self.created.insert(text);
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    return Err("name_taken")
                }
                Err(error) => return Err(folder_reason(&error)),
            }
        }
        Ok(current)
    }

    /// Make one planned folder. A top-level folder was already made by
    /// `prepare`; a nested one is created only when nothing is there.
    pub fn create_folder(&mut self, relative: &[String]) -> Result<PathBuf, &'static str> {
        if relative.len() == 1 {
            return Ok(self.top_path(&relative[0]));
        }
        let parent = self.ensure_parent(relative)?;
        let Some(last) = relative.last() else {
            return Err("invalid_name");
        };
        let target = parent.join(last);
        if is_link(&target) {
            return Err("name_taken");
        }
        match fs::create_dir(&target) {
            Ok(()) => {
                self.created.insert(key(&target));
                Ok(target)
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => Err("name_taken"),
            Err(error) => Err(folder_reason(&error)),
        }
    }

    /// A new owned staging file in the (new) parent folder. The returned pin
    /// must stay alive until the file is published.
    pub fn open_output(
        &mut self,
        relative: &[String],
        hint: &str,
    ) -> Result<(OwnedOutput, PinnedDirectory), &'static str> {
        let parent = self.ensure_parent(relative)?;
        let pin = PinnedDirectory::open(&parent).map_err(|error| match error {
            OwnedIoError::Io(io) => folder_reason(&io),
            _ => "other",
        })?;
        let output = OwnedOutput::create(&pin, hint).map_err(|error| match error {
            OwnedIoError::Io(io) => folder_reason(&io),
            OwnedIoError::TargetExists => "name_taken",
            _ => "other",
        })?;
        Ok((output, pin))
    }
}

fn is_link(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_symlink())
}
