//! Archives (Step 06d, contract 20): browsing sessions, opening a file
//! inside, extraction jobs. All archive bytes are read by the archive
//! helper.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, SystemTime};

use archive::{ArchiveEntry, ArchiveFormat, ArchiveTree, EntryKind};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::archive_helper::{HelperMessage, HelperRequest, HELPER_FLAG, HELPER_MEMORY_LIMIT};
use crate::helper::{self, DriveEnd, DriveTimings, HelperProcess};
use crate::jobs::{spawn_job, JobContext, Jobs};
use crate::{ensure_main, validate_absolute_path, AppState};

/// How many archives stay open at once (the least recently used goes).
pub const MAX_SESSIONS: usize = 8;
/// The most entries one folder answer carries (P-10).
pub const MAX_FOLDER_PAGE: usize = 5_000;
/// The most search results one answer carries.
pub const MAX_SEARCH_RESULTS: usize = 1_000;
/// The longest search text.
pub const MAX_SEARCH_CHARS: usize = 200;
/// The most inner paths one extraction names.
pub const MAX_EXTRACT_PATHS: usize = archive::MAX_EXTRACT_PATHS;
/// The longest inner path the commands accept, in characters.
pub const MAX_INNER_PATH: usize = 1_024;
/// The folder where open copies of files inside archives live.
pub const OPEN_FOLDER: &str = "archive-open";
/// How long such a copy is kept.
pub const OPEN_FOLDER_MAX_AGE: Duration = Duration::from_secs(24 * 60 * 60);

/// What a file tab shows about an open archive.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveSummary {
    pub session: String,
    pub format: ArchiveFormat,
    pub files: u64,
    pub folders: u64,
    pub links: u64,
    pub encrypted_entries: u64,
    pub hidden_entries: u64,
    pub total_size: u64,
    pub packed_size: u64,
    pub partial: bool,
    /// The archive is one of our own temporary copies (open mode).
    pub temporary: bool,
}

/// One row of an archive folder.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveItem {
    pub path: String,
    pub name: String,
    pub kind: EntryKind,
    pub size: u64,
    pub packed_size: u64,
    pub modified_unix: u64,
    pub encrypted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveFolderPage {
    pub items: Vec<ArchiveItem>,
    pub total: usize,
    pub truncated: bool,
}

/// Open one file that lives inside an archive.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenEntryArgs {
    pub archive: String,
    pub inner_path: String,
    pub expected_size: u64,
    pub expected_modified: u64,
}

/// Extract from an archive.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtractArgs {
    pub archive: String,
    pub paths: Vec<String>,
    pub base: String,
    pub dest_dir: String,
    pub new_folder: Option<String>,
    pub expected_size: u64,
    pub expected_modified: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenedEntry {
    pub path: String,
}

/// One open archive: its file and its browsing index.
struct Session {
    archive: PathBuf,
    tree: Arc<ArchiveTree>,
}

#[derive(Default)]
struct SessionsState {
    sessions: HashMap<String, Session>,
    /// Least recently used first.
    order: Vec<String>,
}

/// The open archives (managed state).
#[derive(Default)]
pub struct ArchiveSessions {
    state: Mutex<SessionsState>,
}

impl ArchiveSessions {
    fn lock(&self) -> Result<MutexGuard<'_, SessionsState>, String> {
        self.state.lock().map_err(|_| "archive.other".to_string())
    }

    /// Remember a freshly read archive; the oldest session makes room.
    pub fn insert(&self, id: &str, archive: PathBuf, tree: ArchiveTree) {
        let Ok(mut state) = self.lock() else {
            return;
        };
        let fresh = !state.sessions.contains_key(id);
        state.sessions.insert(
            id.to_string(),
            Session {
                archive,
                tree: Arc::new(tree),
            },
        );
        if fresh {
            state.order.push(id.to_string());
        }
        while state.order.len() > MAX_SESSIONS {
            let oldest = state.order.remove(0);
            state.sessions.remove(&oldest);
        }
    }

    /// The index of an open archive, marked as the most recently used. The
    /// caller works on the returned `Arc`, never while the lock is held.
    pub fn tree(&self, id: &str) -> Option<(PathBuf, Arc<ArchiveTree>)> {
        let mut state = self.lock().ok()?;
        let session = state.sessions.get(id)?;
        let archive = session.archive.clone();
        let tree = Arc::clone(&session.tree);
        state.order.retain(|entry| entry != id);
        state.order.push(id.to_string());
        Some((archive, tree))
    }

    pub fn remove(&self, id: &str) {
        if let Ok(mut state) = self.lock() {
            state.sessions.remove(id);
            state.order.retain(|entry| entry != id);
        }
    }
}

