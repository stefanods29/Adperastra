//! Root-generation and watcher invalidation rules (Step 11c T2/U3).
//!
//! The 09a multiplexed watcher owns the `fs-watch` subscription. This module
//! keeps the small, pure part the storage cache needs: a bounded root
//! generation from the root's own metadata, and the rule that any change or
//! overflow marks a cached summary stale and asks for a bounded rescan. A
//! paired rename is never assumed; `old_path` may be absent.

use std::path::Path;

use ::storage_scan::{ScanIo, StorageSummary};

use crate::storage_store::StorageStore;

/// The root's own 100 ns `LastWriteTime` acts as a bounded generation:
/// adding, removing or renaming an entry changes it. Content-only changes do
/// not, which is why every open still starts a bounded refresh. Only the low
/// 53 bits are kept so the value stays a JSON-safe integer number.
pub fn root_generation(path: &Path) -> Result<u64, String> {
    let info = ::storage_scan::FsScanIo
        .inspect(path)
        .map_err(|_| "storage.unavailable".to_string())?;
    if !info.is_dir {
        return Err("storage.invalid".to_string());
    }
    Ok(info.modified_ticks & ((1u64 << 53) - 1))
}

/// Every watcher event that can change totals or names invalidates the
/// cached page. An error is also treated as a reason to refresh.
#[allow(dead_code)] // Shared with the T2 watch oracles and the UI rescan rule.
pub fn event_invalidates(kind: &str) -> bool {
    matches!(
        kind,
        "create" | "change" | "remove" | "rename" | "overflow" | "error"
    )
}

/// Mark a summary as cached-but-not-current. The caller keeps showing it
/// until the bounded rescan finishes; it never claims current coverage.
#[allow(dead_code)] // Used by the coordinator's watcher callback.
pub fn mark_stale(summary: &mut StorageSummary) {
    summary.stale = true;
}

/// The storage cache key: root identity, watch generation, scanner version
/// and the validated scan options. The version is part of the text so a
/// future scanner cannot reuse old rows.
#[allow(dead_code)] // Exact key helper for the coordinator's cache checks.
pub fn cache_key(root_key: &str, generation: u64, options_key: &str) -> String {
    format!(
        "v{}|{}|{}|{}",
        ::storage_scan::SCANNER_VERSION,
        root_key,
        generation,
        options_key
    )
}

/// A captured generation still describes the current root.
#[allow(dead_code)] // Pure decision kept for the T2 cache oracles.
pub fn generation_is_current(captured: u64, current: u64) -> bool {
    captured == current
}

/// A cached summary is stale when either its generation changed or the
/// watcher overflowed. It remains visible; it is not deleted.
#[allow(dead_code)] // Pure decision kept for the T2 cache oracles.
pub fn cached_summary_is_stale(captured: u64, current: u64, overflow: bool) -> bool {
    overflow || !generation_is_current(captured, current)
}

/// Ask the store for a cached page only when its key is still valid. This is
/// deliberately a pure decision so the coordinator can test it without a
/// running WebView or watcher.
#[allow(dead_code)] // Advisory helper for the coordinator's cached-first paint.
pub fn cached_page_is_usable(
    store: &StorageStore,
    root_key: &str,
    generation: u64,
    options_key: &str,
    current_scan: &str,
) -> Result<Option<crate::storage_store::CachedScan>, String> {
    store.find_cached(root_key, generation, options_key, current_scan)
}

#[cfg(test)]
mod tests {
    use super::{
        cached_summary_is_stale, cache_key, event_invalidates, generation_is_current,
    };

    #[test]
    fn every_change_and_overflow_invalidates() {
        for kind in ["create", "change", "remove", "rename", "overflow", "error"] {
            assert!(event_invalidates(kind), "{kind}");
        }
        assert!(!event_invalidates("noop"));
    }

    #[test]
    fn a_changed_generation_is_stale() {
        assert!(generation_is_current(9, 9));
        assert!(!generation_is_current(9, 10));
        assert!(cached_summary_is_stale(9, 10, false));
        assert!(cached_summary_is_stale(9, 9, true));
        assert!(!cached_summary_is_stale(9, 9, false));
    }

    #[test]
    fn the_cache_key_contains_the_scanner_version_and_options() {
        let key = cache_key("c:\\a", 4, "allow_network=false");
        assert!(key.starts_with("v1|"));
        assert!(key.contains("c:\\a"));
        assert!(key.contains("allow_network=false"));
    }
}
