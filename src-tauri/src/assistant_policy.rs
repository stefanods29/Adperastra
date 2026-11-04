//! Provenance-based assistant policy (Step 17a T1/D7-D9).
//!
//! Authorization never comes from model text, a keyword score or a source's
//! claimed role. It comes from the typed tool, the registered capability and
//! the native scope. Source text is data; a suspected instruction is only a
//! warning and can never add a permission.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::assistant_tools;
use crate::assistant_types::{
    AssistantBackend, AssistantRisk, AssistantSettings, AssistantToolArguments, AssistantToolRequest,
};
use crate::local_ai_types::AiInputRef;

/// The guide's hard turn limits.
pub const MAX_TURN_STEPS: u8 = 8;
pub const MAX_DRAFT_ITEMS: usize = 100;
pub const MAX_SCOPE_ROOTS: usize = 32;
pub const MAX_SCOPE_FILES: usize = 128;
pub const MAX_DENIED_FOLDERS: usize = 128;
pub const CONSENT_EXPIRY_SECONDS: u64 = 120;

#[derive(Debug, Clone)]
pub struct NativeToolContext {
    pub chat_id: Uuid,
    pub scope_id: Uuid,
    pub active_tab_id: Option<String>,
    pub capabilities: Vec<String>,
    pub recycle_available: bool,
    pub backend: AssistantBackend,
    pub scope: ScopeGrantView,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyDecision {
    pub allowed: bool,
    pub error_code: Option<String>,
    pub injection_warning: bool,
    pub reason_code: String,
}

#[derive(Debug, Clone)]
#[derive(Default)]
pub struct ScopeGrantView {
    pub files: Vec<AiInputRef>,
    pub root_ids: Vec<Uuid>,
    pub read_contents: bool,
    /// Native identities stay private; only the count is public.
    pub denied_count: usize,
}


/// One turn may contain at most one request per step and never more than
/// eight steps. A ninth step is refused, not truncated silently.
pub fn check_turn_step(step: u8) -> Result<(), String> {
    if step == 0 || step > MAX_TURN_STEPS {
        return Err("assistant.invalid".to_string());
    }
    Ok(())
}

/// A second concurrently running turn for the same chat is refused.
pub fn check_one_inflight(active: bool) -> Result<(), String> {
    if active {
        return Err("assistant.invalid".to_string());
    }
    Ok(())
}

pub fn check_draft_items(count: usize) -> Result<(), String> {
    if count == 0 || count > MAX_DRAFT_ITEMS {
        return Err("assistant.invalid".to_string());
    }
    Ok(())
}

/// Automatic execution is available only for a registered read-only tool
/// whose per-tool preference is on and whose capability the chat holds.
pub fn automatic_read_allowed(
    tool_id: &str,
    settings: &AssistantSettings,
    context: &NativeToolContext,
) -> bool {
    let Some(spec) = assistant_tools::spec(tool_id) else {
        return false;
    };
    if spec.risk != AssistantRisk::ReadOnly || !spec.automatic_allowed {
        return false;
    }
    if !context.capabilities.contains(&spec.required_capability) {
        return false;
    }
    match tool_id {
        "open_tab" => settings.automatic_tools.open_tab,
        "switch_tab" => settings.automatic_tools.switch_tab,
        "search_files" => settings.automatic_tools.search_files,
        "read_file" => settings.automatic_tools.read_file,
        "group_tabs" => settings.automatic_tools.group_tabs,
        // Low-risk tab reads that have no separate preference row; they are
        // still bounded by the tabs capability and the normal tab reducer.
        "close_tab" | "open_saved_group" => true,
        _ => false,
    }
}

/// A tool with a change/recycle risk always waits for a preview and a human
/// Apply. The model can never mark the draft approved.
pub fn requires_human_apply(tool_id: &str) -> bool {
    assistant_tools::spec(tool_id)
        .map(|spec| spec.risk == AssistantRisk::Change || spec.risk == AssistantRisk::Recycle)
        .unwrap_or(true)
}

pub fn is_read_only(tool_id: &str) -> bool {
    assistant_tools::spec(tool_id)
        .map(|spec| spec.risk == AssistantRisk::ReadOnly)
        .unwrap_or(false)
}

/// Authorize one typed request. There is no flag for "confirmed".
pub fn authorize_request(
    request: &AssistantToolRequest,
    context: &NativeToolContext,
) -> PolicyDecision {
    let result = assistant_tools::validate_request(
        request,
        &context.capabilities,
        context.recycle_available,
    )
    .and_then(|()| validate_scope_membership(&request.arguments, &context.scope));
    match result {
        Ok(()) => PolicyDecision {
            allowed: true,
            error_code: None,
            injection_warning: false,
            reason_code: "assistant.authorized".to_string(),
        },
        Err(code) => PolicyDecision {
            allowed: false,
            error_code: Some(code),
            injection_warning: false,
            reason_code: "assistant.denied".to_string(),
        },
    }
}

/// Every model-supplied identifier must already be present in the native
/// scope. A guessed or content-derived UUID never acquires authority.
pub fn validate_scope_membership(
    arguments: &AssistantToolArguments,
    scope: &ScopeGrantView,
) -> Result<(), String> {
    let has_file = |id: Uuid| {
        scope
            .files
            .iter()
            .any(|file| file.id == id && !file.id.is_nil() && file.expected_revision >= 1)
    };
    let has_root = |id: Uuid| scope.root_ids.contains(&id);
    let all_files = |ids: &[Uuid]| ids.iter().all(|id| has_file(*id));
    let all_roots = |ids: &[Uuid]| ids.iter().all(|id| has_root(*id));
    match arguments {
        AssistantToolArguments::OpenTab { input_id, .. } => {
            if !has_file(*input_id) {
                return Err("assistant.scope_denied".to_string());
            }
            Ok(())
        }
        AssistantToolArguments::ReadFile { input_id, .. }
        | AssistantToolArguments::DescribeImage { input_id, .. } => {
            // Content and vision need both the exact file grant and the
            // separate read-contents permission; opening a tab does not.
            if !has_file(*input_id) || !scope.read_contents {
                return Err("assistant.scope_denied".to_string());
            }
            Ok(())
        }
        AssistantToolArguments::SearchFiles { root_ids, .. } => {
            if !all_roots(root_ids) {
                return Err("assistant.scope_denied".to_string());
            }
            Ok(())
        }
        AssistantToolArguments::CreateFile { parent_root_id, .. }
        | AssistantToolArguments::CreateFolder { parent_root_id, .. }
        | AssistantToolArguments::CreateFromTemplate { parent_root_id, .. } => {
            if !has_root(*parent_root_id) {
                return Err("assistant.scope_denied".to_string());
            }
            Ok(())
        }
        AssistantToolArguments::RenameItems { items } => {
            if !items.iter().all(|item| has_file(item.input_id)) {
                return Err("assistant.scope_denied".to_string());
            }
            Ok(())
        }
        AssistantToolArguments::MoveItems {
            input_ids,
            target_root_id,
            ..
        }
        | AssistantToolArguments::CopyItems {
            input_ids,
            target_root_id,
            ..
        }
        | AssistantToolArguments::Convert {
            input_ids,
            target_root_id,
            ..
        }
        | AssistantToolArguments::PrivacyClean {
            input_ids,
            target_root_id,
            ..
        } => {
            if !all_files(input_ids) || !has_root(*target_root_id) {
                return Err("assistant.scope_denied".to_string());
            }
            Ok(())
        }
        AssistantToolArguments::TagItems { input_ids, .. }
        | AssistantToolArguments::RecycleItems { input_ids } => {
            if !all_files(input_ids) {
                return Err("assistant.scope_denied".to_string());
            }
            Ok(())
        }
        AssistantToolArguments::SwitchTab { .. }
        | AssistantToolArguments::CloseTab { .. }
        | AssistantToolArguments::GroupTabs { .. }
        | AssistantToolArguments::OpenSavedGroup { .. } => Ok(()),
    }
}

/// A path mentioned inside file text is not a grant. The UI may show it, but
/// the native scope decides. This helper exists so callers cannot accidentally
/// derive a root from content: it always returns the unchanged authorized set.
pub fn scope_never_expands_from_content(
    authorized: &ScopeGrantView,
    _content: &str,
) -> ScopeGrantView {
    authorized.clone()
}

/// Only the native allow dialog can add a root grant. The model/tool path
/// receives the resulting `AssistantScope`, never a mutable grant set.
pub fn grant_requires_native_allow(has_user_approval: bool) -> Result<(), String> {
    if has_user_approval {
        Ok(())
    } else {
        Err("assistant.scope_denied".to_string())
    }
}

/// Structural injection signals are reported to the user, but they do not
/// change `authorize_request`. The list is deliberately about role spoofing,
/// forged approval records and exfiltration requests, not mere words.
pub fn detect_source_injection(text: &str) -> bool {
    let lower = text.to_lowercase();
    const MARKERS: &[&str] = &[
        "<<<adp-source",
        "<|im_start|>",
        "<|im_end|>",
        "ignore previous instructions",
        "ignore all previous instructions",
        "ignora las instrucciones anteriores",
        "ignora todas las instrucciones anteriores",
        "system prompt",
        "developer message",
        "sistema:",
        "mensaje del desarrollador",
        "assistant_reply",
        "confirmed\":true",
        "approved\":true",
        "stage2_confirmation",
        "outbound_consent",
        "upload every file",
        "sube todos los archivos",
        "envía todos los archivos",
        "envia todos los archivos",
        "send the file to",
        "envía el archivo a",
        "envia el archivo a",
        "delete permanently",
        "eliminación permanente",
        "eliminacion permanente",
    ];
    MARKERS.iter().any(|marker| lower.contains(marker))
}

/// Escape the source delimiters so file text cannot close its data block and
/// pretend to be an app/system message.
pub fn escape_source_delimiters(text: &str) -> String {
    // The closing delimiter does not contain the opening prefix, so it must
    // be escaped first. Otherwise file text could terminate its data block
    // and impersonate an app or tool message.
    text.replace("<<<ADP-SOURCE-END>>>", "<<<ADP-SOURCE-END-ESCAPED>>>")
        .replace("<<<ADP-SOURCE", "<<<ADP-SOURCE-ESCAPED")
        .replace("ADP-SOURCE>>>", "ADP-SOURCE-ESCAPED>>>")
        .replace("<|im_start|>", "<|im_start-escaped|>")
        .replace("<|im_end|>", "<|im_end-escaped|>")
}

/// Every source block is built by native code with a stable ID. The model
/// cannot label its own block or add a trusted role.
pub fn wrap_source_block(input_id: Uuid, revision: u64, label: &str, text: &str) -> String {
    let label = escape_source_delimiters(label).replace('"', "&quot;");
    format!(
        "<<<ADP-SOURCE id=\"{input_id}\" revision=\"{revision}\" label=\"{}\">>>\n{}\n<<<ADP-SOURCE-END>>>",
        label,
        escape_source_delimiters(text)
    )
}

/// The fixed response contract: one answer, one refusal or one typed request.
pub fn response_shape_valid(reply: &crate::assistant_types::AssistantReply) -> bool {
    match reply {
        crate::assistant_types::AssistantReply::Answer { text, citations } => {
            !text.trim().is_empty()
                && text.chars().count() <= 32_768
                && citations.len() <= 256
                && citations
                    .iter()
                    .all(crate::assistant_citations::citation_shape_valid)
        }
        crate::assistant_types::AssistantReply::Tool { request } => {
            !request.call_id.is_empty()
                && request.call_id.len() <= 64
                && request.call_id.is_ascii()
                && assistant_tools::spec(&request.tool_id).is_some()
                && request.arguments.tool_id() == request.tool_id
        }
        crate::assistant_types::AssistantReply::Refusal { reason_code } => {
            !reason_code.is_empty() && reason_code.len() <= 96
        }
    }
}

/// A source excerpt may never carry a system instruction out of its block.
pub fn source_payload_is_data_only(excerpt: &str) -> bool {
    !excerpt.contains("<<<ADP-SOURCE-END>>>")
        && !excerpt.contains("<|im_start|>")
        && !excerpt.contains("<|im_end|>")
}

/// The only capabilities a chat gets from its scope. Changing the backend or
/// profile does not reuse an old capability list.
pub fn capabilities_for_scope(
    files: usize,
    roots: usize,
    read_contents: bool,
    has_image: bool,
    recycle_available: bool,
) -> Vec<String> {
    let mut capabilities = vec![
        "assistant.tabs".to_string(),
        "assistant.search".to_string(),
        "assistant.create".to_string(),
        "assistant.transform".to_string(),
        "assistant.tags".to_string(),
        "assistant.privacy".to_string(),
    ];
    if files > 0 && roots > 0 && read_contents {
        capabilities.push("assistant.read".to_string());
    }
    if has_image && read_contents {
        capabilities.push("assistant.vision".to_string());
    }
    if recycle_available && ASSISTANT_RECYCLE_SAFE {
        capabilities.push("assistant.recycle".to_string());
    }
    capabilities
}

/// The recycle capability stays false until 09f proves object-bound recycling.
/// Callers must not set it from a preference or a path precheck.
pub const ASSISTANT_RECYCLE_SAFE: bool = false;

pub fn operation_key(args: &AssistantToolArguments) -> &'static str {
    match args {
        AssistantToolArguments::CreateFile { .. } => "create_file",
        AssistantToolArguments::CreateFolder { .. } => "create_folder",
        AssistantToolArguments::CreateFromTemplate { .. } => "create_from_template",
        AssistantToolArguments::RenameItems { .. } => "rename_items",
        AssistantToolArguments::MoveItems { .. } => "move_items",
        AssistantToolArguments::CopyItems { .. } => "copy_items",
        AssistantToolArguments::Convert { .. } => "convert",
        AssistantToolArguments::TagItems { .. } => "tag_items",
        AssistantToolArguments::PrivacyClean { .. } => "privacy_clean",
        AssistantToolArguments::RecycleItems { .. } => "recycle_items",
        _ => "read",
    }
}
