//! Shared folder-size consumers (Step 11c T6/U2/U3).
//!
//! Consumers are keyed by folder identity plus the recursive-watch
//! generation. The first visible consumer starts work; a second consumer of
//! the same folder joins it; releasing the final consumer cancels queued or
//! running work. All work is admitted by the shared 07a background scheduler
//! (two permits in total), so this module never spawns 500 parallel walks.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use fs_service::{CancellationToken, FileIdentityKey};

use crate::folder_sizes::{
    FolderSizeConsumer, FolderSizeOptions, FolderSizeStatus, FolderSizeValue,
};

#[derive(Debug, Clone)]
pub enum FolderSizePlan {
    /// A cached, ready value or a policy refusal; nothing to walk.
    Immediate(FolderSizeValue),
    /// Register the consumer and run one bounded walk.
    Start {
        folder_key: String,
        value: FolderSizeValue,
        token: CancellationToken,
    },
}

struct FolderEntry {
    value: FolderSizeValue,
    consumers: HashSet<String>,
    token: Option<CancellationToken>,
}

#[derive(Default)]
struct Inner {
    folders: HashMap<String, FolderEntry>,
    consumers: HashMap<String, String>,
}

#[derive(Default)]
pub struct FolderSizeService {
    inner: Mutex<Inner>,
}

impl FolderSizeService {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn folder_key(identity: &FileIdentityKey, generation: u64) -> String {
        format!(
            "{}:{}:{}|{}",
            identity.volume_id, identity.file_id, identity.path_key, generation
        )
    }

    pub fn plan(
        &self,
        consumer: &FolderSizeConsumer,
        options: FolderSizeOptions,
        identity: FileIdentityKey,
        generation: u64,
        is_network: bool,
    ) -> Result<FolderSizePlan, String> {
        if consumer.consumer_id.is_empty() || consumer.path.is_empty() {
            return Err("folder_size.unavailable".to_string());
        }
        let identity_for_value = identity.clone();
        let unavailable = move |reason: &str| FolderSizePlan::Immediate(FolderSizeValue {
            key: identity_for_value.clone(),
            state: FolderSizeStatus::Unavailable,
            logical_bytes: None,
            item_count: None,
            calculated_unix: None,
            generation,
            reason_code: Some(reason.to_string()),
        });
        if !options.enabled {
            return Ok(unavailable("folder_size.disabled"));
        }
        if is_network && !options.network {
            return Ok(unavailable("folder_size.network_disabled"));
        }
        let key = Self::folder_key(&identity, generation);
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "folder_size.unavailable".to_string())?;

        if let Some(previous) = inner.consumers.insert(
            consumer.consumer_id.clone(),
            key.clone(),
        ) {
            if previous != key {
                if let Some(old) = inner.folders.get_mut(&previous) {
                    old.consumers.remove(&consumer.consumer_id);
                }
            }
        }

        if let Some(entry) = inner.folders.get(&key) {
            if matches!(entry.value.state, FolderSizeStatus::Unavailable)
                && entry.token.is_none()
            {
                // A policy refusal or cancellation is not a cached result;
                // a later explicit request starts a fresh bounded walk.
                inner.folders.remove(&key);
            } else if let Some(entry) = inner.folders.get_mut(&key) {
                entry.consumers.insert(consumer.consumer_id.clone());
                return Ok(FolderSizePlan::Immediate(entry.value.clone()));
            }
        }

