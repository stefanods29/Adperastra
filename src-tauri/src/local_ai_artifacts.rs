//! Native artifact surface (T2, E4).
//!
//! Immutable bytes stay in `ai_runtime::artifacts`. This module adds the
//! native profile and the Tauri commands. Reads return a raw byte response, not
//! a JSON array; an 8 MiB request is the public upper bound.
#![allow(dead_code)]


use std::sync::{Mutex, MutexGuard};

use tauri::{State, WebviewWindow};
use uuid::Uuid;

use ai_runtime::artifacts::{AiArtifactLease, AiArtifacts};
use ai_runtime::types_ui::{AiArtifactInfo, AiArtifactKind};
use ai_runtime::types::ProfileId;

use crate::local_ai_types::AiArtifactReadRequest;

const BAD_REQUEST: &str = "ai.bad_request";
const MAX_READ_BYTES: u64 = 8 * 1024 * 1024;

/// The current native profile. A profile switch replaces this value and clears
/// both inputs and artifacts; no device fingerprint is derived from hardware.
pub struct AiProfile {
    current: Mutex<ProfileId>,
}

impl Default for AiProfile {
    fn default() -> Self {
        Self::new()
    }
}

impl AiProfile {
    pub fn new() -> Self {
        Self {
            current: Mutex::new(Uuid::new_v4()),
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, ProfileId>, String> {
        self.current
            .lock()
            .map_err(|_| "ai-profile lock poisoned".to_string())
    }

    pub fn get(&self) -> ProfileId {
        self.lock().map(|value| *value).unwrap_or_default()
    }

    pub fn set(&self, profile: ProfileId) -> Result<(), String> {
        if profile.is_nil() {
            return Err(BAD_REQUEST.into());
        }
        *self.lock()? = profile;
        Ok(())
    }
}

/// Native wrapper so the runtime owns one artifact table per application.
pub struct AiArtifactStore {
    pub artifacts: AiArtifacts,
    pub profile: AiProfile,
}

impl Default for AiArtifactStore {
    fn default() -> Self {
        Self::new()
    }
}

impl AiArtifactStore {
    pub fn new() -> Self {
        Self {
            artifacts: AiArtifacts::new(),
            profile: AiProfile::new(),
        }
    }

    pub fn publish(
        &self,
        kind: AiArtifactKind,
        bytes: Vec<u8>,
        sensitive: bool,
        now_unix: u64,
    ) -> Result<AiArtifactInfo, String> {
        self.artifacts
            .publish(self.profile.get(), kind, bytes, sensitive, now_unix)
    }

    pub fn resolve(
        &self,
        id: Uuid,
        kind: AiArtifactKind,
        now_unix: u64,
    ) -> Result<AiArtifactLease, String> {
        self.artifacts
            .resolve_at(id, kind, self.profile.get(), now_unix)
    }

    pub fn release(&self, id: Uuid) -> Result<(), String> {
        self.artifacts.release(id)
    }

    /// Profile switch: no new reads or jobs from the previous profile.
    pub fn switch_profile(&self, profile: ProfileId) -> Result<(), String> {
        let previous = self.profile.get();
        self.profile.set(profile)?;
        self.artifacts.clear_profile(previous)?;
        Ok(())
    }
}

fn parse_uuid(value: &str) -> Result<Uuid, String> {
    Uuid::parse_str(value).map_err(|_| BAD_REQUEST.to_string())
}

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

#[tauri::command]
pub fn ai_artifact_describe(
    window: WebviewWindow,
    store: State<'_, std::sync::Arc<AiArtifactStore>>,
    id: String,
) -> Result<AiArtifactInfo, String> {
    crate::ensure_main(window.label())?;
    let id = parse_uuid(&id)?;
    store.artifacts.describe(id, store.profile.get(), unix_now())
}

/// Raw response: the service concatenates at most two 4 MiB protocol reads.
#[tauri::command]
pub fn ai_artifact_read(
    window: WebviewWindow,
    store: State<'_, std::sync::Arc<AiArtifactStore>>,
    request: AiArtifactReadRequest,
) -> Result<tauri::ipc::Response, String> {
    crate::ensure_main(window.label())?;
    if request.length == 0 || request.length > MAX_READ_BYTES {
        return Err(BAD_REQUEST.into());
    }
    let info = store
        .artifacts
        .describe(request.id, store.profile.get(), unix_now())?;
    let lease = store.resolve(request.id, info.kind, unix_now())?;
    let bytes = lease.read(request.offset, request.length)?.to_vec();
    drop(lease);
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn ai_artifact_release(
    window: WebviewWindow,
    store: State<'_, std::sync::Arc<AiArtifactStore>>,
    id: String,
) -> Result<(), String> {
    crate::ensure_main(window.label())?;
    let id = parse_uuid(&id)?;
    store.release(id)
}
