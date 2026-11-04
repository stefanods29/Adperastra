//! Canonical native assistant DTOs (Step 17a, assistant-core-1).
//!
//! These mirror `src/assistant/types.ts` field for field and are validated
//! again on every command boundary. No DTO carries a credential, a native
//! source handle, an approval boolean or a scope grant.

use std::path::Path;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use convert::MetadataCategory;

use crate::local_ai_types::{AiCitation, AiInputRef, AiSourceLocation};

/// Mirrors the UI `CommandRisk`. Kept kebab-case on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssistantRisk {
    ReadOnly,
    Change,
    Recycle,
    Irreversible,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssistantBackend {
    Local,
    Api,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssistantProviderId {
    Meta,
    CustomCompatible,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AssistantLocalSource {
    Bundled,
    UserServer,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssistantSettings {
    pub enabled: bool,
    pub backend: AssistantBackend,
    pub provider_id: AssistantProviderId,
    pub custom_endpoint_id: Option<Uuid>,
    pub api_model_id: String,
    pub local_source: AssistantLocalSource,
    pub local_server_port: u16,
    pub local_server_address: String,
    pub name: String,
    pub answer_length: String,
    pub tone: String,
    pub language: String,
    pub show_steps: bool,
    pub allow_read_contents: bool,
    pub automatic_tools: AssistantAutomaticTools,
    pub denied_folders: Vec<String>,
    pub keep_history: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AssistantAutomaticTools {
    pub open_tab: bool,
    pub switch_tab: bool,
    pub search_files: bool,
    pub read_file: bool,
    pub group_tabs: bool,
}

impl Default for AssistantSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            backend: AssistantBackend::Local,
            provider_id: AssistantProviderId::Meta,
            custom_endpoint_id: None,
            api_model_id: "muse-spark-1.3".to_string(),
            local_source: AssistantLocalSource::Bundled,
            local_server_port: 11434,
            local_server_address: "127.0.0.1".to_string(),
            name: String::new(),
            answer_length: "normal".to_string(),
            tone: "neutral".to_string(),
            language: "app".to_string(),
            show_steps: false,
            allow_read_contents: false,
            automatic_tools: AssistantAutomaticTools {
                open_tab: true,
                switch_tab: true,
                search_files: true,
                read_file: false,
                group_tabs: true,
            },
            denied_folders: Vec::new(),
            keep_history: false,
        }
    }
}

impl AssistantSettings {
    pub fn validate(&self) -> Result<(), String> {
        if self.api_model_id.is_empty()
            || self.api_model_id.len() > 96
            || !self.api_model_id.is_ascii()
            || self.api_model_id.chars().any(char::is_whitespace)
        {
            return Err("assistant.invalid".to_string());
        }
        if !(1024..=65535).contains(&self.local_server_port) {
            return Err("assistant.invalid".to_string());
        }
        if self.local_server_address != "127.0.0.1" && self.local_server_address != "::1" {
            return Err("assistant.invalid".to_string());
        }
        if self.name.chars().count() > 40 {
            return Err("assistant.invalid".to_string());
        }
        if !matches!(self.answer_length.as_str(), "short" | "normal" | "detailed")
            || !matches!(self.tone.as_str(), "friendly" | "neutral")
            || !matches!(self.language.as_str(), "app" | "input")
        {
            return Err("assistant.invalid".to_string());
        }
        if self.denied_folders.len() > 128
            || self.denied_folders.iter().any(|folder| {
                folder.is_empty()
                    || folder.chars().count() > 32_768
                    || !Path::new(folder).is_absolute()
            })
        {
            return Err("assistant.invalid".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialStatus {
    pub provider_id: AssistantProviderId,
    pub has_key: bool,
    pub masked_hint: String,
    pub updated_unix: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantModel {
    pub id: String,
    pub display_name: String,
    pub supports_vision: bool,
    pub supports_schema: bool,
    pub provider_id: AssistantProviderId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantConnectionResult {
    pub ok: bool,
    pub error_code: Option<String>,
    pub model_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantEndpointConfig {
    pub id: Uuid,
    pub base_url: String,
    pub host: String,
    pub port: u16,
    pub model_id: String,
    pub generation: u64,
    pub schema_supported: bool,
    pub vision_supported: bool,
    pub tested_unix: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantEndpointStatus {
    pub id: Option<Uuid>,
    pub display_origin: Option<String>,
    pub model_id: Option<String>,
    pub generation: u64,
    pub configured: bool,
    pub schema_supported: bool,
    pub vision_supported: bool,
    pub tested_unix: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantMessage {
    pub id: Uuid,
    pub role: String,
    pub plain_text: String,
    pub citations: Vec<AiCitation>,
    pub status: String,
    pub error_code: Option<String>,
    pub backend: AssistantBackend,
    pub provider_id: Option<AssistantProviderId>,
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantConversation {
    pub id: Uuid,
    pub backend: AssistantBackend,
    pub provider_id: Option<AssistantProviderId>,
    pub model_id: String,
    pub locale: String,
    pub revision: u64,
    pub messages: Vec<AssistantMessage>,
    pub created_unix: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssistantScopeRoot {
    pub root_id: Uuid,
    pub label: String,
    pub recursive: bool,
    pub read_contents: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssistantScope {
    pub id: Uuid,
    pub chat_id: Uuid,
    pub generation: u64,
    pub files: Vec<AiInputRef>,
    pub roots: Vec<AssistantScopeRoot>,
    pub read_contents: bool,
    /// Display labels only. Native pinned identities never cross the wire.
    pub denied_folders: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantToolSpec {
    pub tool_id: String,
    pub command_id: String,
    pub schema_id: String,
    pub risk: AssistantRisk,
    pub required_capability: String,
    pub automatic_allowed: bool,
    pub description_key: String,
    pub help_slug: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantRenameItem {
    pub input_id: Uuid,
    pub new_name: String,
}

/// The model-visible typed argument union. `tool_id` is the tag and cannot
/// be separated from the typed fields. No variant can express permanent
/// deletion, a shell command or an approval boolean.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "tool_id", rename_all = "snake_case")]
pub enum AssistantToolArguments {
    OpenTab {
        input_id: Uuid,
        background: bool,
    },
    SwitchTab {
        tab_id: String,
    },
    CloseTab {
        tab_id: String,
    },
    GroupTabs {
        tab_ids: Vec<String>,
        name: String,
        color: String,
    },
    OpenSavedGroup {
        group_id: Uuid,
    },
    SearchFiles {
        text: String,
        root_ids: Vec<Uuid>,
        mode: String,
    },
    ReadFile {
        input_id: Uuid,
        location: AiSourceLocation,
        max_scalars: u32,
    },
    DescribeImage {
        input_id: Uuid,
        question: String,
    },
    CreateFile {
        parent_root_id: Uuid,
        name: String,
        format: String,
        content: String,
    },
    CreateFolder {
        parent_root_id: Uuid,
        name: String,
    },
    CreateFromTemplate {
        parent_root_id: Uuid,
        name: String,
        template_id: Uuid,
    },
    RenameItems {
        items: Vec<AssistantRenameItem>,
    },
    MoveItems {
        input_ids: Vec<Uuid>,
        target_root_id: Uuid,
        conflict: String,
    },
    CopyItems {
        input_ids: Vec<Uuid>,
        target_root_id: Uuid,
        conflict: String,
    },
    Convert {
        input_ids: Vec<Uuid>,
        converter_id: String,
        format: String,
        options: serde_json::Value,
        target_root_id: Uuid,
        accepted_losses: Vec<MetadataCategory>,
        accepted_warning_codes: Vec<String>,
    },
    TagItems {
        input_ids: Vec<Uuid>,
        add_tag_ids: Vec<Uuid>,
        remove_tag_ids: Vec<Uuid>,
    },
    PrivacyClean {
        input_ids: Vec<Uuid>,
        categories: Vec<MetadataCategory>,
        target_root_id: Uuid,
    },
    RecycleItems {
        input_ids: Vec<Uuid>,
    },
}

impl AssistantToolArguments {
    pub fn tool_id(&self) -> &'static str {
        match self {
            Self::OpenTab { .. } => "open_tab",
            Self::SwitchTab { .. } => "switch_tab",
            Self::CloseTab { .. } => "close_tab",
            Self::GroupTabs { .. } => "group_tabs",
            Self::OpenSavedGroup { .. } => "open_saved_group",
            Self::SearchFiles { .. } => "search_files",
            Self::ReadFile { .. } => "read_file",
            Self::DescribeImage { .. } => "describe_image",
            Self::CreateFile { .. } => "create_file",
            Self::CreateFolder { .. } => "create_folder",
            Self::CreateFromTemplate { .. } => "create_from_template",
            Self::RenameItems { .. } => "rename_items",
            Self::MoveItems { .. } => "move_items",
            Self::CopyItems { .. } => "copy_items",
            Self::Convert { .. } => "convert",
            Self::TagItems { .. } => "tag_items",
            Self::PrivacyClean { .. } => "privacy_clean",
            Self::RecycleItems { .. } => "recycle_items",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssistantToolRequest {
    pub tool_id: String,
    pub arguments: AssistantToolArguments,
    pub call_id: String,
    pub source_message_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AssistantReply {
    Answer {
        text: String,
        citations: Vec<AiCitation>,
    },
    Tool {
        request: AssistantToolRequest,
    },
    Refusal {
        reason_code: String,
    },
}

/// Mirror of the change/recycle tool schemas for an immutable draft.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "tool_id", rename_all = "snake_case")]
pub enum AssistantOperation {
    CreateFile {
        parent_root_id: Uuid,
        name: String,
        format: String,
        content: String,
    },
    CreateFolder {
        parent_root_id: Uuid,
        name: String,
    },
    CreateFromTemplate {
        parent_root_id: Uuid,
        name: String,
        template_id: Uuid,
    },
    RenameItems {
        items: Vec<AssistantRenameItem>,
    },
    MoveItems {
        input_ids: Vec<Uuid>,
        target_root_id: Uuid,
        conflict: String,
    },
    CopyItems {
        input_ids: Vec<Uuid>,
        target_root_id: Uuid,
        conflict: String,
    },
    Convert {
        input_ids: Vec<Uuid>,
        converter_id: String,
        format: String,
        options: serde_json::Value,
        target_root_id: Uuid,
        accepted_losses: Vec<MetadataCategory>,
        accepted_warning_codes: Vec<String>,
    },
    TagItems {
        input_ids: Vec<Uuid>,
        add_tag_ids: Vec<Uuid>,
        remove_tag_ids: Vec<Uuid>,
    },
    PrivacyClean {
        input_ids: Vec<Uuid>,
        categories: Vec<MetadataCategory>,
        target_root_id: Uuid,
    },
    RecycleItems {
        input_ids: Vec<Uuid>,
    },
}

impl AssistantOperation {
    pub fn tool_id(&self) -> &'static str {
        match self {
            Self::CreateFile { .. } => "create_file",
            Self::CreateFolder { .. } => "create_folder",
            Self::CreateFromTemplate { .. } => "create_from_template",
            Self::RenameItems { .. } => "rename_items",
            Self::MoveItems { .. } => "move_items",
            Self::CopyItems { .. } => "copy_items",
            Self::Convert { .. } => "convert",
            Self::TagItems { .. } => "tag_items",
            Self::PrivacyClean { .. } => "privacy_clean",
            Self::RecycleItems { .. } => "recycle_items",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantPreviewRow {
    pub input_id: Option<Uuid>,
    pub source_label: Option<String>,
    pub destination_label: Option<String>,
    pub before_excerpt: Option<String>,
    pub after_excerpt: Option<String>,
    pub operation_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantDraft {
    pub id: Uuid,
    pub chat_id: Uuid,
    pub revision: u64,
    pub operation: AssistantOperation,
    pub source_ids: Vec<AiInputRef>,
    pub preview_rows: Vec<AssistantPreviewRow>,
    pub warnings: Vec<String>,
    pub accepted_warning_codes: Vec<String>,
    pub accepted_losses: Vec<MetadataCategory>,
    pub draft_sha256: String,
    pub expires_unix: u64,
    pub risk: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantActionResult {
    pub draft_id: Uuid,
    pub state: String,
    pub actual_input_ids: Vec<Uuid>,
    pub output_labels: Vec<String>,
    pub undo_entry_id: Option<Uuid>,
    pub error_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssistantTurnRequest {
    pub chat_id: Uuid,
    pub expected_revision: u64,
    pub user_text: String,
    pub scope_id: Uuid,
    pub request_id: String,
    pub chat_send_nonce: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssistantTurnResult {
    pub chat_id: Uuid,
    pub revision: u64,
    pub reply: AssistantReply,
    pub draft: Option<AssistantDraft>,
    pub action: Option<AssistantActionResult>,
    pub warnings: Vec<String>,
    pub backend: AssistantBackend,
    pub provider_id: Option<AssistantProviderId>,
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssistantOutboundSource {
    pub input_id: Uuid,
    pub revision: u64,
    pub label: String,
    pub location: AiSourceLocation,
    pub excerpt: String,
    pub mime: String,
    pub byte_len: u64,
    pub image_preview_artifact_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssistantOutboundPreview {
    pub preview_id: Uuid,
    pub backend: AssistantBackend,
    pub provider_id: Option<AssistantProviderId>,
    pub model_id: String,
    pub payload_sha256: Option<String>,
    pub sources: Vec<AssistantOutboundSource>,
    pub byte_len: u64,
    pub requires_consent: bool,
    pub expires_unix: u64,
    pub includes_chat_history: bool,
    pub local_server: bool,
}
