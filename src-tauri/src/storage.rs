//! The storage-provider registry and its Tauri commands (Step 12a E3/E4).
//! The UI supplies only a `StorageCategory`; no command accepts a path.
#![allow(dead_code)]


use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use fs_service::OpProgress;
use pack_store::download_state::{DownloadPhase, DownloadRecord, DownloadStateStore};
use pack_store::types::{ClearStorageResult, StorageCategory, StorageReport};
use tauri::{AppHandle, State, WebviewWindow};

use crate::jobs::{spawn_job, Jobs};
use crate::storage_types::{
    report_matches, result_matches, validate_storage_limit, SharedStorageProvider, StorageProvider,
};
use crate::{ensure_main, valid_request_id};

/// All registered storage providers. The registry owns no files itself.
#[derive(Clone, Default)]
pub struct StorageProviders {
    providers: Arc<Mutex<BTreeMap<StorageCategory, SharedStorageProvider>>>,
}

impl StorageProviders {
    pub fn new() -> Self {
        Self::default()
    }

    /// One provider per category; a second registration is refused rather
    /// than silently replacing the owner of the data.
    pub fn register(&self, provider: SharedStorageProvider) -> Result<(), String> {
        let category = provider.category();
        let mut providers = self
            .providers
            .lock()
            .map_err(|_| "storage.failed".to_string())?;
        if providers.contains_key(&category) {
            return Err("storage.bad_request".to_string());
        }
        providers.insert(category, provider);
        Ok(())
    }

    /// Every registered store, in the fixed Settings order. A failing or
    /// mislabelled provider fails the whole report instead of hiding a row.
    pub fn report(&self) -> Result<Vec<StorageReport>, String> {
        let providers = {
            let map = self
                .providers
                .lock()
                .map_err(|_| "storage.failed".to_string())?;
            map.iter()
                .map(|(category, provider)| (*category, Arc::clone(provider)))
                .collect::<Vec<_>>()
        };
        let mut reports = Vec::with_capacity(providers.len());
        for (category, provider) in providers {
            let report = provider.report()?;
            if !report_matches(category, &report) {
                return Err("storage.failed".to_string());
            }
            reports.push(report);
        }
        reports.sort_by_key(|report| {
            StorageCategory::ALL
                .iter()
                .position(|category| *category == report.category)
                .unwrap_or(usize::MAX)
        });
        Ok(reports)
    }

    /// Clear exactly one category through its owner. A path is not part of
    /// this API and cannot reach a provider.
    pub fn clear(
        &self,
        category: StorageCategory,
        token: &fs_service::CancellationToken,
    ) -> Result<ClearStorageResult, String> {
        let provider = {
            let map = self
                .providers
                .lock()
                .map_err(|_| "storage.failed".to_string())?;
            map.get(&category).cloned()
        }
        .ok_or_else(|| "storage.bad_request".to_string())?;
        if token.load(std::sync::atomic::Ordering::Relaxed) {
            return Err("storage.busy".to_string());
        }
        let result = provider.clear(token)?;
        if !result_matches(category, &result) {
            return Err("storage.failed".to_string());
        }
        Ok(result)
    }

    pub fn set_limit(&self, category: StorageCategory, bytes: u64) -> Result<(), String> {
        validate_storage_limit(bytes)?;
        let provider = {
            let map = self
                .providers
                .lock()
                .map_err(|_| "storage.failed".to_string())?;
            map.get(&category).cloned()
        }
        .ok_or_else(|| "storage.bad_request".to_string())?;
        provider.set_limit(bytes)
    }

    pub fn registered_categories(&self) -> Vec<StorageCategory> {
        self.providers
            .lock()
            .map(|map| map.keys().copied().collect())
            .unwrap_or_default()
    }
}

/// The pack download partials under `<packs>/downloads` (Step 12a T4). It
/// reports only files named by a valid download record and clears only a
/// paused/failed download whose owner marker and retained length still match.
pub struct PackDownloadsProvider {
    downloads: DownloadStateStore,
}

impl PackDownloadsProvider {
    pub fn new(packs_root: &Path) -> Self {
        Self {
            downloads: DownloadStateStore::new(packs_root),
        }
    }

    fn record_bytes(&self, record: &DownloadRecord) -> u64 {
        let Ok(paths) = self.downloads.paths(&record.download_id) else {
            return 0;
        };
        [paths.part, paths.record, paths.owner]
            .iter()
            .filter_map(|path| std::fs::metadata(path).ok())
            .filter(|metadata| metadata.is_file())
            .fold(0u64, |total, metadata| {
                total.saturating_add(metadata.len())
            })
    }
}

