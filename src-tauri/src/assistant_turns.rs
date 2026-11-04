//! One bounded assistant turn at a time (Step 17a T3, E4).
//!
//! The runtime owns chats, revisions and the one-use Send nonce. It runs at
//! most eight model steps, accepts at most one typed tool request per step,
//! and never executes a change/recycle tool: those stop at a draft.
#![allow(dead_code)]


use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, MutexGuard};

use uuid::Uuid;

use fs_service::{new_cancellation_token, CancellationToken};

use crate::assistant_policy::{
    self, check_turn_step, NativeToolContext, ScopeGrantView,
};
use crate::assistant_tools;
use crate::assistant_types::{
    AssistantBackend, AssistantConversation, AssistantMessage, AssistantProviderId, AssistantReply,
    AssistantRisk, AssistantSettings, AssistantToolSpec, AssistantTurnRequest, AssistantTurnResult,
};

pub const MAX_CHATS: usize = 50;
pub const MAX_MESSAGES: usize = 200;
pub const MAX_USER_TEXT: usize = 32_768;

#[derive(Debug, Clone)]
pub struct TurnPrompt {
    pub locale: String,
    pub user_text: String,
    pub sources_block: String,
    pub tools: Vec<AssistantToolSpec>,
    pub backend: AssistantBackend,
    pub allow_network: bool,
    pub step: u8,
    /// Tool result from the previous step, already bounded and data-only.
    pub tool_result: Option<String>,
    /// The shared job token; the gateway must stop HTTP/body work promptly.
    pub cancel: CancellationToken,
}

/// The selected gateway (14c local runtime or the T4 API gateway) implements
/// this. It receives no approval token and cannot make a tool call itself.
pub trait TurnEngine: Send + Sync {
    fn reply(&self, prompt: TurnPrompt) -> Result<AssistantReply, String>;
    /// Execute one validated read-only tool through the normal app service.
    /// The default is unavailable; no engine may fabricate a result.
    fn read_tool(&self, _request: &crate::assistant_types::AssistantToolRequest) -> Result<String, String> {
        Err("assistant.unavailable".to_string())
    }
    /// True only if this engine performed an external network request.
    fn used_network(&self) -> bool;
}

#[derive(Debug, Clone)]
pub struct TurnOutcome {
    pub result: AssistantTurnResult,
    pub steps: u8,
}

struct ChatRecord {
    conversation: AssistantConversation,
    used_nonces: HashSet<Uuid>,
    inflight: bool,
    stopping: bool,
}

#[derive(Default)]
pub struct TurnRuntime {
    chats: Mutex<HashMap<Uuid, ChatRecord>>,
}

