//! Pure routing for index watchers. A subscription owns one root; events
//! carry the subscription generation, and only the subscription that asked
//! is removed by an unsubscribe. Paired renames keep identity; unpaired
//! renames and overflow request a bounded root rescan.

use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WatchKind {
    Create,
    Change,
    Remove,
    Rename,
    Overflow,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WatchEvent {
    pub subscription_id: String,
    pub root_id: String,
    pub root: PathBuf,
    pub generation: u64,
    pub kind: WatchKind,
    pub path: Option<PathBuf>,
    pub old_path: Option<PathBuf>,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WatchSubscription {
    pub subscription_id: String,
    pub root_id: String,
    pub root: PathBuf,
    pub generation: u64,
}

/// Map one notify 8.2.1 event for a live subscription. Access-only events
/// cannot change the index. A `ModifyKind::Name` event with both paths keeps
/// the pair (source first); a one-path rename stays unpaired so the router
/// asks for a bounded rescan instead of guessing identity.
pub fn from_notify(event: &notify::Event, subscription: &WatchSubscription) -> Option<WatchEvent> {
    let (kind, path, old_path) = match &event.kind {
        notify::EventKind::Access(_) | notify::EventKind::Any => return None,
        notify::EventKind::Create(_) => (WatchKind::Create, event.paths.first().cloned(), None),
        notify::EventKind::Remove(_) => (WatchKind::Remove, event.paths.first().cloned(), None),
        notify::EventKind::Modify(notify::event::ModifyKind::Name(_)) => {
            match event.paths.as_slice() {
                [old, new, ..] => (WatchKind::Rename, Some(new.clone()), Some(old.clone())),
                [path] => (WatchKind::Rename, Some(path.clone()), None),
                [] => (WatchKind::Rename, None, None),
            }
        }
        notify::EventKind::Modify(_) => (WatchKind::Change, event.paths.first().cloned(), None),
        // Unknown mutation: a bounded rescan is safer than an upsert guess.
        notify::EventKind::Other => (WatchKind::Overflow, None, None),
    };
    Some(WatchEvent {
        subscription_id: subscription.subscription_id.clone(),
        root_id: subscription.root_id.clone(),
        root: subscription.root.clone(),
        generation: subscription.generation,
        kind,
        path,
        old_path,
        error_code: None,
    })
}

/// notify reports a full event queue as an `Err(MaxFilesWatch)`; that is the
/// only watcher failure that must rescan the root. Other errors are reported
/// with their code and never change the index.
pub fn from_notify_error(error: &notify::Error, subscription: &WatchSubscription) -> WatchEvent {
    let (kind, code) = match &error.kind {
        notify::ErrorKind::MaxFilesWatch => (WatchKind::Overflow, "overflow"),
        notify::ErrorKind::PathNotFound => (WatchKind::Error, "path_not_found"),
        notify::ErrorKind::WatchNotFound => (WatchKind::Error, "watch_not_found"),
        notify::ErrorKind::InvalidConfig(_) => (WatchKind::Error, "invalid_config"),
        notify::ErrorKind::Io(_) => (WatchKind::Error, "io"),
        notify::ErrorKind::Generic(_) => (WatchKind::Error, "generic"),
    };
    WatchEvent {
        subscription_id: subscription.subscription_id.clone(),
        root_id: subscription.root_id.clone(),
        root: subscription.root.clone(),
        generation: subscription.generation,
        kind,
        path: error.paths.first().cloned(),
        old_path: None,
        error_code: Some(code.to_string()),
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WatchAction {
    Upsert {
        root_id: String,
        path: PathBuf,
    },
    Remove {
        root_id: String,
        path: PathBuf,
    },
    Rename {
        root_id: String,
        old_path: PathBuf,
        new_path: PathBuf,
    },
    Rescan {
        root_id: String,
        root: PathBuf,
    },
    Ignore,
}

pub struct WatchRouter {
    generation: u64,
    subscriptions: HashMap<String, WatchSubscription>,
}

impl Default for WatchRouter {
    fn default() -> Self {
        Self::new()
    }
}

impl WatchRouter {
    pub fn new() -> Self {
        Self {
            generation: 1,
            subscriptions: HashMap::new(),
        }
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    pub fn subscribe(&mut self, root_id: &str, root: &std::path::Path) -> WatchSubscription {
        let subscription = WatchSubscription {
            subscription_id: uuid::Uuid::new_v4().to_string(),
            root_id: root_id.to_string(),
            root: root.to_path_buf(),
            generation: self.generation,
        };
        self.subscriptions
            .insert(subscription.subscription_id.clone(), subscription.clone());
        subscription
    }

    /// Remove exactly one subscription. Another root or tab keeps running.
    pub fn unsubscribe(&mut self, subscription_id: &str) -> bool {
        self.subscriptions.remove(subscription_id).is_some()
    }

    /// A rebuild or an overflow starts a new generation; events from the old
    /// generation can no longer change the index.
    pub fn rotate(&mut self) -> u64 {
        self.generation = self.generation.saturating_add(1);
        for subscription in self.subscriptions.values_mut() {
            subscription.generation = self.generation;
        }
        self.generation
    }

    pub fn route(&mut self, event: &WatchEvent) -> WatchAction {
        let Some(subscription) = self.subscriptions.get(&event.subscription_id) else {
            return WatchAction::Ignore;
        };
        if event.generation < subscription.generation {
            return WatchAction::Ignore;
        }
        if event.kind == WatchKind::Error {
            return WatchAction::Ignore;
        }
        if event.kind == WatchKind::Overflow {
            let root_id = subscription.root_id.clone();
            let root = subscription.root.clone();
            self.rotate();
            return WatchAction::Rescan { root_id, root };
        }
        let Some(path) = event.path.clone() else {
            return WatchAction::Ignore;
        };
        match event.kind {
            WatchKind::Create | WatchKind::Change => WatchAction::Upsert {
                root_id: subscription.root_id.clone(),
                path,
            },
            WatchKind::Remove => WatchAction::Remove {
                root_id: subscription.root_id.clone(),
                path,
            },
            WatchKind::Rename => match event.old_path.clone() {
                Some(old_path) => WatchAction::Rename {
                    root_id: subscription.root_id.clone(),
                    old_path,
                    new_path: path,
                },
                // notify does not always pair both sides of a rename. A
                // bounded root rescan is safer than guessing identity.
                None => WatchAction::Rescan {
                    root_id: subscription.root_id.clone(),
                    root: subscription.root.clone(),
                },
            },
            WatchKind::Overflow | WatchKind::Error => WatchAction::Ignore,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{WatchAction, WatchEvent, WatchKind, WatchRouter};
    use std::path::PathBuf;

    fn event(
        subscription_id: &str,
        generation: u64,
        kind: WatchKind,
        path: Option<&str>,
        old_path: Option<&str>,
    ) -> WatchEvent {
        WatchEvent {
            subscription_id: subscription_id.to_string(),
            root_id: "root".to_string(),
            root: PathBuf::from(r"C:\Docs"),
            generation,
            kind,
            path: path.map(PathBuf::from),
            old_path: old_path.map(PathBuf::from),
            error_code: None,
        }
    }

    #[test]
    fn a_paired_rename_keeps_the_pair() {
        let mut router = WatchRouter::new();
        let subscription = router.subscribe("root", std::path::Path::new(r"C:\Docs"));
        let action = router.route(&event(
            &subscription.subscription_id,
            subscription.generation,
            WatchKind::Rename,
            Some(r"C:\Docs\new.txt"),
            Some(r"C:\Docs\old.txt"),
        ));
        assert_eq!(
            action,
            WatchAction::Rename {
                root_id: "root".to_string(),
                old_path: PathBuf::from(r"C:\Docs\old.txt"),
                new_path: PathBuf::from(r"C:\Docs\new.txt"),
            }
        );
    }

    #[test]
    fn an_unpaired_rename_rescans_the_root() {
        let mut router = WatchRouter::new();
        let subscription = router.subscribe("root", std::path::Path::new(r"C:\Docs"));
        let action = router.route(&event(
            &subscription.subscription_id,
            subscription.generation,
            WatchKind::Rename,
            Some(r"C:\Docs\new.txt"),
            None,
        ));
        assert!(matches!(action, WatchAction::Rescan { .. }));
    }

    #[test]
    fn overflow_rescans_and_rotates_the_generation() {
        let mut router = WatchRouter::new();
        let subscription = router.subscribe("root", std::path::Path::new(r"C:\Docs"));
        let before = router.generation();
        let action = router.route(&event(
            &subscription.subscription_id,
            subscription.generation,
            WatchKind::Overflow,
            None,
            None,
        ));
        assert!(matches!(action, WatchAction::Rescan { .. }));
        assert!(router.generation() > before);
    }

    #[test]
    fn one_unsubscribe_leaves_the_other_subscription() {
        let mut router = WatchRouter::new();
        let first = router.subscribe("one", std::path::Path::new(r"C:\One"));
        let second = router.subscribe("two", std::path::Path::new(r"C:\Two"));
        assert!(router.unsubscribe(&first.subscription_id));
        let action = router.route(&event(
            &second.subscription_id,
            second.generation,
            WatchKind::Change,
            Some(r"C:\Two\a.txt"),
            None,
        ));
        assert!(matches!(action, WatchAction::Upsert { .. }));
    }

    #[test]
    fn a_stale_generation_is_ignored() {
        let mut router = WatchRouter::new();
        let subscription = router.subscribe("root", std::path::Path::new(r"C:\Docs"));
        let stale = subscription.generation;
        router.rotate();
        let action = router.route(&event(
            &subscription.subscription_id,
            stale,
            WatchKind::Change,
            Some(r"C:\Docs\a.txt"),
            None,
        ));
        assert_eq!(action, WatchAction::Ignore);
    }
}
