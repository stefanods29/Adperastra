//! Explicit duplicate cleanup gate (Step 11c T5, `duplicate-review-1`).
//!
//! The review UI starts with every copy kept. Cleanup is a separate,
//! explicit plan bound to exact file identities, stamps and full hashes.
//! While an exact approved-object recycling operation is not proved (the
//! current Recycle Bin path is still path-based), `cleanup_available` stays
//! false and every prepare/execute attempt returns
//! `storage.cleanup_unavailable` before any write. Path revalidation alone
//! is never presented as closing the TOCTOU gap.
#![allow(dead_code)]


use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use ::storage_scan::limits::{CLEANUP_PLAN_TTL_SECS, MAX_GROUP_MEMBERS};
use ::storage_scan::{DuplicateCleanupPlan, DuplicateGroup, DuplicateMember, PlanBinding};
use fs_service::{capture_source_stamp, FileIdentityKey, SourceStamp};

/// The honest capability state of this step. There is no replace or
/// permanent-delete fallback and no path-only workaround.
pub fn cleanup_capability() -> bool {
    false
}

#[derive(Debug, Clone)]
struct StoredPlan {
    plan: DuplicateCleanupPlan,
    created_unix: u64,
}

#[derive(Default)]
pub struct DuplicateCleanupService {
    plans: Mutex<HashMap<String, StoredPlan>>,
    history_reservations: AtomicUsize,
}

impl DuplicateCleanupService {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn capability(&self) -> bool {
        cleanup_capability()
    }

    /// Prepare a native plan. Without a proved object-bound recycle path
    /// this refuses before making a plan, because no cleanup action can be
    /// honestly offered.
    pub fn prepare(
        &self,
        scan_id: &str,
        generation: u64,
        groups: &[DuplicateGroup],
        selected: &[FileIdentityKey],
        keepers: &[FileIdentityKey],
        now_unix: u64,
    ) -> Result<DuplicateCleanupPlan, String> {
        if !self.capability() {
            return Err("storage.cleanup_unavailable".to_string());
        }
        if selected.is_empty()
            || selected.len() > MAX_GROUP_MEMBERS as usize
            || keepers.is_empty()
            || keepers.len() > MAX_GROUP_MEMBERS as usize
        {
            return Err("storage.invalid".to_string());
        }
        let mut plan = build_plan(scan_id, generation, groups, selected, keepers, now_unix)?;
        plan.plan_id = uuid::Uuid::new_v4().to_string();
        self.plans
            .lock()
            .map_err(|_| "storage.unavailable".to_string())?
            .insert(
                plan.plan_id.clone(),
                StoredPlan {
                    plan: plan.clone(),
                    created_unix: now_unix,
                },
            );
        Ok(plan)
    }

    /// Execute only after every binding is revalidated. The capability gate
    /// runs before the plan is read and before any history reservation.
    pub fn execute(&self, plan_id: &str, now_unix: u64) -> Result<(), String> {
        if !self.capability() {
            return Err("storage.cleanup_unavailable".to_string());
        }
        let plan = {
            let plans = self
                .plans
                .lock()
                .map_err(|_| "storage.unavailable".to_string())?;
            plans
                .get(plan_id)
                .cloned()
                .ok_or_else(|| "storage.invalid".to_string())?
        };
        if now_unix >= plan.plan.expires_unix
            || now_unix.saturating_sub(plan.created_unix) > CLEANUP_PLAN_TTL_SECS
        {
            return Err("duplicates.changed".to_string());
        }
        validate_bindings(&plan.plan, now_unix)?;
        validate_hashes(&plan.plan)?;
        // The object-bound recycle implementation is not registered while
        // `cleanup_capability()` is false. Never fall back to a path-only
        // recycle or a permanent delete, and never advance the Undo cursor
        // for a cleanup that did not happen.
        Err("storage.cleanup_unavailable".to_string())
    }

    /// Test/diagnostic counter: a failed execute must leave it at zero
    /// because the Undo cursor was never advanced.
    #[allow(dead_code)] // Read by the T5 fail-closed oracle.
    pub fn history_reservations(&self) -> usize {
        self.history_reservations.load(Ordering::Relaxed)
    }

    #[allow(dead_code)] // Plan expiry cleanup for the coordinator.
    pub fn forget(&self, plan_id: &str) {
        if let Ok(mut plans) = self.plans.lock() {
            plans.remove(plan_id);
        }
    }
}

