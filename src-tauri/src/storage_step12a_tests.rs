//! Step 12a T4 tests: the native storage registry accepts only categories,
//! keeps leased bytes counted and lets a provider clear only its own store.

use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use fs_service::{new_cancellation_token, CancellationToken};
use pack_store::types::{ClearStorageResult, StorageCategory, StorageReport};

use super::StorageProviders;
use crate::storage_types::StorageProvider;

struct FakeProvider {
    category: StorageCategory,
    report: Mutex<StorageReport>,
    clear_result: Mutex<ClearStorageResult>,
    clears: AtomicUsize,
    source: Option<PathBuf>,
    store: Option<PathBuf>,
}

impl FakeProvider {
    fn new(category: StorageCategory, report: StorageReport) -> Arc<Self> {
        Arc::new(Self {
            category,
            report: Mutex::new(report),
            clear_result: Mutex::new(ClearStorageResult::empty(category)),
            clears: AtomicUsize::new(0),
            source: None,
            store: None,
        })
    }
}

impl StorageProvider for FakeProvider {
    fn category(&self) -> StorageCategory {
        self.category
    }

    fn report(&self) -> Result<StorageReport, String> {
        Ok(self.report.lock().map_err(|_| "storage.failed")?.clone())
    }

    fn clear(&self, _token: &CancellationToken) -> Result<ClearStorageResult, String> {
        self.clears.fetch_add(1, Ordering::SeqCst);
        if let (Some(source), Some(store)) = (&self.source, &self.store) {
            let bytes = std::fs::metadata(store).map(|meta| meta.len()).unwrap_or(0);
            std::fs::remove_file(store).map_err(|_| "storage.failed")?;
            debug_assert!(source.exists());
            let mut result = self
                .clear_result
                .lock()
                .map_err(|_| "storage.failed")?;
            result.freed_bytes = bytes;
            return Ok(result.clone());
        }
        Ok(self.clear_result.lock().map_err(|_| "storage.failed")?.clone())
    }
}

fn report(category: StorageCategory) -> StorageReport {
    StorageReport {
        category,
        disk_bytes: 0,
        memory_bytes: 0,
        pending_delete_bytes: 0,
        limit_bytes: 512 * 1024 * 1024,
        clearable: true,
        loss_key: category.default_loss_key().to_string(),
        busy: false,
    }
}

#[test]
fn clear_accepts_category_only() {
    // The function type has no path argument; passing one cannot compile.
    let clear: fn(
        &StorageProviders,
        StorageCategory,
        &CancellationToken,
    ) -> Result<ClearStorageResult, String> = StorageProviders::clear;
    assert!(serde_json::from_str::<StorageCategory>("\"C:\\\\Users\\\\me\"").is_err());
    assert!(serde_json::from_str::<StorageCategory>("\"versions\"").is_ok());

    let providers = StorageProviders::new();
    let fake = FakeProvider::new(StorageCategory::Versions, report(StorageCategory::Versions));
    providers.register(fake.clone()).unwrap();
    let token = new_cancellation_token();
    let result = clear(&providers, StorageCategory::Versions, &token).unwrap();
    assert_eq!(result.category, StorageCategory::Versions);
    assert_eq!(fake.clears.load(Ordering::SeqCst), 1);
    assert_eq!(
        clear(&providers, StorageCategory::Clipboard, &token).unwrap_err(),
        "storage.bad_request"
    );
}

#[test]
fn leased_cache_stays_counted() {
    let providers = StorageProviders::new();
    let mut row = report(StorageCategory::Thumbnails);
    row.memory_bytes = 10 * 1024 * 1024;
    row.pending_delete_bytes = 10 * 1024 * 1024;
    let fake = FakeProvider::new(StorageCategory::Thumbnails, row);
    {
        let mut result = fake.clear_result.lock().unwrap();
        result.freed_bytes = 0;
        result.pending_bytes = 10 * 1024 * 1024;
        result.complete = false;
    }
    providers.register(fake).unwrap();
    let token = new_cancellation_token();

    let cleared = providers.clear(StorageCategory::Thumbnails, &token).unwrap();
    assert_eq!(cleared.freed_bytes, 0);
    assert_eq!(cleared.pending_bytes, 10 * 1024 * 1024);
    assert!(!cleared.complete);

    let after = providers.report().unwrap();
    assert_eq!(after[0].pending_delete_bytes, 10 * 1024 * 1024);
}

#[test]
fn clear_versions_does_not_touch_sources() {
    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("Keep this document.txt");
    let store = temporary.path().join("version-store.bin");
    std::fs::write(&source, b"Keep this document.").unwrap();
    std::fs::write(&store, b"kept previous version").unwrap();
    let before = pack_store::validation::sha256_hex(&std::fs::read(&source).unwrap());

    let providers = StorageProviders::new();
    let mut fake = FakeProvider::new(StorageCategory::Versions, report(StorageCategory::Versions));
    {
        let provider = Arc::get_mut(&mut fake).unwrap();
        provider.source = Some(source.clone());
        provider.store = Some(store.clone());
    }
    providers.register(fake).unwrap();
    let result = providers
        .clear(StorageCategory::Versions, &new_cancellation_token())
        .unwrap();
    assert!(result.freed_bytes > 0);
    let after = pack_store::validation::sha256_hex(&std::fs::read(&source).unwrap());
    assert_eq!(before, after);
    assert!(!store.exists());
}

#[test]
fn every_registered_store_is_reported() {
    let providers = StorageProviders::new();
    for category in [
        StorageCategory::Versions,
        StorageCategory::Thumbnails,
        StorageCategory::Clipboard,
    ] {
        providers
            .register(FakeProvider::new(category, report(category)))
            .unwrap();
    }
    let rows = providers.report().unwrap();
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0].category, StorageCategory::Thumbnails);
    assert_eq!(rows[1].category, StorageCategory::Versions);
    assert_eq!(rows[2].category, StorageCategory::Clipboard);
}

#[test]
fn duplicate_category_rejected() {
    let providers = StorageProviders::new();
    let first = FakeProvider::new(StorageCategory::Recovery, report(StorageCategory::Recovery));
    let second = FakeProvider::new(StorageCategory::Recovery, report(StorageCategory::Recovery));
    providers.register(first).unwrap();
    assert_eq!(
        providers.register(second).unwrap_err(),
        "storage.bad_request"
    );
    assert_eq!(providers.report().unwrap().len(), 1);
}

#[test]
fn unsafe_limit_is_refused() {
    let providers = StorageProviders::new();
    let fake = FakeProvider::new(StorageCategory::Recovery, report(StorageCategory::Recovery));
    providers.register(fake).unwrap();
    assert_eq!(
        providers
            .set_limit(StorageCategory::Recovery, pack_store::types::MAX_SAFE_INTEGER + 1)
            .unwrap_err(),
        "storage.bad_request"
    );
}