        let value = FolderSizeValue {
            key: identity,
            state: FolderSizeStatus::Pending,
            logical_bytes: None,
            item_count: None,
            calculated_unix: None,
            generation,
            reason_code: None,
        };
        if inner.folders.len() >= 256 {
            if let Some(oldest) = inner
                .folders
                .iter()
                .find(|(_, entry)| entry.token.is_none() && entry.consumers.is_empty())
                .map(|(key, _)| key.clone())
            {
                inner.folders.remove(&oldest);
            }
        }
        let token = fs_service::new_cancellation_token();
        let mut consumers = HashSet::new();
        consumers.insert(consumer.consumer_id.clone());
        inner.folders.insert(
            key.clone(),
            FolderEntry {
                value: value.clone(),
                consumers,
                token: Some(token.clone()),
            },
        );
        Ok(FolderSizePlan::Start {
            folder_key: key,
            value,
            token,
        })
    }

    /// Mark the admitted walk as running without dropping its cancellation
    /// token. The UI can show `running` before the first result event.
    pub fn mark_running(&self, folder_key: &str) {
        if let Ok(mut inner) = self.inner.lock() {
            if let Some(entry) = inner.folders.get_mut(folder_key) {
                entry.value.state = FolderSizeStatus::Running;
            }
        }
    }

    /// Mark one walk finished. Only a complete walk is `ready`; partial
    /// totals stay `partial` and are never labelled complete. A value that
    /// finished after its last consumer released it stays `unavailable`.
    pub fn complete(&self, folder_key: &str, value: FolderSizeValue) {
        if let Ok(mut inner) = self.inner.lock() {
            if let Some(entry) = inner.folders.get_mut(folder_key) {
                if entry.token.is_some() {
                    entry.value = value;
                }
                entry.token = None;
            }
        }
    }

    /// Release one consumer. The final release cancels the queued/running
    /// walk; a ready cached value may remain for a later view.
    pub fn release(&self, consumer_id: &str) -> bool {
        let Ok(mut inner) = self.inner.lock() else {
            return false;
        };
        let Some(key) = inner.consumers.remove(consumer_id) else {
            return false;
        };
        let Some(entry) = inner.folders.get_mut(&key) else {
            return false;
        };
        entry.consumers.remove(consumer_id);
        if entry.consumers.is_empty() {
            if let Some(token) = &entry.token {
                token.store(true, std::sync::atomic::Ordering::Relaxed);
            }
            entry.token = None;
            if matches!(
                entry.value.state,
                FolderSizeStatus::Pending | FolderSizeStatus::Running
            ) {
                entry.value.state = FolderSizeStatus::Unavailable;
                entry.value.reason_code = Some("folder_size.cancelled".to_string());
            }
            return true;
        }
        false
    }

    /// Settings changed. Disabling cancels every active walk and refuses
    /// new work; no ready value is deleted.
    #[allow(dead_code)] // Driven through `apply_folder_size_policy`.
    pub fn apply_policy(&self, enabled: bool, _network: bool) {
        if enabled {
            return;
        }
        if let Ok(mut inner) = self.inner.lock() {
            for entry in inner.folders.values_mut() {
                if let Some(token) = &entry.token {
                    token.store(true, std::sync::atomic::Ordering::Relaxed);
                }
                entry.token = None;
                if matches!(
                    entry.value.state,
                    FolderSizeStatus::Pending | FolderSizeStatus::Running
                ) {
                    entry.value.state = FolderSizeStatus::Unavailable;
                    entry.value.reason_code = Some("folder_size.disabled".to_string());
                }
            }
            inner.consumers.clear();
        }
    }

    /// Test/diagnostic view of one cached value.
    #[allow(dead_code)] // Read by the T6 consumer oracles.
    pub fn value_for_key(&self, folder_key: &str) -> Option<FolderSizeValue> {
        self.inner
            .lock()
            .ok()
            .and_then(|inner| inner.folders.get(folder_key).map(|entry| entry.value.clone()))
    }

    #[allow(dead_code)] // Read by the T6 consumer oracles.
    pub fn active_walks(&self) -> usize {
        self.inner
            .lock()
            .map(|inner| {
                inner
                    .folders
                    .values()
                    .filter(|entry| entry.token.is_some())
                    .count()
            })
            .unwrap_or(0)
    }
}

#[cfg(test)]
mod tests {
    use super::{FolderSizePlan, FolderSizeService};
    use crate::folder_sizes::{
        FolderSizeConsumer, FolderSizeOptions, FolderSizePriority, FolderSizeStatus,
        FolderSizeValue,
    };
    use fs_service::FileIdentityKey;

    fn identity(path: &str) -> FileIdentityKey {
        FileIdentityKey {
            volume_id: "00000001".to_string(),
            file_id: "0000000000000001".to_string(),
            path_key: path.to_string(),
            stable: true,
        }
    }

