//! Dirty-safe controlled restart between profiles (Step 10c T5).
//!
//! Prepare refuses while a job or profile lease is active and returns a
//! bounded plan (five minutes). Commit rechecks everything, writes
//! `pending_id` atomically and only then may the host restart. Startup reads
//! the pending id and commits it only after the target opened successfully;
//! a failed target keeps the previous active profile.
#![allow(dead_code)]


use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{State, WebviewWindow};
use uuid::Uuid;

use crate::ensure_main;
use crate::profile_catalog::{load_catalog, update_catalog};
use crate::profile_root::ProfileServiceState;
use crate::profile_types::{
    is_canonical_uuid, is_valid_profile_id, validate_catalog, ProfileCatalog,
};

pub const PROFILE_SWITCH_TTL_SECONDS: u64 = 300;
pub const MAX_ACTIVE_JOBS: usize = 32;
pub const MAX_OPEN_PLANS: usize = 8;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProfileSwitchPlan {
    pub plan_id: String,
    pub target_id: String,
    pub catalog_revision: u64,
    pub needs_dirty_prompt: bool,
    pub active_job_ids: Vec<String>,
    pub expires_unix: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StartupSelection {
    pub profile_id: String,
    pub pending: bool,
}

#[derive(Default)]
struct SwitchInner {
    jobs: BTreeSet<String>,
    leases: BTreeSet<String>,
    plans: BTreeMap<String, ProfileSwitchPlan>,
}

/// Managed state shared by the switch commands and the document providers.
#[derive(Default)]
pub struct ProfileSwitchState {
    inner: Mutex<SwitchInner>,
}

impl ProfileSwitchState {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, SwitchInner>, String> {
        self.inner
            .lock()
            .map_err(|_| "profiles.busy".to_string())
    }

    /// Track a long job that would make a profile switch unsafe.
    pub fn register_job(&self, id: &str) -> Result<(), String> {
        let mut inner = self.lock()?;
        if id.is_empty() || id.len() > 64 || inner.jobs.len() >= MAX_ACTIVE_JOBS {
            return Err("profiles.busy".to_string());
        }
        inner.jobs.insert(id.to_string());
        Ok(())
    }

    pub fn finish_job(&self, id: &str) {
        if let Ok(mut inner) = self.lock() {
            inner.jobs.remove(id);
        }
    }

    /// Track a live document/container lease. Native commit refuses while one
    /// exists, so no unlocked content can leak into another profile.
    pub fn acquire_lease(&self, id: &str) -> Result<(), String> {
        let mut inner = self.lock()?;
        if id.is_empty() || id.len() > 64 {
            return Err("profiles.busy".to_string());
        }
        inner.leases.insert(id.to_string());
        Ok(())
    }

    pub fn release_lease(&self, id: &str) {
        if let Ok(mut inner) = self.lock() {
            inner.leases.remove(id);
        }
    }

    /// Active jobs and leases, after dropping expired plans.
    pub fn snapshot(&self, now_unix: u64) -> Result<(Vec<String>, usize), String> {
        let mut inner = self.lock()?;
        inner
            .plans
            .retain(|_, plan| plan.expires_unix >= now_unix);
        Ok((inner.jobs.iter().cloned().collect(), inner.leases.len()))
    }

    fn store_plan(&self, plan: ProfileSwitchPlan) -> Result<(), String> {
        let mut inner = self.lock()?;
        let now = plan.expires_unix.saturating_sub(PROFILE_SWITCH_TTL_SECONDS);
        inner
            .plans
            .retain(|_, stored| stored.expires_unix >= now);
        if inner.plans.len() >= MAX_OPEN_PLANS {
            return Err("profiles.busy".to_string());
        }
        inner.plans.insert(plan.plan_id.clone(), plan);
        Ok(())
    }

    fn plan(&self, plan_id: &str) -> Result<ProfileSwitchPlan, String> {
        let inner = self.lock()?;
        inner
            .plans
            .get(plan_id)
            .cloned()
            .ok_or_else(|| "profiles.changed".to_string())
    }

    fn remove_plan(&self, plan_id: &str) {
        if let Ok(mut inner) = self.lock() {
            inner.plans.remove(plan_id);
        }
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

/// Build a plan only when the catalog is current and nothing is running.
pub fn prepare_plan(
    catalog: &ProfileCatalog,
    target_id: &str,
    active_job_ids: Vec<String>,
    active_leases: usize,
    now_unix: u64,
) -> Result<ProfileSwitchPlan, String> {
    validate_catalog(catalog)?;
    if !is_valid_profile_id(target_id) {
        return Err("profiles.invalid".to_string());
    }
    if target_id == catalog.active_id {
        return Err("profiles.invalid".to_string());
    }
    if !catalog.profiles.iter().any(|profile| profile.id == target_id) {
        return Err("profiles.invalid".to_string());
    }
    if !active_job_ids.is_empty() || active_leases > 0 {
        return Err("profiles.busy".to_string());
    }
    Ok(ProfileSwitchPlan {
        plan_id: Uuid::new_v4().to_string(),
        target_id: target_id.to_string(),
        catalog_revision: catalog.revision,
        needs_dirty_prompt: true,
        active_job_ids,
        expires_unix: now_unix.saturating_add(PROFILE_SWITCH_TTL_SECONDS),
    })
}

/// Apply a plan to the catalog, setting `pending_id`. The caller writes it
/// atomically before asking for a restart.
pub fn commit_plan(
    catalog: &mut ProfileCatalog,
    plan: &ProfileSwitchPlan,
    active_job_ids: &[String],
    active_leases: usize,
    now_unix: u64,
) -> Result<(), String> {
    validate_catalog(catalog)?;
    if !is_canonical_uuid(&plan.plan_id) {
        return Err("profiles.invalid".to_string());
    }
    if now_unix > plan.expires_unix {
        return Err("profiles.changed".to_string());
    }
    if !active_job_ids.is_empty() || active_leases > 0 {
        return Err("profiles.busy".to_string());
    }
    if catalog.revision != plan.catalog_revision {
        return Err("profiles.changed".to_string());
    }
    if !catalog
        .profiles
        .iter()
        .any(|profile| profile.id == plan.target_id)
    {
        return Err("profiles.invalid".to_string());
    }
    catalog.pending_id = Some(plan.target_id.clone());
    catalog.revision = catalog
        .revision
        .checked_add(1)
        .ok_or_else(|| "profiles.invalid".to_string())?;
    validate_catalog(catalog)
}

/// The profile the next startup should try: pending first, then active.
pub fn startup_selection(catalog: &ProfileCatalog) -> Result<StartupSelection, String> {
    validate_catalog(catalog)?;
    if let Some(pending) = catalog.pending_id.as_deref() {
        if catalog.profiles.iter().any(|profile| profile.id == pending) {
            return Ok(StartupSelection {
                profile_id: pending.to_string(),
                pending: true,
            });
        }
    }
    Ok(StartupSelection {
        profile_id: catalog.active_id.clone(),
        pending: false,
    })
}

/// After the host opened `opened`: commit success or clear a failed pending
/// attempt while keeping the previous active profile. Returns true when the
/// catalog changed.
pub fn finish_startup(
    catalog: &mut ProfileCatalog,
    opened: &str,
    success: bool,
) -> Result<bool, String> {
    validate_catalog(catalog)?;
    if success {
        if catalog.pending_id.as_deref() == Some(opened) {
            catalog.active_id = opened.to_string();
            catalog.pending_id = None;
            catalog.revision = catalog
                .revision
                .checked_add(1)
                .ok_or_else(|| "profiles.invalid".to_string())?;
            validate_catalog(catalog)?;
            return Ok(true);
        }
        if catalog.pending_id.is_some() {
            catalog.pending_id = None;
            catalog.revision = catalog
                .revision
                .checked_add(1)
                .ok_or_else(|| "profiles.invalid".to_string())?;
            validate_catalog(catalog)?;
            return Ok(true);
        }
        return Ok(false);
    }
    if catalog.pending_id.is_some() {
        catalog.pending_id = None;
        catalog.revision = catalog
            .revision
            .checked_add(1)
            .ok_or_else(|| "profiles.invalid".to_string())?;
        validate_catalog(catalog)?;
        return Ok(true);
    }
    Ok(false)
}

/// Write the pending catalog entry; the restart happens only after this.
pub fn commit_switch(
    base: &Path,
    plan: &ProfileSwitchPlan,
    active_job_ids: &[String],
    active_leases: usize,
    now_unix: u64,
) -> Result<ProfileCatalog, String> {
    update_catalog(base, |catalog| {
        commit_plan(catalog, plan, active_job_ids, active_leases, now_unix)?;
        Ok(true)
    })
}

/// Read the startup choice without writing anything.
pub fn startup_profile(base: &Path) -> Result<StartupSelection, String> {
    let catalog = load_catalog(base)?;
    startup_selection(&catalog)
}

/// Commit the result of the startup attempt.
pub fn commit_startup_profile(
    base: &Path,
    opened: &str,
    success: bool,
) -> Result<ProfileCatalog, String> {
    update_catalog(base, |catalog| finish_startup(catalog, opened, success))
}

#[tauri::command]
pub async fn profile_switch_prepare(
    window: WebviewWindow,
    state: State<'_, ProfileServiceState>,
    target_id: String,
) -> Result<ProfileSwitchPlan, String> {
    ensure_main(window.label())?;
    if !is_valid_profile_id(&target_id) {
        return Err("profiles.invalid".to_string());
    }
    let now = unix_now();
    let (jobs, leases) = state.switch.snapshot(now)?;
    if !jobs.is_empty() || leases > 0 {
        return Err("profiles.busy".to_string());
    }
    let location = state.location.clone();
    let plan = tauri::async_runtime::spawn_blocking(move || {
        let catalog = load_catalog(&location.data_dir)?;
        // The target must be writable before a restart is allowed. Resolve
        // its root without changing the catalog, then probe only its own
        // profile folder.
        let target_root =
            crate::profile_root::resolve_profile_root_for(&location, &catalog, &target_id)?;
        crate::profile_root::ensure_profile_writable(&location, &target_root)?;
        prepare_plan(&catalog, &target_id, jobs, leases, now)
    })
    .await
    .map_err(|error| error.to_string())??;
    state.switch.store_plan(plan.clone())?;
    Ok(plan)
}

#[tauri::command]
pub async fn profile_switch_commit(
    window: WebviewWindow,
    state: State<'_, ProfileServiceState>,
    plan_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    if !is_canonical_uuid(&plan_id) {
        return Err("profiles.invalid".to_string());
    }
    let now = unix_now();
    let plan = state.switch.plan(&plan_id)?;
    let (jobs, leases) = state.switch.snapshot(now)?;
    if !jobs.is_empty() || leases > 0 {
        return Err("profiles.busy".to_string());
    }
    let base = state.location.data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || commit_switch(&base, &plan, &jobs, leases, now))
        .await
        .map_err(|error| error.to_string())??;
    state.switch.remove_plan(&plan_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile_types::{ProfileDescriptor, DEFAULT_PROFILE_ID};

    fn two_profiles() -> (ProfileCatalog, String) {
        let mut catalog = ProfileCatalog::new(10);
        let id = Uuid::new_v4().to_string();
        catalog.profiles.push(ProfileDescriptor {
            id: id.clone(),
            name: "Work".to_string(),
            created_unix: 10,
            modified_unix: 10,
        });
        (catalog, id)
    }

    #[test]
    fn an_active_job_refuses_prepare() {
        let (catalog, id) = two_profiles();
        assert_eq!(
            prepare_plan(&catalog, &id, vec!["job-1".to_string()], 0, 100),
            Err("profiles.busy".to_string())
        );
        assert_eq!(
            prepare_plan(&catalog, &id, Vec::new(), 1, 100),
            Err("profiles.busy".to_string())
        );
    }

    #[test]
    fn pending_is_durable_before_restart() {
        let dir = tempfile::tempdir().unwrap();
        let (catalog, id) = two_profiles();
        crate::profile_catalog::write_catalog(dir.path(), &catalog).unwrap();
        let plan = prepare_plan(&catalog, &id, Vec::new(), 0, 100).unwrap();
        let written = commit_switch(dir.path(), &plan, &[], 0, 101).unwrap();
        assert_eq!(written.pending_id.as_deref(), Some(id.as_str()));
        let on_disk = crate::profile_catalog::load_catalog(dir.path()).unwrap();
        assert_eq!(on_disk.pending_id.as_deref(), Some(id.as_str()));
        assert_eq!(on_disk.active_id, DEFAULT_PROFILE_ID);
        assert_eq!(on_disk.revision, catalog.revision + 1);
    }

    #[test]
    fn an_expired_or_stale_plan_is_refused() {
        let (catalog, id) = two_profiles();
        let plan = prepare_plan(&catalog, &id, Vec::new(), 0, 100).unwrap();
        let mut stale = catalog.clone();
        stale.revision += 1;
        assert_eq!(
            commit_plan(&mut stale, &plan, &[], 0, 101),
            Err("profiles.changed".to_string())
        );
        let mut fresh = catalog.clone();
        assert_eq!(
            commit_plan(&mut fresh, &plan, &[], 0, 100 + PROFILE_SWITCH_TTL_SECONDS + 1),
            Err("profiles.changed".to_string())
        );
    }

    #[test]
    fn a_failed_target_startup_keeps_the_last_profile() {
        let (mut catalog, id) = two_profiles();
        catalog.pending_id = Some(id.clone());
        let revision = catalog.revision;
        assert!(finish_startup(&mut catalog, &id, false).unwrap());
        assert_eq!(catalog.active_id, DEFAULT_PROFILE_ID);
        assert_eq!(catalog.pending_id, None);
        assert_eq!(catalog.revision, revision + 1);
    }

    #[test]
    fn a_successful_startup_commits_the_pending_profile() {
        let (mut catalog, id) = two_profiles();
        catalog.pending_id = Some(id.clone());
        assert!(finish_startup(&mut catalog, &id, true).unwrap());
        assert_eq!(catalog.active_id, id);
        assert_eq!(catalog.pending_id, None);
        assert_eq!(startup_selection(&catalog).unwrap().profile_id, id);
    }

    #[test]
    fn leases_and_jobs_are_bounded_and_can_be_released() {
        let state = ProfileSwitchState::default();
        for index in 0..MAX_ACTIVE_JOBS {
            state.register_job(&format!("job-{index}")).unwrap();
        }
        assert_eq!(
            state.register_job("one-too-many"),
            Err("profiles.busy".to_string())
        );
        state.finish_job("job-0");
        state.acquire_lease("document-1").unwrap();
        let (jobs, leases) = state.snapshot(0).unwrap();
        assert_eq!(jobs.len(), MAX_ACTIVE_JOBS - 1);
        assert_eq!(leases, 1);
        state.release_lease("document-1");
        assert_eq!(state.snapshot(0).unwrap().1, 0);
    }
}