impl TurnRuntime {
    fn lock(&self) -> Result<MutexGuard<'_, HashMap<Uuid, ChatRecord>>, String> {
        self.chats.lock().map_err(|_| "assistant.failed".to_string())
    }

    pub fn create_chat(
        &self,
        backend: AssistantBackend,
        provider: Option<AssistantProviderId>,
        model_id: &str,
        locale: &str,
    ) -> Result<AssistantConversation, String> {
        let mut chats = self.lock()?;
        if chats.len() >= MAX_CHATS {
            return Err("assistant.invalid".to_string());
        }
        if model_id.is_empty() || model_id.len() > 96 {
            return Err("assistant.invalid".to_string());
        }
        if locale != "en" && locale != "es" {
            return Err("assistant.invalid".to_string());
        }
        let conversation = AssistantConversation {
            id: Uuid::new_v4(),
            backend,
            provider_id: provider,
            model_id: model_id.to_string(),
            locale: locale.to_string(),
            revision: 1,
            messages: Vec::new(),
            created_unix: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
        };
        chats.insert(
            conversation.id,
            ChatRecord {
                conversation: conversation.clone(),
                used_nonces: HashSet::new(),
                inflight: false,
                stopping: false,
            },
        );
        Ok(conversation)
    }

    pub fn messages(
        &self,
        chat_id: Uuid,
        after_message_id: Option<Uuid>,
    ) -> Result<Vec<AssistantMessage>, String> {
        let chats = self.lock()?;
        let chat = chats
            .get(&chat_id)
            .ok_or_else(|| "assistant.invalid".to_string())?;
        let start = after_message_id
            .and_then(|id| chat.conversation.messages.iter().position(|m| m.id == id))
            .map(|index| index + 1)
            .unwrap_or(0);
        Ok(chat.conversation.messages[start..].to_vec())
    }

    pub fn stop(&self, chat_id: Uuid) -> Result<bool, String> {
        let mut chats = self.lock()?;
        if let Some(chat) = chats.get_mut(&chat_id) {
            if chat.inflight {
                // Keep `inflight` set until the running turn observes the stop
                // and clears it; otherwise a second turn could run at once.
                chat.stopping = true;
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub fn remove_chat(&self, chat_id: Uuid) -> Result<(), String> {
        self.lock()?.remove(&chat_id);
        Ok(())
    }

    fn validate_request(chat: &ChatRecord, request: &AssistantTurnRequest) -> Result<(), String> {
        if chat.inflight {
            return Err("assistant.invalid".to_string());
        }
        if request.expected_revision != chat.conversation.revision {
            return Err("assistant.changed".to_string());
        }
        let len = request.user_text.chars().count();
        if len == 0 || len > MAX_USER_TEXT {
            return Err("assistant.invalid".to_string());
        }
        if request.request_id.is_empty() || request.request_id.len() > 64 {
            return Err("assistant.invalid".to_string());
        }
        if chat.used_nonces.contains(&request.chat_send_nonce) {
            return Err("assistant.invalid".to_string());
        }
        Ok(())
    }

    /// Run one turn. Blocking by design; the command runs it on the shared job
    /// thread. The engine is the only part that can perform network I/O.
    #[allow(clippy::too_many_arguments)]
    pub fn run_turn(
        &self,
        request: &AssistantTurnRequest,
        engine: &dyn TurnEngine,
        settings: &AssistantSettings,
        capabilities: &[String],
        scope: &ScopeGrantView,
        recycle_available: bool,
        sources_block: &str,
    ) -> Result<TurnOutcome, String> {
        self.run_turn_with_cancel(
            request,
            engine,
            settings,
            capabilities,
            scope,
            recycle_available,
            sources_block,
            new_cancellation_token(),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn run_turn_with_cancel(
        &self,
        request: &AssistantTurnRequest,
        engine: &dyn TurnEngine,
        settings: &AssistantSettings,
        capabilities: &[String],
        scope: &ScopeGrantView,
        recycle_available: bool,
        sources_block: &str,
        cancel: CancellationToken,
    ) -> Result<TurnOutcome, String> {
        let mut chats = self.lock()?;
        let chat = chats
            .get_mut(&request.chat_id)
            .ok_or_else(|| "assistant.invalid".to_string())?;
        Self::validate_request(chat, request)?;
        chat.used_nonces.insert(request.chat_send_nonce);
        chat.inflight = true;
        chat.stopping = false;
        let backend = chat.conversation.backend;
        let provider_id = chat.conversation.provider_id;
        let model_id = chat.conversation.model_id.clone();
        let locale = chat.conversation.locale.clone();
        let revision = chat.conversation.revision;
        if chat.conversation.messages.len() < MAX_MESSAGES {
            chat.conversation.messages.push(AssistantMessage {
                id: Uuid::new_v4(),
                role: "user".to_string(),
                plain_text: request.user_text.clone(),
                citations: Vec::new(),
                status: "done".to_string(),
                error_code: None,
                backend,
                provider_id,
                model_id: model_id.clone(),
            });
        }
        drop(chats);

        let context = NativeToolContext {
            chat_id: request.chat_id,
            scope_id: request.scope_id,
            active_tab_id: None,
            capabilities: capabilities.to_vec(),
            recycle_available,
            backend,
            scope: scope.clone(),
        };
        let chat_id = request.chat_id;
        let tools: Vec<AssistantToolSpec> =
            assistant_tools::list_for_capabilities(capabilities, recycle_available)
                .into_iter()
                .filter(|spec| {
                    spec.risk != AssistantRisk::ReadOnly
                        || assistant_policy::automatic_read_allowed(&spec.tool_id, settings, &context)
                })
                .collect();

        let mut steps = 0u8;
        let mut last_result: Option<String> = None;
        let reply = loop {
            if cancel.load(std::sync::atomic::Ordering::Relaxed)
                || self.is_stopping(request.chat_id)?
            {
                self.clear_inflight(request.chat_id)?;
                return Err("assistant.failed".to_string());
            }
            steps += 1;
            if check_turn_step(steps).is_err() {
                self.clear_inflight(request.chat_id)?;
                return Err("assistant.invalid".to_string());
            }
            let prompt = TurnPrompt {
                locale: locale.clone(),
                user_text: request.user_text.clone(),
                sources_block: sources_block.to_string(),
                tools: tools.clone(),
                backend,
                allow_network: backend == AssistantBackend::Api,
                step: steps,
                tool_result: last_result.clone(),
                cancel: cancel.clone(),
            };
            let reply = match engine.reply(prompt) {
                Ok(reply) => reply,
                Err(error) => {
                    self.clear_inflight(request.chat_id)?;
                    return Err(error);
                }
            };
            if cancel.load(std::sync::atomic::Ordering::Relaxed)
                || self.is_stopping(request.chat_id)?
            {
                self.clear_inflight(request.chat_id)?;
                return Err("assistant.failed".to_string());
            }
            if backend == AssistantBackend::Local && engine.used_network() {
                self.clear_inflight(request.chat_id)?;
                return Err("assistant.failed".to_string());
            }
            if !assistant_policy::response_shape_valid(&reply) {
                self.clear_inflight(request.chat_id)?;
                return Err("assistant.invalid".to_string());
            }
            match &reply {
                AssistantReply::Tool { request } => {
                    // Recycle is refused with its own stable reason before the
                    // generic capability check, so the UI can explain that the
                    // safe operation is unavailable rather than out of scope.
                    if request.tool_id == "recycle_items" && !recycle_available {
                        self.clear_inflight(chat_id)?;
                        return Err("assistant.recycle_unavailable".to_string());
                    }
                    // Exactly one typed request, validated against the registry
                    // and the native scope before any execution.
                    if let Err(error) = assistant_tools::validate_request(
                        request,
                        capabilities,
                        recycle_available,
                    ) {
                        self.clear_inflight(chat_id)?;
                        return Err(error);
                    }
                    if let Err(error) = assistant_policy::validate_scope_membership(
                        &request.arguments,
                        scope,
                    ) {
                        self.clear_inflight(chat_id)?;
                        return Err(error);
                    }
                    if assistant_policy::is_read_only(&request.tool_id) {
                        if !assistant_policy::automatic_read_allowed(
                            &request.tool_id,
                            settings,
                            &context,
                        ) {
                            self.clear_inflight(chat_id)?;
                            return Err("assistant.confirmation_required".to_string());
                        }
                        match engine.read_tool(request) {
                            Ok(result) => last_result = Some(bounded_tool_result(&result)),
                            Err(error) => {
                                self.clear_inflight(chat_id)?;
                                return Err(error);
                            }
                        }
                        continue;
                    }
                    break reply;
                }
                AssistantReply::Answer { .. } | AssistantReply::Refusal { .. } => break reply,
            }
        };

        let mut chats = self.lock()?;
        let chat = chats
            .get_mut(&request.chat_id)
            .ok_or_else(|| "assistant.invalid".to_string())?;
        chat.inflight = false;
        chat.stopping = false;
        chat.conversation.revision = revision + 1;
        let message = AssistantMessage {
            id: Uuid::new_v4(),
            role: "assistant".to_string(),
            plain_text: match &reply {
                AssistantReply::Answer { text, .. } => text.clone(),
                AssistantReply::Refusal { reason_code } => reason_code.clone(),
                AssistantReply::Tool { .. } => String::new(),
            },
            citations: match &reply {
                AssistantReply::Answer { citations, .. } => citations.clone(),
                _ => Vec::new(),
            },
            status: "done".to_string(),
            error_code: None,
            backend: chat.conversation.backend,
            provider_id: chat.conversation.provider_id,
            model_id: chat.conversation.model_id.clone(),
        };
        if chat.conversation.messages.len() < MAX_MESSAGES {
            chat.conversation.messages.push(message);
        }
        let result = AssistantTurnResult {
            chat_id: request.chat_id,
            revision: chat.conversation.revision,
            reply,
            draft: None,
            action: None,
            warnings: Vec::new(),
            backend: chat.conversation.backend,
            provider_id: chat.conversation.provider_id,
            model_id: chat.conversation.model_id.clone(),
        };
        Ok(TurnOutcome { result, steps })
    }

    fn is_stopping(&self, chat_id: Uuid) -> Result<bool, String> {
        let chats = self.lock()?;
        Ok(chats
            .get(&chat_id)
            .map(|chat| chat.stopping)
            .unwrap_or(true))
    }

    fn clear_inflight(&self, chat_id: Uuid) -> Result<(), String> {
        let mut chats = self.lock()?;
        if let Some(chat) = chats.get_mut(&chat_id) {
            chat.inflight = false;
            chat.stopping = false;
        }
        Ok(())
    }
}

/// A tool result is bounded and data-only. Approval-looking text never
/// becomes a flag.
pub fn bounded_tool_result(text: &str) -> String {
    text.chars().take(65_536).collect()
}
