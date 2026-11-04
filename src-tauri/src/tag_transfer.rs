//! Safe `.adptags` tag exchange (Step 11b, T3).
//!
//! A catalog-only export never contains a file path or file content and is
//! bounded to 1 MiB. Personal memberships are a separate, unchecked option:
//! they add only verified identities, display paths and tag IDs, never file
//! bytes, and the whole file stays under 16 MiB. Import parses a preview
//! first; nothing is written until every duplicate name has an explicit
//! merge/rename choice and every saved stable identity still matches the
//! file at its saved path. Existing local tags are never replaced.

use std::collections::{HashMap, HashSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Mutex;

use fs_service::owned_io::{OwnedIoError, OwnedOutput, PinnedDirectory};
use fs_service::FileIdentityKey;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::jobs::{spawn_job, JobContext, Jobs};
use crate::tag_store::{unix_now, TagStore};
use crate::tag_transactions::TagHistory;
use crate::tag_types::{
    assignment_lookup, is_uuid, is_valid_identity_key, is_valid_tag_name, normalize_tag_name,
    tag_name_fold, validate_tag, Tag, TagAssignment, TagCatalog, TagImportChoice,
    TagImportConflict, TagImportPreview, MAX_ASSIGNMENT_TAGS, MAX_TAGS, TAG_SCHEMA_VERSION,
};

/// The fixed application marker of a schema-1 `.adptags` file.
pub const ADP_TAGS_APP: &str = "adperastra";
/// The only file extension this module reads or writes.
pub const ADP_TAGS_EXTENSION: &str = "adptags";
/// A catalog-only exchange file never exceeds this.
pub const MAX_CATALOG_ONLY_BYTES: usize = 1024 * 1024;
/// A file with personal memberships never exceeds this.
pub const MAX_IMPORT_BYTES: usize = 16 * 1024 * 1024;
/// Most files one keyword batch may name.
pub const MAX_WRITE_PATHS: usize = 10_000;
/// One preview is valid for this long.
pub const PREVIEW_TTL_SECS: u64 = 10 * 60;
/// Most previews kept at once; the oldest leaves first.
pub const MAX_PREVIEWS: usize = 8;
/// Longest display path on the wire, in UTF-16 units (Step 08a).
const MAX_PATH_UNITS: usize = 32_768;
/// Room left in the membership file for the envelope and tag catalog.
const MEMBERSHIP_ROW_BUDGET: usize = MAX_IMPORT_BYTES - 512 * 1024;

/// The result of one export job.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TagExportResult {
    pub path: String,
    pub bytes: u64,
}

/// Cancellation and progress used by the export and copy jobs. The real job
/// table implements it; tests use a no-op.
pub trait TransferJob {
    fn cancelled(&self) -> bool;
    fn progress(&self, done: usize, total: usize, current: &str);
}

/// The shared `JobContext` adapter.
pub struct JobBridge<'a>(pub &'a JobContext);

impl TransferJob for JobBridge<'_> {
    fn cancelled(&self) -> bool {
        self.0.token().load(Ordering::Relaxed)
    }

    fn progress(&self, done: usize, total: usize, current: &str) {
        self.0.set_progress(&fs_service::OpProgress {
            items_done: done,
            items_total: total,
            bytes_done: 0,
            bytes_total: 0,
            current: current.to_string(),
        });
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AdpTagsTag {
    id: String,
    name: String,
    color: String,
    icon_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AdpTagsAssignment {
    volume_id: String,
    file_id: String,
    path_key: String,
    stable: bool,
    display_path: String,
    tag_ids: Vec<String>,
}

/// The exact schema-1 file. `assignments` is absent unless the user chose
/// to include personal locations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct AdpTagsFile {
    pub schema_version: u32,
    pub app: String,
    pub tags: Vec<AdpTagsTag>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub assignments: Option<Vec<AdpTagsAssignment>>,
}

#[derive(Debug, Clone)]
struct StoredPreview {
    id: String,
    created_unix: u64,
    file: AdpTagsFile,
    conflicts: Vec<TagImportConflict>,
}

/// Native preview store (managed Tauri state).
#[derive(Default)]
pub struct TagTransfer {
    previews: Mutex<VecDeque<StoredPreview>>,
}

fn lock<T>(value: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>, String> {
    value.lock().map_err(|_| "tags.io".to_string())
}

fn exchange_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case(ADP_TAGS_EXTENSION))
}