/// What one conversation with the helper produced.
struct HelperOutcome {
    end: DriveEnd,
    last_progress: fs_service::OpProgress,
    /// The code the helper reported, or the reason it fell silent.
    error: Option<String>,
}

impl HelperOutcome {
    fn cancelled(&self) -> bool {
        self.end == DriveEnd::Cancelled
    }
}

fn no_progress() -> fs_service::OpProgress {
    fs_service::OpProgress {
        items_done: 0,
        items_total: 0,
        bytes_done: 0,
        bytes_total: 0,
        current: String::new(),
    }
}

/// Run one helper request, passing every message that is not progress or a
/// failure to `on_message`. `Ok(true)` from it ends the work.
fn run_helper_job(
    ctx: &JobContext,
    request: &HelperRequest,
    mut on_message: impl FnMut(&HelperMessage) -> Result<bool, String>,
) -> HelperOutcome {
    let mut outcome = HelperOutcome {
        end: DriveEnd::Finished,
        last_progress: no_progress(),
        error: None,
    };
    let mut process = match HelperProcess::spawn(HELPER_FLAG, HELPER_MEMORY_LIMIT) {
        Ok(process) => process,
        Err(code) => {
            outcome.error = Some(helper_code(&code));
            return outcome;
        }
    };
    let Ok(line) = serde_json::to_string(request) else {
        outcome.error = Some("archive.helper_failed".to_string());
        return outcome;
    };
    if let Err(code) = process.send_line(&line) {
        outcome.error = Some(helper_code(&code));
        return outcome;
    }
    let mut failure: Option<String> = None;
    let end = helper::drive(
        &mut process,
        ctx.token(),
        DriveTimings::default(),
        &mut |text| {
            let message: HelperMessage =
                serde_json::from_str(text).map_err(|_| "archive.helper_failed".to_string())?;
            match &message {
                HelperMessage::Progress { progress } => {
                    outcome.last_progress = progress.clone();
                    ctx.set_progress(progress);
                    Ok(false)
                }
                HelperMessage::Failed { code } => {
                    failure = Some(code.clone());
                    Ok(true)
                }
                other => on_message(other),
            }
        },
    );
    match end {
        Ok(found) => {
            outcome.end = found;
            outcome.error = failure;
            if found == DriveEnd::Cancelled {
                outcome.error = None;
            }
        }
        Err(code) => outcome.error = Some(helper_code(&code)),
    }
    outcome
}

/// The helper's own failures become archive codes the UI knows.
fn helper_code(code: &str) -> String {
    match code {
        "helper.failed" | "helper.start_failed" => "archive.helper_failed".to_string(),
        "helper.timeout" => "archive.timeout".to_string(),
        other => other.to_string(),
    }
}