/// Pure plan construction used by the tests even while the production
/// capability is false.
#[allow(dead_code)] // Exercised by the T5 native oracles.
pub fn build_plan(
    scan_id: &str,
    generation: u64,
    groups: &[DuplicateGroup],
    selected: &[FileIdentityKey],
    keepers: &[FileIdentityKey],
    now_unix: u64,
) -> Result<DuplicateCleanupPlan, String> {
    if selected.is_empty() || keepers.is_empty() {
        return Err("storage.invalid".to_string());
    }
    let mut bindings: HashMap<String, (String, DuplicateMember)> = HashMap::new();
    for group in groups {
        if !group.verified || !group.members_page_complete {
            continue;
        }
        for member in &group.members {
            bindings.insert(identity_key(&member.key), (group.id.clone(), member.clone()));
        }
    }
    let mut seen = std::collections::HashSet::new();
    for key in selected.iter().chain(keepers.iter()) {
        let text = identity_key(key);
        if !seen.insert(text.clone()) {
            return Err("storage.invalid".to_string());
        }
        if !bindings.contains_key(&text) {
            return Err("storage.invalid".to_string());
        }
    }
    for key in selected {
        if keepers.iter().any(|keeper| identity_key(keeper) == identity_key(key)) {
            return Err("storage.invalid".to_string());
        }
    }

    // Every touched group must keep at least one physical member that is
    // not selected for recycling.
    let mut touched: HashMap<String, (usize, usize)> = HashMap::new();
    for group in groups {
        if !group.verified || !group.members_page_complete {
            continue;
        }
        let member_keys: Vec<String> = group
            .members
            .iter()
            .map(|member| identity_key(&member.key))
            .collect();
        let selected_count = selected
            .iter()
            .filter(|key| member_keys.contains(&identity_key(key)))
            .count();
        let keeper_count = keepers
            .iter()
            .filter(|key| member_keys.contains(&identity_key(key)))
            .count();
        if selected_count > 0 || keeper_count > 0 {
            touched.insert(group.id.clone(), (group.members.len(), selected_count));
        }
    }
    for (group_id, (members, selected_count)) in touched {
        if selected_count >= members {
            return Err("duplicates.keep_one".to_string());
        }
        let kept = keepers.iter().any(|key| {
            bindings
                .get(&identity_key(key))
                .is_some_and(|(id, _)| id == &group_id)
        });
        if !kept {
            return Err("duplicates.keep_one".to_string());
        }
    }

    let expected_selected = bindings_for(selected, &bindings)?;
    let expected_keepers = bindings_for(keepers, &bindings)?;
    Ok(DuplicateCleanupPlan {
        plan_id: String::new(),
        scan_id: scan_id.to_string(),
        generation,
        selected: selected.to_vec(),
        keepers: keepers.to_vec(),
        expires_unix: now_unix.saturating_add(CLEANUP_PLAN_TTL_SECS),
        expected_selected,
        expected_keepers,
    })
}

fn bindings_for(
    keys: &[FileIdentityKey],
    bindings: &HashMap<String, (String, DuplicateMember)>,
) -> Result<Vec<PlanBinding>, String> {
    let mut out = Vec::new();
    for key in keys {
        let (_, member) = bindings
            .get(&identity_key(key))
            .ok_or_else(|| "storage.invalid".to_string())?;
        out.push(PlanBinding {
            key: key.clone(),
            source: member.source.clone(),
            full_hash: member.full_hash.clone(),
        });
    }
    Ok(out)
}

/// Revalidate every selected and keeper stamp against the current object.
pub fn validate_bindings(plan: &DuplicateCleanupPlan, _now_unix: u64) -> Result<(), String> {
    for binding in plan.expected_selected.iter().chain(plan.expected_keepers.iter()) {
        let current = capture_source_stamp(Path::new(&binding.key.path_key))
            .map_err(|_| "duplicates.changed".to_string())?;
        if !stamp_matches(&current, &binding.source) {
            return Err("duplicates.changed".to_string());
        }
    }
    Ok(())
}

/// Recompute the full hash of every selected and keeper before mutation.
pub fn validate_hashes(plan: &DuplicateCleanupPlan) -> Result<(), String> {
    for binding in plan.expected_selected.iter().chain(plan.expected_keepers.iter()) {
        let candidate = crate::duplicate_candidates::CandidateFile {
            paths: vec![binding.key.path_key.clone()],
            key: binding.key.clone(),
            source: binding.source.clone(),
            identity: fs_service::owned_io::SourceIdentity::capture(Path::new(
                &binding.key.path_key,
            ))
            .map_err(|_| "duplicates.changed".to_string())?,
            logical_bytes: binding.source.size_bytes,
            allocated_bytes: None,
            modified_unix: 0,
        };
        let cancel = fs_service::new_cancellation_token();
        let hash = crate::duplicate_hash::full_hash_guarded(&candidate, &cancel, &mut |_| {})?;
        if hex(&hash) != binding.full_hash {
            return Err("duplicates.changed".to_string());
        }
    }
    Ok(())
}

fn stamp_matches(after: &SourceStamp, before: &SourceStamp) -> bool {
    after.path_key == before.path_key
        && after.volume_id == before.volume_id
        && after.file_id == before.file_id
        && after.modified_ticks == before.modified_ticks
        && after.size_bytes == before.size_bytes
}

pub fn identity_key(key: &FileIdentityKey) -> String {
    format!(
        "{}:{}:{}",
        key.volume_id, key.file_id, key.path_key
    )
}

pub fn hex(hash: &[u8; 32]) -> String {
    let mut text = String::with_capacity(64);
    for byte in hash {
        text.push_str(&format!("{byte:02x}"));
    }
    text
}