fn shared_path_ok(value: &str) -> bool {
    !value.is_empty()
        && value.encode_utf16().count() <= MAX_PATH_UNITS
        && !value.contains('\0')
        && Path::new(value).is_absolute()
}

/// A path the user chose for reading. It must already end in `.adptags`.
fn import_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() || !exchange_extension(path) || path.file_name().is_none() {
        return Err("tags.invalid".to_string());
    }
    Ok(path.to_path_buf())
}

/// A path the user chose for writing. A missing extension is added; any
/// other extension is refused so an export cannot rename itself into a
/// different file type.
fn export_path(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() || path.file_name().is_none() {
        return Err("tags.invalid".to_string());
    }
    if path.extension().is_none() {
        let mut name = path.as_os_str().to_owned();
        name.push(".");
        name.push(ADP_TAGS_EXTENSION);
        return Ok(PathBuf::from(name));
    }
    if !exchange_extension(path) {
        return Err("tags.invalid".to_string());
    }
    Ok(path.to_path_buf())
}

/// Validate every field of a parsed file without touching the store.
fn validate_import_file(file: &AdpTagsFile) -> Result<(), String> {
    if file.schema_version != TAG_SCHEMA_VERSION {
        return Err("tags.unsupported".to_string());
    }
    if file.app != ADP_TAGS_APP || file.tags.len() > MAX_TAGS {
        return Err("tags.invalid".to_string());
    }
    let mut ids: HashSet<&str> = HashSet::new();
    let mut names: HashSet<String> = HashSet::new();
    for tag in &file.tags {
        let name = normalize_tag_name(&tag.name);
        if !ids.insert(tag.id.as_str())
            || !names.insert(tag_name_fold(&name))
            || !is_uuid(&tag.id)
            || !is_valid_tag_name(&name)
            || !crate::tag_types::is_hex_color(&tag.color)
            || !crate::tag_types::is_valid_icon(&tag.icon_id)
        {
            return Err("tags.invalid".to_string());
        }
    }
    if let Some(assignments) = &file.assignments {
        let mut lookups: HashSet<String> = HashSet::new();
        for row in assignments {
            let key = FileIdentityKey {
                volume_id: row.volume_id.clone(),
                file_id: row.file_id.clone(),
                path_key: row.path_key.clone(),
                stable: row.stable,
            };
            if !is_valid_identity_key(&key)
                || !shared_path_ok(&row.display_path)
                || row.tag_ids.is_empty()
                || row.tag_ids.len() > MAX_ASSIGNMENT_TAGS
            {
                return Err("tags.invalid".to_string());
            }
            let mut seen: HashSet<&str> = HashSet::new();
            for id in &row.tag_ids {
                if !ids.contains(id.as_str()) || !seen.insert(id.as_str()) {
                    return Err("tags.invalid".to_string());
                }
            }
            if !lookups.insert(assignment_lookup(&key)) {
                return Err("tags.invalid".to_string());
            }
        }
    }
    Ok(())
}

/// Parse and bound one `.adptags` byte string.
pub(crate) fn decode_import(bytes: &[u8]) -> Result<AdpTagsFile, String> {
    if bytes.is_empty() || bytes.len() > MAX_IMPORT_BYTES {
        return Err("tags.limit".to_string());
    }
    let file: AdpTagsFile =
        serde_json::from_slice(bytes).map_err(|_| "tags.invalid".to_string())?;
    validate_import_file(&file)?;
    if file.assignments.is_none() && bytes.len() > MAX_CATALOG_ONLY_BYTES {
        return Err("tags.limit".to_string());
    }
    Ok(file)
}

/// Encode a schema-1 file. `rows == None` is the catalog-only default and
/// `None`/empty rows never carry a path.
pub fn encode_export(
    catalog: &TagCatalog,
    rows: Option<&[TagAssignment]>,
) -> Result<Vec<u8>, String> {
    if catalog.tags.len() > MAX_TAGS {
        return Err("tags.limit".to_string());
    }
    let file = AdpTagsFile {
        schema_version: TAG_SCHEMA_VERSION,
        app: ADP_TAGS_APP.to_string(),
        tags: catalog
            .tags
            .iter()
            .map(|tag| AdpTagsTag {
                id: tag.id.clone(),
                name: normalize_tag_name(&tag.name),
                color: tag.color.clone(),
                icon_id: tag.icon_id.clone(),
            })
            .collect(),
        assignments: rows.map(|rows| {
            rows.iter()
                .map(|row| AdpTagsAssignment {
                    volume_id: row.key.volume_id.clone(),
                    file_id: row.key.file_id.clone(),
                    path_key: row.key.path_key.clone(),
                    stable: row.key.stable,
                    display_path: row.display_path.clone(),
                    tag_ids: row.tag_ids.clone(),
                })
                .collect()
        }),
    };
    let bytes = serde_json::to_vec(&file).map_err(|_| "tags.io".to_string())?;
    let limit = if rows.is_some() {
        MAX_IMPORT_BYTES
    } else {
        MAX_CATALOG_ONLY_BYTES
    };
    if bytes.len() > limit {
        return Err("tags.limit".to_string());
    }
    Ok(bytes)
}