/// A path as the UI shows it (no long-path prefix).
fn display_path(path: &str) -> String {
    path.trim_start_matches(r"\\?\").to_string()
}

/// True when `archive` is one of the copies this app made in `root`.
fn temporary_archive(archive: &Path, root: &Path) -> bool {
    let Ok(root) = std::fs::canonicalize(root) else {
        return false;
    };
    let Ok(archive) = std::fs::canonicalize(archive) else {
        return false;
    };
    archive.starts_with(root)
}

/// Read an archive in the helper and remember it for browsing.
#[tauri::command]
pub fn archive_open_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    path: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    validate_absolute_path(&path).map_err(|_| "archive.bad_request".to_string())?;
    let token = jobs.begin(&request_id, 0)?;
    let work_app = app.clone();
    spawn_job(app, request_id.clone(), token, move |ctx| {
        let mut entries: Vec<ArchiveEntry> = Vec::new();
        let mut format: Option<ArchiveFormat> = None;
        let mut partial = false;
        let mut too_many = false;
        let max_entries = archive::Limits::default().max_entries;
        let outcome = run_helper_job(
            ctx,
            &HelperRequest::List { path: path.clone() },
            |message| {
                match message {
                    HelperMessage::Entries { entries: batch } => {
                        entries.extend(batch.iter().cloned());
                        if entries.len() > max_entries {
                            too_many = true;
                            return Ok(true);
                        }
                    }
                    HelperMessage::Listed {
                        format: found,
                        partial: whole,
                    } => {
                        format = Some(*found);
                        partial = *whole;
                        return Ok(true);
                    }
                    _ => {}
                }
                Ok(false)
            },
        );
        if too_many {
            return Err("archive.too_many_entries".to_string());
        }
        if let Some(code) = outcome.error {
            return Err(code);
        }
        if outcome.cancelled() {
            return Err("archive.cancelled".to_string());
        }
        let format = format.ok_or_else(|| "archive.helper_failed".to_string())?;
        let tree = ArchiveTree::build(entries);
        let stats = tree.stats();
        let data_dir = work_app.state::<AppState>().data_dir.clone();
        work_app
            .state::<ArchiveSessions>()
            .insert(&request_id, PathBuf::from(&path), tree);
        let summary = ArchiveSummary {
            session: request_id.clone(),
            format,
            files: stats.files,
            folders: stats.folders,
            links: stats.links,
            encrypted_entries: stats.encrypted,
            hidden_entries: stats.hidden,
            total_size: stats.total_size,
            packed_size: stats.packed_size,
            partial,
            temporary: temporary_archive(Path::new(&path), &data_dir.join(OPEN_FOLDER)),
        };
        serde_json::to_value(summary).map_err(|_| "archive.other".to_string())
    });
    Ok(())
}

fn items_for(tree: &ArchiveTree, indices: &[usize]) -> Vec<ArchiveItem> {
    indices
        .iter()
        .map(|index| {
            let entry = tree.entry(*index);
            ArchiveItem {
                path: entry.path.clone(),
                name: entry.name.clone(),
                kind: entry.kind,
                size: entry.size,
                packed_size: entry.packed_size,
                modified_unix: entry.modified_unix,
                encrypted: entry.encrypted,
            }
        })
        .collect()
}

#[tauri::command]
pub fn archive_folder(
    window: WebviewWindow,
    sessions: State<'_, ArchiveSessions>,
    session: String,
    folder: String,
    sort_key: String,
    sort_direction: String,
) -> Result<ArchiveFolderPage, String> {
    ensure_main(window.label())?;
    crate::valid_request_id(&session)?;
    if folder.chars().count() > MAX_INNER_PATH {
        return Err("archive.bad_request".to_string());
    }
    let sort = crate::parse_sort(&sort_key, &sort_direction)
        .map_err(|_| "archive.bad_request".to_string())?;
    let (_, tree) = sessions
        .tree(&session)
        .ok_or_else(|| "archive.no_session".to_string())?;
    let children = tree
        .sorted_children(&folder, sort)
        .ok_or_else(|| "archive.bad_request".to_string())?;
    let total = children.len();
    let page = &children[..total.min(MAX_FOLDER_PAGE)];
    Ok(ArchiveFolderPage {
        items: items_for(&tree, page),
        total,
        truncated: total > page.len(),
    })
}

#[tauri::command]
pub fn archive_search(
    window: WebviewWindow,
    sessions: State<'_, ArchiveSessions>,
    session: String,
    text: String,
) -> Result<ArchiveFolderPage, String> {
    ensure_main(window.label())?;
    crate::valid_request_id(&session)?;
    let length = text.chars().count();
    if length == 0 || length > MAX_SEARCH_CHARS {
        return Err("archive.bad_request".to_string());
    }
    let (_, tree) = sessions
        .tree(&session)
        .ok_or_else(|| "archive.no_session".to_string())?;
    let (found, total) = tree.search(&text, MAX_SEARCH_RESULTS);
    Ok(ArchiveFolderPage {
        truncated: total > found.len(),
        items: items_for(&tree, &found),
        total,
    })
}

#[tauri::command]
pub fn archive_close(
    window: WebviewWindow,
    sessions: State<'_, ArchiveSessions>,
    session: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    if crate::valid_request_id(&session).is_ok() {
        sessions.remove(&session);
    }
    Ok(())
}

