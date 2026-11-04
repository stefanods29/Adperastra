//! Native storage-provider contract (Step 12a, `storage-providers-1`).
//! Every owned store registers one provider; the UI sends only a category id.

use std::sync::Arc;

use fs_service::CancellationToken;
use pack_store::types::{is_safe_integer, ClearStorageResult, StorageCategory, StorageReport};

/// One owned data category. Implementations keep their own root and handles;
/// the registry never gives them a path from the UI.
pub trait StorageProvider: Send + Sync {
    fn category(&self) -> StorageCategory;

    fn report(&self) -> Result<StorageReport, String>;

    /// Clear what this provider owns. Leased entries become pending delete
    /// and stay counted; source files are never touched.
    fn clear(&self, token: &CancellationToken) -> Result<ClearStorageResult, String>;

    /// Fixed-size providers keep the default `storage.unsupported` refusal
    /// instead of pretending a limit changed.
    fn set_limit(&self, _bytes: u64) -> Result<(), String> {
        Err("storage.unsupported".to_string())
    }
}

pub type SharedStorageProvider = Arc<dyn StorageProvider>;

/// A byte limit must survive JSON and be non-negative.
pub fn validate_storage_limit(bytes: u64) -> Result<u64, String> {
    if !is_safe_integer(bytes) {
        return Err("storage.bad_request".to_string());
    }
    Ok(bytes)
}

/// True when a provider result names the category it was registered for.
pub fn result_matches(category: StorageCategory, result: &ClearStorageResult) -> bool {
    result.category == category
        && result.errors.len() <= 64
        && result.errors.iter().all(|error| error.starts_with("storage."))
}

/// True when a report names the category it was registered for.
pub fn report_matches(category: StorageCategory, report: &StorageReport) -> bool {
    report.category == category && !report.loss_key.trim().is_empty()
}