    fn consumer(id: &str, path: &str) -> FolderSizeConsumer {
        FolderSizeConsumer {
            consumer_id: id.to_string(),
            path: path.to_string(),
            priority: FolderSizePriority::Visible,
        }
    }

    fn options() -> FolderSizeOptions {
        FolderSizeOptions {
            enabled: true,
            network: false,
        }
    }

    #[test]
    fn network_is_off_until_explicitly_enabled() {
        let service = FolderSizeService::new();
        let plan = service
            .plan(
                &consumer("11111111-1111-4111-8111-111111111111", r"C:\a"),
                options(),
                identity("c:\\a"),
                4,
                true,
            )
            .unwrap();
        match plan {
            FolderSizePlan::Immediate(value) => {
                assert_eq!(value.state, FolderSizeStatus::Unavailable);
                assert_eq!(value.reason_code.as_deref(), Some("folder_size.network_disabled"));
            }
            FolderSizePlan::Start { .. } => panic!("a network walk must not start"),
        }
        assert_eq!(service.active_walks(), 0);
    }

    #[test]
    fn two_folders_do_not_share_a_wrong_result() {
        let service = FolderSizeService::new();
        let first = service
            .plan(
                &consumer("11111111-1111-4111-8111-111111111111", r"C:\a"),
                options(),
                identity("c:\\a"),
                4,
                false,
            )
            .unwrap();
        let second = service
            .plan(
                &consumer("22222222-2222-4222-8222-222222222222", r"C:\b"),
                options(),
                identity("c:\\b"),
                4,
                false,
            )
            .unwrap();
        let (first_key, second_key) = match (first, second) {
            (
                FolderSizePlan::Start { folder_key: first, .. },
                FolderSizePlan::Start { folder_key: second, .. },
            ) => (first, second),
            _ => panic!("both folders start their own work"),
        };
        assert_ne!(first_key, second_key);
        service.complete(
            &first_key,
            FolderSizeValue {
                key: identity("c:\\a"),
                state: FolderSizeStatus::Ready,
                logical_bytes: Some(10),
                item_count: Some(1),
                calculated_unix: Some(1),
                generation: 4,
                reason_code: None,
            },
        );
        assert_eq!(
            service.value_for_key(&second_key).unwrap().state,
            FolderSizeStatus::Pending
        );
    }

    #[test]
    fn the_last_consumer_cancels_queued_work() {
        let service = FolderSizeService::new();
        let first = "11111111-1111-4111-8111-111111111111";
        let second = "22222222-2222-4222-8222-222222222222";
        let plan = service
            .plan(
                &consumer(first, r"C:\a"),
                options(),
                identity("c:\\a"),
                4,
                false,
            )
            .unwrap();
        let (key, token) = match plan {
            FolderSizePlan::Start {
                folder_key, token, ..
            } => (folder_key, token),
            _ => panic!("first consumer starts work"),
        };
        let joined = service
            .plan(
                &consumer(second, r"C:\a"),
                options(),
                identity("c:\\a"),
                4,
                false,
            )
            .unwrap();
        assert!(matches!(joined, FolderSizePlan::Immediate(_)));
        assert!(!service.release(first));
        assert!(!token.load(std::sync::atomic::Ordering::Relaxed));
        assert!(service.release(second));
        assert!(token.load(std::sync::atomic::Ordering::Relaxed));
        assert_eq!(
            service.value_for_key(&key).unwrap().state,
            FolderSizeStatus::Unavailable
        );
    }

    #[test]
    fn disabled_refuses_without_a_walk() {
        let service = FolderSizeService::new();
        let plan = service
            .plan(
                &consumer("11111111-1111-4111-8111-111111111111", r"C:\a"),
                FolderSizeOptions {
                    enabled: false,
                    network: false,
                },
                identity("c:\\a"),
                4,
                false,
            )
            .unwrap();
        assert!(matches!(plan, FolderSizePlan::Immediate(_)));
        assert_eq!(service.active_walks(), 0);
    }
}