/// Copy one file out of an archive and open it in a new tab.
#[tauri::command]
pub fn archive_open_entry_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    request: OpenEntryArgs,
) -> Result<(), String> {
    ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    validate_absolute_path(&request.archive).map_err(|_| "archive.bad_request".to_string())?;
    let length = request.inner_path.chars().count();
    if length == 0 || length > MAX_INNER_PATH {
        return Err("archive.bad_request".to_string());
    }
    let data_dir = app.state::<AppState>().data_dir.clone();
    let folder = data_dir.join(OPEN_FOLDER).join(&request_id);
    std::fs::create_dir_all(&folder).map_err(|_| "archive.other".to_string())?;
    let token = jobs.begin(&request_id, 1)?;
    spawn_job(app, request_id, token, move |ctx| {
        let extract_request = archive::ExtractRequest {
            paths: vec![request.inner_path.clone()],
            base: archive::parent_of(&request.inner_path).to_string(),
            dest_dir: folder.to_string_lossy().into_owned(),
            new_folder: None,
            expected_size: request.expected_size,
            expected_modified: request.expected_modified,
            single_file: true,
            zone: crate::zone::internet_zone_text(Path::new(&request.archive)),
        };
        let mut report: Option<archive::ExtractReport> = None;
        let outcome = run_helper_job(
            ctx,
            &HelperRequest::Extract {
                path: request.archive.clone(),
                request: extract_request,
            },
            |message| {
                if let HelperMessage::Extracted { report: done } = message {
                    report = Some(done.clone());
                    return Ok(true);
                }
                Ok(false)
            },
        );
        if let Some(code) = outcome.error {
            return Err(code);
        }
        if outcome.cancelled() {
            return Err("archive.cancelled".to_string());
        }
        let report = report.ok_or_else(|| "archive.helper_failed".to_string())?;
        let Some(opened) = report.opened else {
            return match report.skipped.first() {
                Some(skipped) => Err(format!("archive.{}", skipped.reason)),
                None => Err("archive.other".to_string()),
            };
        };
        // The copy belongs to the app and is only read: editors open it
        // read-only, and Save as keeps changes elsewhere.
        if let Ok(metadata) = std::fs::metadata(&opened) {
            let mut permissions = metadata.permissions();
            if !permissions.readonly() {
                permissions.set_readonly(true);
                let _ = std::fs::set_permissions(&opened, permissions);
            }
        }
        serde_json::to_value(OpenedEntry {
            path: display_path(&opened),
        })
        .map_err(|_| "archive.other".to_string())
    });
    Ok(())
}

/// The checks a plain extraction request must pass before a job starts.
pub fn check_extract_args(args: &ExtractArgs) -> Result<(), String> {
    validate_absolute_path(&args.archive).map_err(|_| "archive.bad_request".to_string())?;
    validate_absolute_path(&args.dest_dir).map_err(|_| "archive.bad_request".to_string())?;
    if args.paths.len() > MAX_EXTRACT_PATHS {
        return Err("archive.bad_request".to_string());
    }
    for path in &args.paths {
        let length = path.chars().count();
        if length == 0 || length > MAX_INNER_PATH {
            return Err("archive.bad_request".to_string());
        }
    }
    if args.base.chars().count() > MAX_INNER_PATH {
        return Err("archive.bad_request".to_string());
    }
    if let Some(name) = &args.new_folder {
        if fs_service::validate_new_name(name).is_err() {
            return Err("archive.bad_request".to_string());
        }
    }
    Ok(())
}

/// Remove the unfinished write the helper named last: our own partial file
/// next to the target, never a user file.
fn remove_partial(target: &str) {
    if target.is_empty() {
        return;
    }
    let partial = fs_service::partial_path(Path::new(target));
    if partial.symlink_metadata().is_ok() {
        let _ = std::fs::remove_file(&partial);
    }
}