fn preview_catalog(file: &AdpTagsFile) -> TagCatalog {
    TagCatalog {
        schema_version: TAG_SCHEMA_VERSION,
        tags: file
            .tags
            .iter()
            .map(|tag| Tag {
                id: tag.id.clone(),
                name: normalize_tag_name(&tag.name),
                color: tag.color.clone(),
                icon_id: tag.icon_id.clone(),
                created_unix: 0,
                modified_unix: 0,
                revision: 1,
            })
            .collect(),
        revision: 0,
        history_id: None,
    }
}

fn conflicts_for(file: &AdpTagsFile, catalog: &TagCatalog) -> Vec<TagImportConflict> {
    let local_ids: HashSet<&str> = catalog.tags.iter().map(|tag| tag.id.as_str()).collect();
    let mut conflicts = Vec::new();
    for incoming in &file.tags {
        if local_ids.contains(incoming.id.as_str()) {
            continue;
        }
        let folded = tag_name_fold(&incoming.name);
        if let Some(existing) = catalog
            .tags
            .iter()
            .find(|tag| tag_name_fold(&tag.name) == folded)
        {
            conflicts.push(TagImportConflict {
                name: normalize_tag_name(&incoming.name),
                incoming_id: incoming.id.clone(),
                existing_id: existing.id.clone(),
            });
        }
    }
    conflicts
}

fn prune_previews<T>(queue: &mut VecDeque<T>, created: impl Fn(&T) -> u64, now: u64) {
    queue.retain(|entry| now.saturating_sub(created(entry)) <= PREVIEW_TTL_SECS);
}

struct ResolvedImport {
    new_tags: Vec<Tag>,
    /// Saved identity, display path and final tag IDs of one membership.
    rows: Vec<(FileIdentityKey, String, Vec<String>)>,
}

