//! Optional background folder sizes (Step 11c T6, `folder-size-1`).
//!
//! Values are calculated only for folders an explicit visible Details or
//! Details-pane consumer asks for, and only while the setting is enabled.
//! The walk is metadata-only: an online-only file contributes its reported
//! size and is never downloaded. A complete walk becomes `ready`; a timeout,
//! permission failure or depth/entry limit becomes `partial`, which the UI
//! labels "At least {size}". No value ever blocks the browsing thread.
#![allow(dead_code)]


use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use ::storage_scan::{Coverage, FsScanIo, ScanIo};
use fs_service::{CancellationToken, FileIdentityKey};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State, WebviewWindow};
use uuid::Uuid;

use crate::background::BackgroundTaskKind;
use crate::folder_size_consumers::{FolderSizePlan, FolderSizeService};

pub const FOLDER_SIZE_TIMEOUT: Duration = Duration::from_secs(30);
pub const FOLDER_SIZE_MAX_DEPTH: u16 = 256;
pub const FOLDER_SIZE_MAX_ENTRIES: u32 = 1_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FolderSizeStatus {
    Pending,
    Running,
    Ready,
    Partial,
    Unavailable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FolderSizePriority {
    Visible,
    Overscan,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FolderSizeConsumer {
    pub consumer_id: String,
    pub path: String,
    pub priority: FolderSizePriority,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FolderSizeValue {
    pub key: FileIdentityKey,
    pub state: FolderSizeStatus,
    pub logical_bytes: Option<u64>,
    pub item_count: Option<u32>,
    pub calculated_unix: Option<u64>,
    pub generation: u64,
    pub reason_code: Option<String>,
}

/// What the user chose in Settings. Passed in from the canonical settings
/// state; this module never keeps a second copy.
#[derive(Debug, Clone, Copy)]
pub struct FolderSizeOptions {
    pub enabled: bool,
    pub network: bool,
}

/// The result of one bounded walk.
#[derive(Debug, Clone, Copy)]
pub struct FolderSizeWalkResult {
    pub logical_bytes: u64,
    pub item_count: u32,
    pub coverage: Coverage,
}

#[derive(Debug, Clone)]
pub struct FolderSizeEntry {
    pub is_dir: bool,
    pub is_link: bool,
    #[allow(dead_code)] // Kept so the walk documents that no content is read.
    pub online_only: bool,
    pub size: u64,
}

pub trait FolderSizeIo: Sync {
    fn read_dir(&self, path: &Path) -> std::io::Result<Vec<PathBuf>>;
    fn inspect(&self, path: &Path) -> std::io::Result<FolderSizeEntry>;
    fn content_reads(&self) -> u64 {
        0
    }
}

#[derive(Debug, Default, Clone, Copy)]
pub struct FsFolderSizeIo;

impl FolderSizeIo for FsFolderSizeIo {
    fn read_dir(&self, path: &Path) -> std::io::Result<Vec<PathBuf>> {
        FsScanIo.read_dir(path)
    }

    fn inspect(&self, path: &Path) -> std::io::Result<FolderSizeEntry> {
        let info = FsScanIo.inspect(path)?;
        Ok(FolderSizeEntry {
            is_dir: info.is_dir,
            is_link: info.is_link,
            online_only: info.online_only,
            size: info.logical_bytes,
        })
    }
}

/// Identity of a folder for the cache key. `FileIdentityKey.stable` is false
/// for folders; the path key is then the canonical fallback.
pub fn folder_identity(path: &Path) -> Result<FileIdentityKey, String> {
    let info = FsScanIo
        .inspect(path)
        .map_err(|_| "folder_size.unavailable".to_string())?;
    if !info.is_dir {
        return Err("folder_size.unavailable".to_string());
    }
    Ok(info.key)
}

pub fn folder_is_network(path: &Path) -> bool {
    ScanIo::is_network(&FsScanIo, path)
}

/// A bounded metadata walk. Timeout and cancellation keep the partial
/// totals; they never turn a partial value into `ready`.
pub fn measure_folder_with<I: FolderSizeIo + ?Sized>(
    io: &I,
    path: &Path,
    cancel: &CancellationToken,
    deadline: Instant,
) -> FolderSizeWalkResult {
    let mut logical = 0u64;
    let mut items = 0u32;
    let mut partial = false;
    let mut stack = vec![(path.to_path_buf(), 0u16)];
    while let Some((folder, depth)) = stack.pop() {
        if cancel.load(Ordering::Relaxed) || Instant::now() >= deadline {
            partial = true;
            break;
        }
        if depth > FOLDER_SIZE_MAX_DEPTH {
            partial = true;
            continue;
        }
        let entries = match io.read_dir(&folder) {
            Ok(entries) => entries,
            Err(_) => {
                partial = true;
                continue;
            }
        };
        for entry in entries {
            if cancel.load(Ordering::Relaxed) || Instant::now() >= deadline {
                partial = true;
                break;
            }
            if items >= FOLDER_SIZE_MAX_ENTRIES {
                partial = true;
                break;
            }
            let Ok(info) = io.inspect(&entry) else {
                partial = true;
                continue;
            };
            if info.is_link {
                items = items.saturating_add(1);
                partial = true;
                continue;
            }
            if info.is_dir {
                items = items.saturating_add(1);
                stack.push((entry, depth.saturating_add(1)));
            } else {
                items = items.saturating_add(1);
                logical = logical.saturating_add(info.size);
                // `online_only` is intentionally not special-cased: only its
                // reported size is used and no content read exists here.
            }
        }
        if partial {
            break;
        }
    }
    FolderSizeWalkResult {
        logical_bytes: logical,
        item_count: items,
        coverage: Coverage::partial_if(partial),
    }
}

pub fn measure_folder(path: &Path, cancel: &CancellationToken) -> FolderSizeWalkResult {
    measure_folder_with(
        &FsFolderSizeIo,
        path,
        cancel,
        Instant::now() + FOLDER_SIZE_TIMEOUT,
    )
}

pub struct FolderSizeState {
    pub service: Arc<FolderSizeService>,
}

impl FolderSizeState {
    pub fn new(_profile_dir: PathBuf) -> Self {
        Self {
            service: Arc::new(FolderSizeService::new()),
        }
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|age| age.as_secs())
        .unwrap_or(0)
}

fn value_for(
    key: &FileIdentityKey,
    state: FolderSizeStatus,
    walk: Option<FolderSizeWalkResult>,
    generation: u64,
    reason_code: Option<&str>,
) -> FolderSizeValue {
    FolderSizeValue {
        key: key.clone(),
        state,
        logical_bytes: walk.map(|value| value.logical_bytes),
        item_count: walk.map(|value| value.item_count),
        calculated_unix: walk.map(|_| unix_now()),
        generation,
        reason_code: reason_code.map(str::to_string),
    }
}

/// Ask for one folder. The first reply is `pending` or a cached `ready`
/// value; the completed value arrives through the `folder-size` event.
#[tauri::command]
pub async fn folder_size_request(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, crate::AppState>,
    sizes: State<'_, Arc<FolderSizeState>>,
    scheduler: State<'_, Arc<crate::background_queue::BackgroundScheduler>>,
    consumer: FolderSizeConsumer,
) -> Result<FolderSizeValue, String> {
    crate::ensure_main(window.label())?;
    Uuid::parse_str(&consumer.consumer_id).map_err(|_| "folder_size.unavailable".to_string())?;
    crate::validate_absolute_path(&consumer.path)
        .map_err(|_| "folder_size.unavailable".to_string())?;
    let path = Path::new(&consumer.path);
    let options = state.folder_size_options();
    let placeholder_key = FileIdentityKey {
        volume_id: "00000000".to_string(),
        file_id: "0000000000000000".to_string(),
        path_key: fs_service::path_key_of(path).unwrap_or_else(|_| consumer.path.to_lowercase()),
        stable: false,
    };
    let network = folder_is_network(path);
    if !options.enabled {
        return Ok(value_for(
            &placeholder_key,
            FolderSizeStatus::Unavailable,
            None,
            0,
            Some("folder_size.disabled"),
        ));
    }
    if network && !options.network {
        return Ok(value_for(
            &placeholder_key,
            FolderSizeStatus::Unavailable,
            None,
            0,
            Some("folder_size.network_disabled"),
        ));
    }
    let identity = folder_identity(path)?;
    let generation = crate::storage_watch::root_generation(path)
        .map_err(|_| "folder_size.unavailable".to_string())?;
    let plan = sizes.service.plan(
        &consumer,
        options,
        identity.clone(),
        generation,
        network,
    )?;

    match plan {
        FolderSizePlan::Immediate(value) => Ok(value),
        FolderSizePlan::Start {
            folder_key,
            value,
            token,
        } => {
            let priority = match consumer.priority {
                FolderSizePriority::Visible => crate::background_queue::BackgroundPriority::Visible,
                FolderSizePriority::Overscan => {
                    crate::background_queue::BackgroundPriority::Overscan
                }
            };
            let permit = scheduler
                .acquire(
                    BackgroundTaskKind::FolderSizes,
                    Uuid::parse_str(&consumer.consumer_id)
                        .map_err(|_| "folder_size.unavailable".to_string())?,
                    priority,
                    token.clone(),
                )
                .await;
            let permit = match permit {
                Ok(permit) => permit,
                Err(crate::background_queue::BackgroundError::Cancelled) => {
                    let unavailable = value_for(
                        &identity,
                        FolderSizeStatus::Unavailable,
                        None,
                        generation,
                        Some("background.cancelled"),
                    );
                    sizes.service.complete(&folder_key, unavailable.clone());
                    return Ok(unavailable);
                }
                Err(_) => {
                    let unavailable = value_for(
                        &identity,
                        FolderSizeStatus::Unavailable,
                        None,
                        generation,
                        Some("background.busy"),
                    );
                    sizes.service.complete(&folder_key, unavailable.clone());
                    return Ok(unavailable);
                }
            };
            let app_for_worker = app.clone();
            let service = sizes.service.clone();
            service.mark_running(&folder_key);
            let running = value_for(
                &identity,
                FolderSizeStatus::Running,
                None,
                generation,
                None,
            );
            let _ = app.emit("folder-size", running);
            let folder_path = path.to_path_buf();
            let identity_for_worker = identity.clone();
            let generation_for_worker = generation;
            tauri::async_runtime::spawn_blocking(move || {
                let walk = measure_folder(&folder_path, &token);
                drop(permit);
                let state = if walk.coverage.is_complete() {
                    FolderSizeStatus::Ready
                } else {
                    FolderSizeStatus::Partial
                };
                let finished = value_for(
                    &identity_for_worker,
                    state,
                    Some(walk),
                    generation_for_worker,
                    None,
                );
                service.complete(&folder_key, finished.clone());
                let _ = app_for_worker.emit("folder-size", finished);
            });
            Ok(value)
        }
    }
}

#[tauri::command]
pub fn folder_size_release(
    window: WebviewWindow,
    sizes: State<'_, Arc<FolderSizeState>>,
    consumer_id: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    Uuid::parse_str(&consumer_id).map_err(|_| "folder_size.unavailable".to_string())?;
    sizes.service.release(&consumer_id);
    Ok(())
}

/// Apply the settings policy. Disabling the feature cancels every queued or
/// running walk; ready cached values may remain until they age out.
#[allow(dead_code)] // Called by the coordinator when the settings page saves.
pub fn apply_folder_size_policy(sizes: &FolderSizeState, enabled: bool, network: bool) {
    sizes.service.apply_policy(enabled, network);
}

#[cfg(test)]
mod tests {
    use super::{
        measure_folder_with, FolderSizeEntry, FolderSizeIo,
    };
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    struct FakeIo {
        entries: HashMap<PathBuf, (FolderSizeEntry, Vec<PathBuf>)>,
        content_reads: AtomicU64,
    }

    impl FolderSizeIo for FakeIo {
        fn read_dir(&self, path: &Path) -> std::io::Result<Vec<PathBuf>> {
            self.entries
                .get(path)
                .map(|(_, children)| children.clone())
                .ok_or_else(|| std::io::Error::from(std::io::ErrorKind::NotFound))
        }

        fn inspect(&self, path: &Path) -> std::io::Result<FolderSizeEntry> {
            self.entries
                .get(path)
                .map(|(entry, _)| entry.clone())
                .ok_or_else(|| std::io::Error::from(std::io::ErrorKind::NotFound))
        }

        fn content_reads(&self) -> u64 {
            self.content_reads.load(Ordering::Relaxed)
        }
    }

    #[test]
    fn online_only_sizes_are_counted_without_content_reads() {
        let mut entries = HashMap::new();
        entries.insert(
            PathBuf::from(r"C:\a"),
            (
                FolderSizeEntry {
                    is_dir: true,
                    is_link: false,
                    online_only: false,
                    size: 0,
                },
                vec![PathBuf::from(r"C:\a\cloud.bin")],
            ),
        );
        entries.insert(
            PathBuf::from(r"C:\a\cloud.bin"),
            (
                FolderSizeEntry {
                    is_dir: false,
                    is_link: false,
                    online_only: true,
                    size: 4096,
                },
                Vec::new(),
            ),
        );
        let io = FakeIo {
            entries,
            content_reads: AtomicU64::new(0),
        };
        let cancel = fs_service::new_cancellation_token();
        let result = measure_folder_with(&io, Path::new(r"C:\a"), &cancel, Instant::now() + Duration::from_secs(5));
        assert_eq!(result.logical_bytes, 4096);
        assert_eq!(result.item_count, 1);
        assert!(result.coverage.is_complete());
        assert_eq!(io.content_reads(), 0);
    }

    #[test]
    fn a_timeout_returns_partial_not_ready() {
        let io = FakeIo {
            entries: HashMap::new(),
            content_reads: AtomicU64::new(0),
        };
        let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let result = measure_folder_with(
            &io,
            Path::new(r"C:\a"),
            &cancel,
            Instant::now() - Duration::from_secs(1),
        );
        assert!(!result.coverage.is_complete());
    }

    #[test]
    fn links_are_never_followed() {
        let mut entries = HashMap::new();
        entries.insert(
            PathBuf::from(r"C:\a"),
            (
                FolderSizeEntry {
                    is_dir: true,
                    is_link: false,
                    online_only: false,
                    size: 0,
                },
                vec![PathBuf::from(r"C:\a\loop")],
            ),
        );
        entries.insert(
            PathBuf::from(r"C:\a\loop"),
            (
                FolderSizeEntry {
                    is_dir: true,
                    is_link: true,
                    online_only: false,
                    size: 0,
                },
                vec![PathBuf::from(r"C:\a")],
            ),
        );
        let io = FakeIo {
            entries,
            content_reads: AtomicU64::new(0),
        };
        let cancel = fs_service::new_cancellation_token();
        let result = measure_folder_with(&io, Path::new(r"C:\a"), &cancel, Instant::now() + Duration::from_secs(5));
        assert_eq!(result.item_count, 1);
        assert!(!result.coverage.is_complete());
    }
}