/// Extract as a job in the Explorer's jobs panel.
#[tauri::command]
pub fn archive_extract_start(
    window: WebviewWindow,
    jobs: State<'_, Jobs>,
    app: AppHandle,
    request_id: String,
    request: ExtractArgs,
) -> Result<(), String> {
    ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    check_extract_args(&request)?;
    if !Path::new(&request.dest_dir).is_dir() {
        return Err("archive.dest_missing".to_string());
    }
    let token = jobs.begin(&request_id, 0)?;
    spawn_job(app, request_id, token, move |ctx| {
        let extract_request = archive::ExtractRequest {
            paths: request.paths.clone(),
            base: request.base.clone(),
            dest_dir: request.dest_dir.clone(),
            new_folder: request.new_folder.clone(),
            expected_size: request.expected_size,
            expected_modified: request.expected_modified,
            single_file: false,
            zone: crate::zone::internet_zone_text(Path::new(&request.archive)),
        };
        let mut created: Vec<String> = Vec::new();
        let mut report: Option<archive::ExtractReport> = None;
        let outcome = run_helper_job(
            ctx,
            &HelperRequest::Extract {
                path: request.archive.clone(),
                request: extract_request,
            },
            |message| {
                match message {
                    HelperMessage::Created { path } => created.push(path.clone()),
                    HelperMessage::Extracted { report: done } => {
                        report = Some(done.clone());
                        return Ok(true);
                    }
                    _ => {}
                }
                Ok(false)
            },
        );
        let cancelled =
            outcome.cancelled() || (outcome.error.is_some() && ctx.token().load(Ordering::Relaxed));
        if let Some(code) = outcome.error.clone() {
            // A killed helper can leave the file it was writing; only that
            // one partial file is removed.
            remove_partial(&outcome.last_progress.current);
            if created.is_empty() {
                return Err(code);
            }
        }
        let finished = archive::ExtractReport {
            created,
            cancelled,
            error: outcome.error,
            ..report.unwrap_or_default()
        };
        serde_json::to_value(finished).map_err(|_| "archive.other".to_string())
    });
    Ok(())
}

/// Choose a folder for "Extract to…" and "Extract selected…".
#[tauri::command]
pub async fn archive_pick_folder(
    window: WebviewWindow,
    title: String,
) -> Result<Option<String>, String> {
    ensure_main(window.label())?;
    let length = title.chars().count();
    if length == 0 || length > 200 {
        return Err("archive.bad_request".to_string());
    }
    let owner = crate::window_handle(&window);
    tauri::async_runtime::spawn_blocking(move || pick_folder(owner, &title))
        .await
        .map_err(|_| "archive.other".to_string())?
}

#[cfg(windows)]
fn pick_folder(owner: isize, title: &str) -> Result<Option<String>, String> {
    use windows::core::HSTRING;
    use windows::Win32::Foundation::E_FAIL;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        FileOpenDialog, IFileOpenDialog, FOS_FORCEFILESYSTEM, FOS_PATHMUSTEXIST, FOS_PICKFOLDERS,
        SIGDN_FILESYSPATH,
    };
    // SAFETY: COM is initialized on this blocking thread just below and
    // uninitialized again when the dialog is done; every string outlives the
    // call that uses it.
    let initialized = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }.is_ok();
    let shown = unsafe {
        CoCreateInstance::<_, IFileOpenDialog>(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)
            .and_then(|dialog| {
                dialog.SetTitle(&HSTRING::from(title))?;
                dialog.SetOptions(
                    dialog.GetOptions()?
                        | FOS_PICKFOLDERS
                        | FOS_FORCEFILESYSTEM
                        | FOS_PATHMUSTEXIST,
                )?;
                dialog.Show(Some(crate::shell::hwnd_from(owner)))?;
                let raw = dialog.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
                let path = raw.to_string();
                CoTaskMemFree(Some(raw.0 as *const _));
                path.map_err(|_| windows::core::Error::from(E_FAIL))
            })
    };
    if initialized {
        // SAFETY: pairs with the successful CoInitializeEx above.
        unsafe { CoUninitialize() };
    }
    match shown {
        Ok(path) => Ok(Some(display_path(&path))),
        Err(error) if crate::shell::is_cancelled(&error) => Ok(None),
        Err(_) => Err("archive.other".to_string()),
    }
}

#[cfg(not(windows))]
fn pick_folder(_owner: isize, _title: &str) -> Result<Option<String>, String> {
    Err("archive.other".to_string())
}

/// Remove the copies of files opened from archives that are a day old. They
/// are the app's own temporary files, never user data.
pub fn cleanup_open_folder(root: &Path, max_age: Duration, now: SystemTime) -> Result<(), String> {
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if !metadata.is_dir() {
            continue;
        }
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        let old = now
            .duration_since(modified)
            .map(|age| age >= max_age)
            .unwrap_or(false);
        if !old {
            continue;
        }
        clear_read_only(&path);
        let _ = std::fs::remove_dir_all(&path);
    }
    Ok(())
}

fn clear_read_only(folder: &Path) {
    let Ok(entries) = std::fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            clear_read_only(&path);
            continue;
        }
        if let Ok(metadata) = entry.metadata() {
            let mut permissions = metadata.permissions();
            if permissions.readonly() {
                permissions.set_readonly(false);
                let _ = std::fs::set_permissions(&path, permissions);
            }
        }
    }
}