/// Apply the explicit merge/rename choices and turn the file into tags that
/// may be inserted plus membership rows. No I/O and no store access.
fn resolve_choices(
    file: &AdpTagsFile,
    choices: &[TagImportChoice],
    catalog: &TagCatalog,
) -> Result<ResolvedImport, String> {
    let conflicts = conflicts_for(file, catalog);
    if choices.len() > conflicts.len() {
        return Err("tags.invalid".to_string());
    }
    let mut handled: HashMap<&str, &TagImportChoice> = HashMap::new();
    for choice in choices {
        if !is_uuid(&choice.incoming_id)
            || handled
                .insert(choice.incoming_id.as_str(), choice)
                .is_some()
            || !conflicts
                .iter()
                .any(|conflict| conflict.incoming_id == choice.incoming_id)
        {
            return Err("tags.invalid".to_string());
        }
    }
    let local_ids: HashSet<&str> = catalog.tags.iter().map(|tag| tag.id.as_str()).collect();
    let mut id_map: HashMap<String, String> = HashMap::new();
    let mut renamed: HashMap<String, String> = HashMap::new();
    for conflict in &conflicts {
        let choice = handled
            .get(conflict.incoming_id.as_str())
            .ok_or_else(|| "tags.invalid".to_string())?;
        match choice.action.as_str() {
            "merge" => {
                let target = choice
                    .target_id
                    .as_deref()
                    .unwrap_or(conflict.existing_id.as_str());
                if target != conflict.existing_id {
                    return Err("tags.invalid".to_string());
                }
                id_map.insert(conflict.incoming_id.clone(), target.to_string());
            }
            "rename" => {
                let name = normalize_tag_name(
                    choice
                        .name
                        .as_deref()
                        .ok_or_else(|| "tags.invalid".to_string())?,
                );
                if !is_valid_tag_name(&name) {
                    return Err("tags.invalid".to_string());
                }
                renamed.insert(conflict.incoming_id.clone(), name);
            }
            _ => return Err("tags.invalid".to_string()),
        }
    }
    let mut new_tags = Vec::new();
    let mut new_names: HashSet<String> = HashSet::new();
    for incoming in &file.tags {
        if local_ids.contains(incoming.id.as_str()) {
            id_map.insert(incoming.id.clone(), incoming.id.clone());
            continue;
        }
        if id_map.contains_key(&incoming.id) {
            // Resolved by a merge choice.
            continue;
        }
        let name = renamed
            .get(&incoming.id)
            .cloned()
            .unwrap_or_else(|| normalize_tag_name(&incoming.name));
        let folded = tag_name_fold(&name);
        if catalog
            .tags
            .iter()
            .any(|tag| tag_name_fold(&tag.name) == folded)
            || !new_names.insert(folded)
        {
            return Err("tags.invalid".to_string());
        }
        let tag = Tag {
            id: incoming.id.clone(),
            name,
            color: incoming.color.clone(),
            icon_id: incoming.icon_id.clone(),
            created_unix: 0,
            modified_unix: 0,
            revision: 1,
        };
        validate_tag(&tag)?;
        new_tags.push(tag);
        id_map.insert(incoming.id.clone(), incoming.id.clone());
    }
    let mut rows = Vec::new();
    if let Some(assignments) = &file.assignments {
        for row in assignments {
            let mut tag_ids = Vec::new();
            for id in &row.tag_ids {
                let mapped = id_map
                    .get(id)
                    .ok_or_else(|| "tags.invalid".to_string())?;
                if !tag_ids.contains(mapped) {
                    tag_ids.push(mapped.clone());
                }
            }
            tag_ids.sort();
            if tag_ids.is_empty() || tag_ids.len() > MAX_ASSIGNMENT_TAGS {
                return Err("tags.invalid".to_string());
            }
            rows.push((
                FileIdentityKey {
                    volume_id: row.volume_id.clone(),
                    file_id: row.file_id.clone(),
                    path_key: row.path_key.clone(),
                    stable: row.stable,
                },
                row.display_path.clone(),
                tag_ids,
            ));
        }
    }
    Ok(ResolvedImport { new_tags, rows })
}

impl TagTransfer {
    /// Parse bytes into a preview held by `preview_id`. Reading a file is the
    /// caller's job; this method performs no I/O.
    pub fn preview_bytes(
        &self,
        bytes: &[u8],
        catalog: &TagCatalog,
    ) -> Result<TagImportPreview, String> {
        let file = decode_import(bytes)?;
        let conflicts = conflicts_for(&file, catalog);
        let catalog_preview = preview_catalog(&file);
        if !crate::tag_types::catalog_is_bounded(&catalog_preview) {
            return Err("tags.limit".to_string());
        }
        let preview = TagImportPreview {
            preview_id: uuid::Uuid::new_v4().to_string(),
            catalog: catalog_preview,
            contains_paths: file.assignments.is_some(),
            conflicts: conflicts.clone(),
        };
        let now = unix_now();
        let mut queue = lock(&self.previews)?;
        prune_previews(&mut queue, |entry: &StoredPreview| entry.created_unix, now);
        while queue.len() >= MAX_PREVIEWS {
            queue.pop_front();
        }
        queue.push_back(StoredPreview {
            id: preview.preview_id.clone(),
            created_unix: now,
            file,
            conflicts,
        });
        Ok(preview)
    }

    /// Read one `.adptags` file from an explicit absolute path.
    pub fn preview_path(
        &self,
        path: &Path,
        catalog: &TagCatalog,
    ) -> Result<TagImportPreview, String> {
        let path = import_path(path)?;
        let metadata = fs::metadata(&path).map_err(|_| "tags.io".to_string())?;
        if !metadata.is_file() || metadata.len() > MAX_IMPORT_BYTES as u64 {
            return Err("tags.limit".to_string());
        }
        let bytes = fs::read(&path).map_err(|_| "tags.io".to_string())?;
        self.preview_bytes(&bytes, catalog)
    }

