//! Native assistant scopes (Step 17a T3, E5).
//!
//! A scope is per chat and per profile generation. Roots are added only after
//! the native Allow dialog; deny folders always win over a parent grant; a
//! link's final target must stay inside the granted root; online-only files
//! are never hydrated for content. File text can never create a grant.
#![allow(dead_code)]


use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use uuid::Uuid;

use crate::assistant_policy::{MAX_DENIED_FOLDERS, MAX_SCOPE_FILES, MAX_SCOPE_ROOTS};
use crate::assistant_types::{AssistantScope, AssistantScopeRoot};
use crate::local_ai_types::{AiInputKind, AiInputRef};

#[derive(Debug, Clone)]
pub struct DeniedFolder {
    pub canonical: PathBuf,
    pub label: String,
}

#[derive(Debug, Clone)]
pub struct ScopeRoot {
    pub root_id: Uuid,
    pub canonical: PathBuf,
    pub label: String,
    pub recursive: bool,
    pub read_contents: bool,
}

#[derive(Debug, Clone)]
pub struct ScopeRecord {
    pub id: Uuid,
    pub chat_id: Uuid,
    pub generation: u64,
    pub files: Vec<AiInputRef>,
    /// Private path map; never serialized or exposed to the UI.
    file_paths: HashMap<Uuid, PathBuf>,
    pub roots: Vec<ScopeRoot>,
    pub read_contents: bool,
    pub denied: Vec<DeniedFolder>,
    pub closed: bool,
}

impl ScopeRecord {
    pub fn new(chat_id: Uuid, generation: u64) -> Self {
        Self {
            id: Uuid::new_v4(),
            chat_id,
            generation,
            files: Vec::new(),
            file_paths: HashMap::new(),
            roots: Vec::new(),
            read_contents: false,
            denied: Vec::new(),
            closed: false,
        }
    }

    pub fn view(&self) -> AssistantScope {
        AssistantScope {
            id: self.id,
            chat_id: self.chat_id,
            generation: self.generation,
            files: self.files.clone(),
            roots: self
                .roots
                .iter()
                .map(|root| AssistantScopeRoot {
                    root_id: root.root_id,
                    label: root.label.clone(),
                    recursive: root.recursive,
                    read_contents: root.read_contents,
                })
                .collect(),
            read_contents: self.read_contents,
            denied_folders: self.denied.iter().map(|deny| deny.label.clone()).collect(),
        }
    }
}

#[derive(Default)]
pub struct ScopeRegistry {
    scopes: Mutex<HashMap<Uuid, ScopeRecord>>,
}

impl ScopeRegistry {
    fn lock(&self) -> Result<MutexGuard<'_, HashMap<Uuid, ScopeRecord>>, String> {
        self.scopes
            .lock()
            .map_err(|_| "assistant.failed".to_string())
    }

    pub fn insert(&self, record: ScopeRecord) -> Result<(), String> {
        self.lock()?.insert(record.id, record);
        Ok(())
    }

    pub fn get(&self, scope_id: Uuid) -> Result<ScopeRecord, String> {
        self.lock()?
            .get(&scope_id)
            .cloned()
            .ok_or_else(|| "assistant.scope_denied".to_string())
    }

    pub fn get_by_chat(&self, chat_id: Uuid) -> Result<ScopeRecord, String> {
        self.lock()?
            .values()
            .find(|record| record.chat_id == chat_id && !record.closed)
            .cloned()
            .ok_or_else(|| "assistant.scope_denied".to_string())
    }

    pub fn update(&self, record: ScopeRecord) -> Result<(), String> {
        let mut scopes = self.lock()?;
        if !scopes.contains_key(&record.id) {
            return Err("assistant.scope_denied".to_string());
        }
        scopes.insert(record.id, record);
        Ok(())
    }

    /// Closing a chat releases its scope immediately.
    pub fn remove_chat(&self, chat_id: Uuid) -> Result<(), String> {
        self.lock()?.retain(|_, record| record.chat_id != chat_id);
        Ok(())
    }

    pub fn remove(&self, scope_id: Uuid) -> Result<(), String> {
        self.lock()?.remove(&scope_id);
        Ok(())
    }

    /// A profile change invalidates every grant and every pending consent.
    pub fn invalidate_all(&self, next_generation: u64) -> Result<(), String> {
        let mut scopes = self.lock()?;
        for record in scopes.values_mut() {
            record.generation = next_generation;
            record.roots.clear();
            record.files.clear();
            record.read_contents = false;
            record.closed = true;
        }
        scopes.clear();
        Ok(())
    }
}

fn path_key(path: &Path) -> String {
    path.to_string_lossy().to_lowercase()
}

fn path_components(path: &Path) -> Vec<String> {
    path.components()
        .map(|part| part.as_os_str().to_string_lossy().to_ascii_lowercase())
        .collect()
}

/// Component-aware containment: `C:\foo` is not inside `C:\foobar`, and a
/// trailing separator on a drive root changes nothing.
pub fn is_within(child: &Path, parent: &Path) -> bool {
    let child = path_components(child);
    let parent = path_components(parent);
    if parent.len() > child.len() {
        return false;
    }
    child[..parent.len()] == parent[..]
}

fn normalize_existing(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() || path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err("assistant.scope_denied".to_string());
    }
    std::fs::canonicalize(path).map_err(|_| "assistant.scope_denied".to_string())
}

fn denied_contains(record: &ScopeRecord, canonical: &Path) -> bool {
    record
        .denied
        .iter()
        .any(|deny| is_within(canonical, &deny.canonical))
}