/// Clear the open folder a day after the app starts, off the main thread.
pub fn start_cleanup(data_dir: PathBuf) {
    std::thread::spawn(move || {
        let root = data_dir.join(OPEN_FOLDER);
        let _ = cleanup_open_folder(&root, OPEN_FOLDER_MAX_AGE, SystemTime::now());
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree() -> ArchiveTree {
        ArchiveTree::build(Vec::new())
    }

    fn session(id: &str) -> PathBuf {
        PathBuf::from(format!("C:\\archives\\{id}.zip"))
    }

    #[test]
    fn sessions_drop_the_oldest() {
        let sessions = ArchiveSessions::default();
        for index in 0..9 {
            sessions.insert(&format!("s{index}"), session(&format!("s{index}")), tree());
        }
        assert!(sessions.tree("s0").is_none(), "the oldest session is gone");
        assert!(sessions.tree("s1").is_some(), "the second one remains");

        // Using a session keeps it: adding a tenth drops the third instead.
        assert!(sessions.tree("s1").is_some());
        sessions.insert("s9", session("s9"), tree());
        assert!(sessions.tree("s1").is_some(), "the used session stays");
        assert!(sessions.tree("s2").is_none(), "the unused one goes");
    }

    #[test]
    fn extract_args_are_checked() {
        let ok = ExtractArgs {
            archive: "C:\\a.zip".to_string(),
            paths: Vec::new(),
            base: String::new(),
            dest_dir: "C:\\Out".to_string(),
            new_folder: Some("notes".to_string()),
            expected_size: 1,
            expected_modified: 0,
        };
        assert_eq!(check_extract_args(&ok), Ok(()));

        let relative_destination = ExtractArgs {
            dest_dir: "Out".to_string(),
            ..ok.clone()
        };
        assert_eq!(
            check_extract_args(&relative_destination),
            Err("archive.bad_request".to_string())
        );

        let many = ExtractArgs {
            paths: (0..10_001).map(|_| "a.txt".to_string()).collect(),
            ..ok.clone()
        };
        assert_eq!(
            check_extract_args(&many),
            Err("archive.bad_request".to_string())
        );

        let long = ExtractArgs {
            paths: vec!["x".repeat(1_025)],
            ..ok.clone()
        };
        assert_eq!(
            check_extract_args(&long),
            Err("archive.bad_request".to_string())
        );

        let reserved = ExtractArgs {
            new_folder: Some("CON".to_string()),
            ..ok
        };
        assert_eq!(
            check_extract_args(&reserved),
            Err("archive.bad_request".to_string())
        );
    }

    #[test]
    fn cleanup_removes_only_old_folders() {
        let root = std::env::temp_dir().join(format!(
            "adperastra-test-06d-cleanup-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("a")).unwrap();
        std::fs::create_dir_all(root.join("b")).unwrap();
        let file = root.join("a").join("copy.md");
        std::fs::write(&file, "text").unwrap();
        let mut permissions = std::fs::metadata(&file).unwrap().permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&file, permissions).unwrap();

        // Nothing is old yet.
        cleanup_open_folder(&root, OPEN_FOLDER_MAX_AGE, SystemTime::now()).unwrap();
        assert!(root.join("a").exists());
        assert!(root.join("b").exists());

        // A day later both are gone, even with the read-only file inside.
        let later = SystemTime::now() + Duration::from_secs(25 * 60 * 60);
        cleanup_open_folder(&root, OPEN_FOLDER_MAX_AGE, later).unwrap();
        assert!(!root.join("a").exists());
        assert!(!root.join("b").exists());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn temporary_archives_are_recognized() {
        let data = std::env::temp_dir().join(format!(
            "adperastra-test-06d-temporary-{}",
            std::process::id()
        ));
        let open = data.join(OPEN_FOLDER);
        let inside = open.join("arcopen-1");
        std::fs::create_dir_all(&inside).unwrap();
        let copy = inside.join("README.txt");
        std::fs::write(&copy, "text").unwrap();
        let beside = data.join("README.txt");
        std::fs::write(&beside, "text").unwrap();

        assert!(temporary_archive(&copy, &open));
        assert!(!temporary_archive(&beside, &open));
        let _ = std::fs::remove_dir_all(&data);
    }
}