    /// Apply one preview. The preview is consumed only when the import
    /// committed; an error leaves it available for a corrected retry.
    pub fn apply_preview(
        &self,
        preview_id: &str,
        choices: &[TagImportChoice],
        allow_paths: bool,
        store: &TagStore,
        history: &TagHistory,
    ) -> Result<TagCatalog, String> {
        if !is_uuid(preview_id) {
            return Err("tags.invalid".to_string());
        }
        let stored = {
            let mut queue = lock(&self.previews)?;
            let now = unix_now();
            prune_previews(&mut queue, |entry: &StoredPreview| entry.created_unix, now);
            queue
                .iter()
                .find(|entry| entry.id == preview_id)
                .cloned()
                .ok_or_else(|| "tags.changed".to_string())?
        };
        let catalog = store.catalog()?;
        if conflicts_for(&stored.file, &catalog) != stored.conflicts {
            return Err("tags.changed".to_string());
        }
        let resolved = resolve_choices(&stored.file, choices, &catalog)?;
        let mut rows = Vec::new();
        if allow_paths {
            for (saved, display_path, tag_ids) in resolved.rows {
                // A path-only identity can never be proven to be the same
                // file, so it is not attached. A stable identity that does
                // not match today's file refuses the whole import before any
                // catalog write.
                if !saved.stable {
                    continue;
                }
                if !shared_path_ok(&display_path) {
                    return Err("tags.invalid".to_string());
                }
                let current = fs_service::capture_file_identity(Path::new(&display_path))
                    .map_err(|_| "tags.import_identity".to_string())?;
                if !current.stable
                    || current.volume_id != saved.volume_id
                    || current.file_id != saved.file_id
                {
                    return Err("tags.import_identity".to_string());
                }
                rows.push(TagAssignment {
                    key: current,
                    display_path,
                    tag_ids,
                    revision: 1,
                });
            }
        }
        let result = if resolved.new_tags.is_empty() && rows.is_empty() {
            catalog
        } else {
            store.import_catalog(&resolved.new_tags, &rows, history)?
        };
        if let Ok(mut queue) = lock(&self.previews) {
            if let Some(index) = queue.iter().position(|entry| entry.id == preview_id) {
                queue.remove(index);
            }
        }
        Ok(result)
    }
}

fn collect_export_rows(
    store: &TagStore,
    job: &dyn TransferJob,
) -> Result<Vec<TagAssignment>, String> {
    let mut rows = Vec::new();
    let mut used = 0usize;
    let mut after: Option<String> = None;
    loop {
        if job.cancelled() {
            return Err("tags.io".to_string());
        }
        let page = store.assignment_page(after.as_deref(), 256)?;
        if page.is_empty() {
            break;
        }
        after = page.last().map(|row| assignment_lookup(&row.key));
        for row in page {
            let size = serde_json::to_vec(&row)
                .map_err(|_| "tags.io".to_string())?
                .len();
            used = used.saturating_add(size);
            if used > MEMBERSHIP_ROW_BUDGET {
                return Err("tags.limit".to_string());
            }
            rows.push(row);
        }
    }
    Ok(rows)
}

fn publish_bytes(destination: &Path, bytes: &[u8]) -> Result<PathBuf, String> {
    let parent = destination
        .parent()
        .ok_or_else(|| "tags.invalid".to_string())?;
    let name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "tags.invalid".to_string())?;
    if destination.exists() {
        return Err("tags.io".to_string());
    }
    let directory = PinnedDirectory::open(parent).map_err(|_| "tags.io".to_string())?;
    let mut output = OwnedOutput::create(&directory, "tags-export")
        .map_err(|_| "tags.io".to_string())?;
    use std::io::Write;
    output
        .file_mut()
        .write_all(bytes)
        .map_err(|_| "tags.io".to_string())?;
    output.flush_sync().map_err(|_| "tags.io".to_string())?;
    match output.publish_name(name) {
        Ok(path) => Ok(path),
        Err(OwnedIoError::TargetExists) => Err("tags.io".to_string()),
        Err(_) => Err("tags.io".to_string()),
    }
}