/// Add a denied folder. Denies may be added even when the folder is outside
/// every grant; they only ever remove access.
pub fn deny_folder(record: &mut ScopeRecord, path: &Path) -> Result<(), String> {
    let canonical = normalize_existing(path)?;
    if record.denied.len() >= MAX_DENIED_FOLDERS {
        return Err("assistant.invalid".to_string());
    }
    if record
        .denied
        .iter()
        .any(|deny| path_key(&deny.canonical) == path_key(&canonical))
    {
        return Ok(());
    }
    record.denied.push(DeniedFolder {
        canonical: canonical.clone(),
        label: canonical.to_string_lossy().to_string(),
    });
    record
        .roots
        .retain(|root| !is_within(&root.canonical, &canonical));
    let removed: Vec<Uuid> = record
        .file_paths
        .iter()
        .filter(|(_, path)| is_within(path, &canonical))
        .map(|(id, _)| *id)
        .collect();
    for id in removed {
        record.file_paths.remove(&id);
        record.files.retain(|file| file.id != id);
    }
    Ok(())
}

/// A deny folder under a requested parent always wins.
pub fn add_root(
    record: &mut ScopeRecord,
    path: &Path,
    recursive: bool,
    read_contents: bool,
    approved: bool,
) -> Result<(), String> {
    ensure_grant_allowed(approved)?;
    if record.closed {
        return Err("assistant.scope_denied".to_string());
    }
    let canonical = normalize_existing(path)?;
    if !canonical.is_dir() {
        return Err("assistant.scope_denied".to_string());
    }
    if denied_contains(record, &canonical) {
        return Err("assistant.scope_denied".to_string());
    }
    if record.roots.len() >= MAX_SCOPE_ROOTS {
        return Err("assistant.invalid".to_string());
    }
    if let Some(existing) = record
        .roots
        .iter_mut()
        .find(|root| path_key(&root.canonical) == path_key(&canonical))
    {
        // A second approved request may widen the same root, never narrow it.
        existing.recursive |= recursive;
        existing.read_contents |= read_contents;
        record.read_contents |= read_contents;
        return Ok(());
    }
    record.roots.push(ScopeRoot {
        root_id: Uuid::new_v4(),
        label: canonical.to_string_lossy().to_string(),
        canonical,
        recursive,
        read_contents,
    });
    record.read_contents |= read_contents;
    Ok(())
}

/// A file is authorized only when its final target is inside a granted root.
/// The resolver is canonicalization in production; tests inject a fake link.
pub fn add_file_with_resolver(
    record: &mut ScopeRecord,
    requested: &Path,
    approved: bool,
    resolve: impl Fn(&Path) -> Result<PathBuf, String>,
) -> Result<AiInputRef, String> {
    ensure_grant_allowed(approved)?;
    if record.closed {
        return Err("assistant.scope_denied".to_string());
    }
    let canonical = resolve(requested)?;
    if !canonical.is_file() {
        return Err("assistant.scope_denied".to_string());
    }
    if denied_contains(record, &canonical) {
        return Err("assistant.scope_denied".to_string());
    }
    let inside = record.roots.iter().any(|root| {
        let inside_root = is_within(&canonical, &root.canonical);
        inside_root && (root.recursive || canonical.parent() == Some(root.canonical.as_path()))
    });
    if !inside {
        return Err("assistant.scope_denied".to_string());
    }
    if record.files.len() >= MAX_SCOPE_FILES {
        return Err("assistant.invalid".to_string());
    }
    let id = Uuid::new_v4();
    // The scope stores the canonical 14c input reference, never a path.
    let input_ref = AiInputRef {
        kind: AiInputKind::Snapshot,
        id,
        expected_revision: 1,
    };
    record.files.push(input_ref.clone());
    record.file_paths.insert(id, canonical);
    Ok(input_ref)
}

pub fn add_file(record: &mut ScopeRecord, requested: &Path, approved: bool) -> Result<AiInputRef, String> {
    add_file_with_resolver(record, requested, approved, normalize_existing)
}

/// Reading content additionally needs a root that allows it, and an ordinary
/// online source. Online-only files are never hydrated here.
pub fn read_content_allowed(record: &ScopeRecord, input_id: Uuid, online_only: bool) -> Result<(), String> {
    if record.closed || online_only {
        return Err("assistant.scope_denied".to_string());
    }
    if !record.read_contents {
        return Err("assistant.scope_denied".to_string());
    }
    if record.files.iter().all(|file| file.id != input_id) {
        return Err("assistant.scope_denied".to_string());
    }
    let Some(path) = record.file_paths.get(&input_id) else {
        return Err("assistant.scope_denied".to_string());
    };
    let root_allows = record
        .roots
        .iter()
        .find(|root| is_within(path, &root.canonical))
        .map(|root| root.read_contents)
        .unwrap_or(false);
    if !root_allows {
        return Err("assistant.scope_denied".to_string());
    }
    Ok(())
}

/// Anything a file says about paths is data. This helper always refuses to
/// turn content into a grant, so a caller cannot accidentally do it.
pub fn grant_from_content(_content: &str) -> Result<(), String> {
    Err("assistant.scope_denied".to_string())
}

/// The native Allow dialog is the only source of `approved=true`.
pub fn ensure_grant_allowed(approved: bool) -> Result<(), String> {
    if approved {
        Ok(())
    } else {
        Err("assistant.scope_denied".to_string())
    }
}

/// A dirty tab close must keep the view; the normal unsaved dialog decides.
pub fn close_tab_result(dirty: bool) -> Result<(), String> {
    if dirty {
        Err("assistant.confirmation_required".to_string())
    } else {
        Ok(())
    }
}

/// A profile or chat revision change invalidates the record.
pub fn require_generation(record: &ScopeRecord, generation: u64) -> Result<(), String> {
    if record.closed || record.generation != generation {
        Err("assistant.scope_denied".to_string())
    } else {
        Ok(())
    }
}