impl StorageProvider for PackDownloadsProvider {
    fn category(&self) -> StorageCategory {
        StorageCategory::PackDownloads
    }

    fn report(&self) -> Result<StorageReport, String> {
        let records = self
            .downloads
            .list()
            .map_err(|error| error.code().to_string())?;
        let mut disk_bytes = 0u64;
        let mut pending_delete_bytes = 0u64;
        let mut busy = false;
        for record in &records {
            let bytes = self.record_bytes(record);
            disk_bytes = disk_bytes.saturating_add(bytes);
            if matches!(
                record.state,
                DownloadPhase::Downloading | DownloadPhase::Verifying
            ) {
                pending_delete_bytes = pending_delete_bytes.saturating_add(bytes);
                busy = true;
            }
        }
        Ok(StorageReport {
            category: StorageCategory::PackDownloads,
            disk_bytes,
            memory_bytes: 0,
            pending_delete_bytes,
            limit_bytes: 0,
            clearable: true,
            loss_key: "storage.lossDownloads".to_string(),
            busy,
        })
    }

    fn clear(
        &self,
        token: &fs_service::CancellationToken,
    ) -> Result<ClearStorageResult, String> {
        let records = self
            .downloads
            .list()
            .map_err(|error| error.code().to_string())?;
        let mut freed_bytes = 0u64;
        let mut pending_bytes = 0u64;
        let mut errors = Vec::new();
        for record in records {
            if token.load(Ordering::Relaxed) {
                return Err("storage.busy".to_string());
            }
            match record.state {
                DownloadPhase::Downloading | DownloadPhase::Verifying => {
                    pending_bytes = pending_bytes.saturating_add(self.record_bytes(&record));
                }
                DownloadPhase::Paused | DownloadPhase::Failed => {
                    match pack_store::download::clear_owned_download(&self.downloads, &record) {
                        Ok(bytes) => freed_bytes = freed_bytes.saturating_add(bytes),
                        Err(pack_store::PackError::Busy)
                        | Err(pack_store::PackError::Changed) => {
                            pending_bytes =
                                pending_bytes.saturating_add(self.record_bytes(&record));
                        }
                        Err(_) => {
                            let code = "storage.failed".to_string();
                            if errors.len() < 64 && !errors.contains(&code) {
                                errors.push(code);
                            }
                        }
                    }
                }
            }
        }
        Ok(ClearStorageResult {
            category: StorageCategory::PackDownloads,
            freed_bytes,
            pending_bytes,
            complete: pending_bytes == 0 && errors.is_empty(),
            errors,
        })
    }
}

#[tauri::command]
pub async fn storage_report(
    window: WebviewWindow,
    providers: State<'_, StorageProviders>,
) -> Result<Vec<StorageReport>, String> {
    ensure_main(window.label())?;
    let providers = providers.inner().clone();
    tauri::async_runtime::spawn_blocking(move || providers.report())
        .await
        .map_err(|_| "storage.failed".to_string())?
}

#[tauri::command]
pub fn storage_clear_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    providers: State<'_, StorageProviders>,
    request_id: String,
    category: StorageCategory,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    let token = jobs.begin(&request_id, 1)?;
    let providers = providers.inner().clone();
    let job_id = request_id.clone();
    spawn_job(app, job_id, token, move |context| {
        context.set_progress(&OpProgress {
            items_done: 0,
            items_total: 1,
            bytes_done: 0,
            bytes_total: 0,
            current: String::new(),
        });
        let result = providers.clear(category, context.token())?;
        context.set_progress(&OpProgress {
            items_done: 1,
            items_total: 1,
            bytes_done: result.freed_bytes,
            bytes_total: result.freed_bytes,
            current: String::new(),
        });
        serde_json::to_value(result).map_err(|_| "storage.failed".to_string())
    });
    Ok(())
}

#[tauri::command]
pub async fn storage_set_limit(
    window: WebviewWindow,
    providers: State<'_, StorageProviders>,
    category: StorageCategory,
    bytes: u64,
) -> Result<(), String> {
    ensure_main(window.label())?;
    validate_storage_limit(bytes)?;
    let providers = providers.inner().clone();
    tauri::async_runtime::spawn_blocking(move || providers.set_limit(category, bytes))
        .await
        .map_err(|_| "storage.failed".to_string())?
}

#[cfg(test)]
#[path = "storage_step12a_tests.rs"]
mod storage_step12a_tests;