/// Write one `.adptags` file. The destination is never replaced.
pub fn write_export(
    destination: &Path,
    include_paths: bool,
    store: &TagStore,
    job: &dyn TransferJob,
) -> Result<TagExportResult, String> {
    let destination = export_path(destination)?;
    if job.cancelled() {
        return Err("tags.io".to_string());
    }
    let rows = if include_paths {
        Some(collect_export_rows(store, job)?)
    } else {
        None
    };
    if job.cancelled() {
        return Err("tags.io".to_string());
    }
    let catalog = store.catalog()?;
    let bytes = encode_export(&catalog, rows.as_deref())?;
    job.progress(0, 1, "");
    let path = publish_bytes(&destination, &bytes)?;
    job.progress(1, 1, "");
    Ok(TagExportResult {
        path: path
            .to_string_lossy()
            .trim_start_matches(r"\\?\")
            .to_string(),
        bytes: bytes.len() as u64,
    })
}

#[tauri::command]
pub async fn tags_import_preview(
    window: WebviewWindow,
    app: AppHandle,
    path: String,
) -> Result<TagImportPreview, String> {
    crate::ensure_main(window.label())?;
    crate::validate_absolute_path(&path).map_err(|_| "tags.invalid".to_string())?;
    // Reading the user's file and parsing it is disk work; keep it off the
    // command thread.
    tauri::async_runtime::spawn_blocking(move || {
        let transfer = app.state::<TagTransfer>();
        let store = app.state::<TagStore>();
        transfer.preview_path(Path::new(&path), &store.catalog()?)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn tags_import_apply(
    window: WebviewWindow,
    app: AppHandle,
    preview_id: String,
    choices: Vec<TagImportChoice>,
    allow_paths: bool,
) -> Result<TagCatalog, String> {
    crate::ensure_main(window.label())?;
    if choices.len() > MAX_TAGS {
        return Err("tags.invalid".to_string());
    }
    // The apply revalidates native identities (metadata-only captures) and
    // writes one SQLite transaction, all on a blocking worker.
    tauri::async_runtime::spawn_blocking(move || {
        let transfer = app.state::<TagTransfer>();
        let store = app.state::<TagStore>();
        let catalog = transfer.apply_preview(
            &preview_id,
            &choices,
            allow_paths,
            &store,
            &store.history,
        )?;
        let _ = crate::tag_search_bridge::flush_after_commit(&app);
        Ok(catalog)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn tags_export_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    store: State<'_, TagStore>,
    request_id: String,
    dest_path: String,
    include_paths: bool,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    crate::validate_absolute_path(&dest_path).map_err(|_| "tags.invalid".to_string())?;
    let destination = export_path(Path::new(&dest_path))?;
    // Validate the catalog before a job is visible.
    if store.catalog()?.tags.len() > MAX_TAGS {
        return Err("tags.limit".to_string());
    }
    let token = jobs.begin(&request_id, 1)?;
    let work_app = app.clone();
    spawn_job(app, request_id, token, move |context| {
        let store = work_app.state::<TagStore>();
        let bridge = JobBridge(context);
        let result = write_export(&destination, include_paths, &store, &bridge)?;
        serde_json::to_value(result).map_err(|_| "tags.io".to_string())
    });
    Ok(())
}

#[tauri::command]
pub fn tags_write_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    request_id: String,
    paths: Vec<String>,
    dest_dir: Option<String>,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    if paths.is_empty() || paths.len() > MAX_WRITE_PATHS {
        return Err("tags.invalid".to_string());
    }
    for path in &paths {
        crate::validate_absolute_path(path).map_err(|_| "tags.invalid".to_string())?;
    }
    if let Some(dir) = &dest_dir {
        crate::validate_absolute_path(dir).map_err(|_| "tags.invalid".to_string())?;
        if !Path::new(dir).is_dir() {
            return Err("tags.invalid".to_string());
        }
    }
    let token = jobs.begin(&request_id, paths.len())?;
    let work_app = app.clone();
    spawn_job(app, request_id, token, move |context| {
        let store = work_app.state::<TagStore>();
        let reports = work_app.state::<crate::convert_reports::ConversionReports>();
        let writer = crate::tag_xmp::JobXmpWriter { context };
        let bridge = JobBridge(context);
        let report = crate::tag_xmp::write_embedded_copies(
            &paths,
            crate::tag_xmp::EmbeddedWriteMode::NewCopy {
                dest_dir: dest_dir.as_deref().map(Path::new),
            },
            &store,
            &store.history,
            &writer,
            &bridge,
        )?;
        let page = reports.insert(report)?;
        // A published copy inherits its source tags; the mirror follows it.
        let _ = crate::tag_search_bridge::flush_after_commit(&work_app);
        serde_json::to_value(page).map_err(|_| "tags.io".to_string())
    });
    Ok(())
}

const MAX_DIALOG_TEXT: usize = 200;

fn check_picker_text(texts: &[&str]) -> Result<(), String> {
    if texts
        .iter()
        .any(|text| text.is_empty() || text.chars().count() > MAX_DIALOG_TEXT)
    {
        return Err("tags.invalid".to_string());
    }
    Ok(())
}

/// Pick an existing `.adptags` file and parse its preview. The preview holds
/// the parsed catalog only; nothing is written. A cancelled dialog is `None`.
#[tauri::command]
pub async fn tags_pick_import(
    window: WebviewWindow,
    transfer: State<'_, TagTransfer>,
    store: State<'_, TagStore>,
    title: String,
    filter_name: String,
) -> Result<Option<TagImportPreview>, String> {
    crate::ensure_main(window.label())?;
    check_picker_text(&[&title, &filter_name])?;
    let catalog = store.catalog()?;
    let owner = crate::window_handle(&window);
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        crate::file_dialogs::pick_open_path(owner, &title, &filter_name, "*.adptags")
            .map_err(|_| "tags.io".to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    let Some(path) = chosen else {
        return Ok(None);
    };
    crate::validate_absolute_path(&path).map_err(|_| "tags.invalid".to_string())?;
    transfer.preview_path(Path::new(&path), &catalog).map(Some)
}

/// Pick a destination for a catalog-only export. The export job still
/// refuses to replace an existing file; cancelling returns `None`.
#[tauri::command]
pub async fn tags_pick_export(
    window: WebviewWindow,
    title: String,
    file_name: String,
    filter_name: String,
) -> Result<Option<String>, String> {
    crate::ensure_main(window.label())?;
    check_picker_text(&[&title, &file_name, &filter_name])?;
    let owner = crate::window_handle(&window);
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        crate::file_dialogs::pick_save_path(
            owner,
            &title,
            &file_name,
            &filter_name,
            "*.adptags",
            ADP_TAGS_EXTENSION,
        )
        .map_err(|_| "tags.io".to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    if let Some(path) = &chosen {
        crate::validate_absolute_path(path).map_err(|_| "tags.invalid".to_string())?;
    }
    Ok(chosen)
}

#[cfg(test)]
mod step11b_transfer_tests {
    use super::*;
    use crate::tag_types::DEFAULT_TAG_IDS;
    use serde_json::Value;

    struct NoJob;

    impl TransferJob for NoJob {
        fn cancelled(&self) -> bool {
            false
        }

        fn progress(&self, _done: usize, _total: usize, _current: &str) {}
    }

    fn tag(id: &str, name: &str) -> Tag {
        Tag {
            id: id.to_string(),
            name: name.to_string(),
            color: "#1565C0".to_string(),
            icon_id: "tag".to_string(),
            created_unix: 0,
            modified_unix: 0,
            revision: 1,
        }
    }

    fn key(volume: &str, file: &str, path: &str, stable: bool) -> FileIdentityKey {
        FileIdentityKey {
            volume_id: volume.to_string(),
            file_id: file.to_string(),
            path_key: path.to_string(),
            stable,
        }
    }

    #[test]
    fn default_has_no_file_paths() {
        let catalog = TagCatalog {
            schema_version: TAG_SCHEMA_VERSION,
            tags: vec![tag(DEFAULT_TAG_IDS[0], "Work")],
            revision: 3,
            history_id: None,
        };
        let path = "C:\\Users\\owner\\private\\photo.jpg";
        let row = TagAssignment {
            key: key("1a2b3c4d", "0011223344556677", path, true),
            display_path: path.to_string(),
            tag_ids: vec![DEFAULT_TAG_IDS[0].to_string()],
            revision: 1,
        };
        let bytes = encode_export(&catalog, None).unwrap();
        assert!(bytes.len() <= MAX_CATALOG_ONLY_BYTES);
        let parsed: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(parsed["schema_version"], 1);
        assert_eq!(parsed["app"], ADP_TAGS_APP);
        assert!(parsed.get("assignments").is_none());
        let text = String::from_utf8(bytes).unwrap();
        assert!(!text.contains("photo.jpg"));
        assert!(!text.contains(&row.key.volume_id));
        // The opt-in file does carry the path and only identity data.
        let with_paths = encode_export(&catalog, Some(std::slice::from_ref(&row))).unwrap();
        let text = String::from_utf8(with_paths).unwrap();
        assert!(text.contains("photo.jpg"));
        assert!(!text.contains("file-bytes"));
    }

    #[test]
    fn import_identity_mismatch_refused() {
        let dir = tempfile::tempdir().unwrap();
        let photo = dir.path().join("photo.jpg");
        std::fs::write(&photo, b"\xff\xd8\xff\xd9").unwrap();
        let incoming = tag("20000000-0000-4000-8000-000000000001", "Trips");
        let catalog = TagCatalog {
            schema_version: TAG_SCHEMA_VERSION,
            tags: vec![incoming.clone()],
            revision: 0,
            history_id: None,
        };
        let row = TagAssignment {
            // A stable identity that cannot be the file on disk.
            key: key(
                "deadbeef",
                "0011223344556677",
                photo.to_str().unwrap(),
                true,
            ),
            display_path: photo.to_string_lossy().into_owned(),
            tag_ids: vec![incoming.id.clone()],
            revision: 1,
        };
        let bytes = encode_export(&catalog, Some(std::slice::from_ref(&row))).unwrap();
        let store = TagStore::open_in_memory().unwrap();
        let transfer = TagTransfer::default();
        let preview = transfer.preview_bytes(&bytes, &store.catalog().unwrap()).unwrap();
        assert!(preview.contains_paths);
        assert!(preview.conflicts.is_empty());
        let history = TagHistory::default();
        assert_eq!(
            transfer
                .apply_preview(&preview.preview_id, &[], false, &store, &history)
                .unwrap()
                .tags
                .len(),
            1
        );
        // A second preview with paths enabled refuses before any write.
        let preview = transfer.preview_bytes(&bytes, &store.catalog().unwrap()).unwrap();
        assert_eq!(
            transfer
                .apply_preview(&preview.preview_id, &[], true, &store, &history)
                .err()
                .as_deref(),
            Some("tags.import_identity")
        );
        assert_eq!(store.catalog().unwrap().tags.len(), 1);
    }

    #[test]
    fn duplicate_name_needs_an_explicit_choice() {
        let local = tag("30000000-0000-4000-8000-000000000001", "Work");
        let store = TagStore::open_in_memory().unwrap();
        let seed = TagHistory::default();
        store.save_tag(&local, 0, &seed).unwrap();
        let incoming = tag("40000000-0000-4000-8000-000000000002", "work");
        let other = tag("40000000-0000-4000-8000-000000000003", "Home");
        let file = TagCatalog {
            schema_version: TAG_SCHEMA_VERSION,
            tags: vec![incoming.clone(), other.clone()],
            revision: 0,
            history_id: None,
        };
        let bytes = encode_export(&file, None).unwrap();
        let transfer = TagTransfer::default();
        let preview = transfer.preview_bytes(&bytes, &store.catalog().unwrap()).unwrap();
        assert_eq!(preview.conflicts.len(), 1);
        assert_eq!(preview.conflicts[0].incoming_id, incoming.id);
        let history = TagHistory::default();
        assert_eq!(
            transfer
                .apply_preview(&preview.preview_id, &[], false, &store, &history)
                .err()
                .as_deref(),
            Some("tags.invalid")
        );
        let merge = TagImportChoice {
            incoming_id: incoming.id.clone(),
            action: "merge".to_string(),
            target_id: Some(local.id.clone()),
            name: None,
        };
        let catalog = transfer
            .apply_preview(&preview.preview_id, &[merge], false, &store, &history)
            .unwrap();
        assert_eq!(catalog.tags.len(), 2);
        assert!(catalog.tags.iter().any(|tag| tag.id == local.id));
        assert!(catalog.tags.iter().any(|tag| tag.id == other.id));
        assert!(!catalog.tags.iter().any(|tag| tag.id == incoming.id));
        assert!(catalog.history_id.is_some());
    }

    #[test]
    fn export_never_replaces_an_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let store = TagStore::open_in_memory().unwrap();
        let seed = TagHistory::default();
        store
            .save_tag(&tag(DEFAULT_TAG_IDS[0], "Work"), 0, &seed)
            .unwrap();
        let target = dir.path().join("catalog.adptags");
        std::fs::write(&target, b"keep-me").unwrap();
        let job = NoJob;
        assert_eq!(
            write_export(&target, false, &store, &job).err().as_deref(),
            Some("tags.io")
        );
        assert_eq!(std::fs::read(&target).unwrap(), b"keep-me");
        let fresh = dir.path().join("new-catalog.adptags");
        let result = write_export(&fresh, false, &store, &job).unwrap();
        assert_eq!(result.path, fresh.to_string_lossy());
        assert!(fresh.exists());
        assert!(result.bytes > 0);
    }
}
