//! Assistant command boundary (Step 17a T3).
//!
//! The commands validate the window, IDs and text, then delegate to the pure
//! turn/scope runtimes. A missing model gateway or native scope dialog is an
//! explicit error, never a simulated answer.
#![allow(dead_code)]


use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use uuid::Uuid;

use crate::assistant_scope::{self, ScopeRecord, ScopeRegistry};
use crate::assistant_turns::{TurnEngine, TurnRuntime};
use crate::assistant_types::{
    AssistantBackend, AssistantConversation, AssistantMessage, AssistantScope, AssistantSettings,
    AssistantTurnRequest,
};
use crate::jobs::Jobs;
use crate::{ensure_main, validate_absolute_path};

pub const ASSISTANT_EVENT: &str = "assistant-turn";

/// The native Allow/Cancel dialog. Only this trait can approve a grant.
pub trait ScopeApproval: Send + Sync {
    fn approve(&self, label: &str, recursive: bool, read_contents: bool) -> Result<bool, String>;
}

pub struct AssistantInner {
    pub runtime: TurnRuntime,
    pub scopes: ScopeRegistry,
    pub settings: Mutex<AssistantSettings>,
    pub engine: Option<Arc<dyn TurnEngine>>,
    pub scope_dialog: Option<Arc<dyn ScopeApproval>>,
    pub chat_jobs: Mutex<HashMap<String, Uuid>>,
}

#[derive(Clone)]
pub struct AssistantService {
    inner: Arc<AssistantInner>,
}

impl AssistantService {
    pub fn new(
        settings: AssistantSettings,
        engine: Option<Arc<dyn TurnEngine>>,
        scope_dialog: Option<Arc<dyn ScopeApproval>>,
    ) -> Self {
        Self {
            inner: Arc::new(AssistantInner {
                runtime: TurnRuntime::default(),
                scopes: ScopeRegistry::default(),
                settings: Mutex::new(settings),
                engine,
                scope_dialog,
                chat_jobs: Mutex::new(HashMap::new()),
            }),
        }
    }

    pub(crate) fn settings(&self) -> Result<AssistantSettings, String> {
        self.inner
            .settings
            .lock()
            .map(|settings| settings.clone())
            .map_err(|_| "assistant.failed".to_string())
    }

    /// The native scope for one chat. Drafts and approvals re-read this at
    /// every boundary so a revoked grant can never be applied.
    pub(crate) fn scope_by_chat(&self, chat_id: Uuid) -> Result<ScopeRecord, String> {
        self.inner.scopes.get_by_chat(chat_id)
    }
}

fn backend_from_str(value: &str) -> Result<AssistantBackend, String> {
    match value {
        "local" => Ok(AssistantBackend::Local),
        "api" => Ok(AssistantBackend::Api),
        _ => Err("assistant.invalid".to_string()),
    }
}

fn parse_uuid(value: &str) -> Result<Uuid, String> {
    Uuid::parse_str(value).map_err(|_| "assistant.invalid".to_string())
}

#[tauri::command]
pub async fn assistant_chat_create(
    window: WebviewWindow,
    service: State<'_, AssistantService>,
    backend: String,
) -> Result<AssistantConversation, String> {
    ensure_main(window.label())?;
    let backend = backend_from_str(&backend)?;
    let settings = service.settings()?;
    if !settings.enabled {
        return Err("assistant.failed".to_string());
    }
    let (provider, model) = match backend {
        AssistantBackend::Local => (None, "qwen3.5-4b".to_string()),
        AssistantBackend::Api => (
            Some(settings.provider_id),
            settings.api_model_id.clone(),
        ),
    };
    let chat = service
        .inner
        .runtime
        .create_chat(backend, provider, &model, "en")?;
    // A new chat starts with an empty native scope; no root or file is
    // granted until the native Allow dialog adds one.
    let record = ScopeRecord::new(chat.id, 1);
    service.inner.scopes.insert(record)?;
    Ok(chat)
}

#[tauri::command]
pub async fn assistant_messages(
    window: WebviewWindow,
    service: State<'_, AssistantService>,
    chat_id: String,
    after_message_id: Option<String>,
) -> Result<Vec<AssistantMessage>, String> {
    ensure_main(window.label())?;
    let chat_id = parse_uuid(&chat_id)?;
    let after = after_message_id.map(|id| parse_uuid(&id)).transpose()?;
    service.inner.runtime.messages(chat_id, after)
}

#[tauri::command]
pub async fn assistant_turn_start(
    window: WebviewWindow,
    app: AppHandle,
    service: State<'_, AssistantService>,
    jobs: State<'_, Jobs>,
    request_id: String,
    request: AssistantTurnRequest,
) -> Result<(), String> {
    ensure_main(window.label())?;
    crate::valid_request_id(&request_id)?;
    if request.request_id != request_id {
        return Err("assistant.invalid".to_string());
    }
    if request.user_text.chars().count() == 0 || request.user_text.chars().count() > 32_768 {
        return Err("assistant.invalid".to_string());
    }
    let settings = service.settings()?;
    if !settings.enabled {
        return Err("assistant.failed".to_string());
    }
    let engine = service
        .inner
        .engine
        .clone()
        .ok_or_else(|| "assistant.failed".to_string())?;
    let scope = service.inner.scopes.get(request.scope_id)?;
    if scope.chat_id != request.chat_id {
        return Err("assistant.scope_denied".to_string());
    }
    let capabilities = crate::assistant_policy::capabilities_for_scope(
        scope.files.len(),
        scope.roots.len(),
        scope.read_contents && settings.allow_read_contents,
        false,
        false,
    );
    let scope_view = crate::assistant_policy::ScopeGrantView {
        files: scope.files.clone(),
        root_ids: scope.roots.iter().map(|root| root.root_id).collect(),
        read_contents: scope.read_contents && settings.allow_read_contents,
        denied_count: scope.denied.len(),
    };
    let token = jobs.begin(&request_id, 1)?;
    let inner = Arc::clone(&service.inner);
    let job_id = request_id.clone();
    let chat_id = request.chat_id;
    {
        let mut map = service
            .inner
            .chat_jobs
            .lock()
            .map_err(|_| "assistant.failed".to_string())?;
        map.insert(job_id.clone(), chat_id);
    }
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let outcome = inner.runtime.run_turn_with_cancel(
            &request,
            engine.as_ref(),
            &settings,
            &capabilities,
            &scope_view,
            crate::assistant_policy::ASSISTANT_RECYCLE_SAFE,
            "",
            token,
        );
        if let Ok(mut map) = inner.chat_jobs.lock() {
            map.remove(&job_id);
        }
        let outcome = outcome.and_then(|outcome| {
            serde_json::to_value(outcome.result).map_err(|_| "assistant.failed".to_string())
        });
        app_handle.state::<Jobs>().finish(&job_id, outcome);
    });
    let _ = app.emit(ASSISTANT_EVENT, serde_json::json!({ "job_id": request_id }));
    Ok(())
}

#[tauri::command]
pub async fn assistant_turn_stop(
    window: WebviewWindow,
    service: State<'_, AssistantService>,
    jobs: State<'_, Jobs>,
    job_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    crate::valid_request_id(&job_id)?;
    jobs.cancel(&job_id);
    let chat_id = service
        .inner
        .chat_jobs
        .lock()
        .map_err(|_| "assistant.failed".to_string())?
        .get(&job_id)
        .copied();
    if let Some(chat_id) = chat_id {
        service.inner.runtime.stop(chat_id)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn assistant_scope_request(
    window: WebviewWindow,
    service: State<'_, AssistantService>,
    chat_id: String,
    root_path: String,
    recursive: bool,
    read_contents: bool,
) -> Result<AssistantScope, String> {
    ensure_main(window.label())?;
    let chat_id = parse_uuid(&chat_id)?;
    validate_absolute_path(&root_path).map_err(|_| "assistant.scope_denied".to_string())?;
    let dialog = service
        .inner
        .scope_dialog
        .clone()
        .ok_or_else(|| "assistant.failed".to_string())?;
    let approved = dialog.approve(&root_path, recursive, read_contents)?;
    let mut record = match service.inner.scopes.get_by_chat(chat_id) {
        Ok(record) => record,
        Err(_) => ScopeRecord::new(chat_id, 1),
    };
    assistant_scope::add_root(
        &mut record,
        Path::new(&root_path),
        recursive,
        read_contents,
        approved,
    )?;
    service.inner.scopes.insert(record.clone())?;
    Ok(record.view())
}

#[tauri::command]
pub async fn assistant_scope(
    window: WebviewWindow,
    service: State<'_, AssistantService>,
    chat_id: String,
) -> Result<AssistantScope, String> {
    ensure_main(window.label())?;
    let chat_id = parse_uuid(&chat_id)?;
    let record = service.inner.scopes.get_by_chat(chat_id)?;
    Ok(record.view())
}

#[tauri::command]
pub async fn assistant_scope_revoke(
    window: WebviewWindow,
    service: State<'_, AssistantService>,
    scope_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    let scope_id = parse_uuid(&scope_id)?;
    service.inner.scopes.remove(scope_id)
}

/// Used by tests and by the profile-switch host: every grant and pending
/// consent is invalid after a profile change.
pub fn revoke_all_on_profile_change(service: &AssistantService, generation: u64) -> Result<(), String> {
    service.inner.scopes.invalidate_all(generation)?;
    service
        .inner
        .chat_jobs
        .lock()
        .map_err(|_| "assistant.failed".to_string())?
        .clear();
    Ok(())
}

#[cfg(test)]
#[path = "assistant_scope_step17a_tests.rs"]
mod step17a_tests;
