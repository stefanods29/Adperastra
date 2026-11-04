//! Meta Model API gateway (Step 17a T4/D2).
//!
//! Exact endpoint `https://api.meta.ai/v1`, Bearer auth, Chat Completions,
//! app-owned JSON schema, bounded SSE. The provider's schema promise is not
//! trusted: every content string is parsed and validated again locally.
//! No raw response body or Authorization header is ever logged.
#![allow(dead_code)]


use serde_json::{json, Value};

use crate::assistant_policy::response_shape_valid;
use crate::assistant_provider::{
    error_for_status, parse_url, validate_budget, validate_meta_url, ResponseBudget, MAX_RESPONSE_BYTES,
    META_BASE, META_HOST, META_MODEL,
};
use crate::assistant_sse::{ProvisionalText, SseParser};
use crate::assistant_tools::{self, one_tool_call};
use crate::assistant_types::{
    AssistantReply, AssistantToolRequest, AssistantToolSpec,
};
use crate::local_ai_types::AiCitation;

pub const CHAT_PATH: &str = "/chat/completions";
pub const MODELS_PATH: &str = "/models";

pub struct HistoryMessage {
    pub role: String,
    pub content: String,
}

pub struct GatewayPrompt<'a> {
    pub system_text: &'a str,
    pub user_text: &'a str,
    pub sources_block: &'a str,
    pub history: &'a [HistoryMessage],
    pub tools: &'a [AssistantToolSpec],
    pub max_completion_tokens: u32,
}

fn schema_for_reply() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["kind"],
        "properties": {
            "kind": { "type": "string", "enum": ["answer", "refusal", "tool"] },
            "text": { "type": "string", "maxLength": 32768 },
            "citations": { "type": "array", "maxItems": 256 },
            "reason_code": { "type": "string", "maxLength": 96 },
            "request": { "type": "object" }
        }
    })
}

fn tool_parameters(tool_id: &str) -> Value {
    fn object(required: &[&str], properties: Value) -> Value {
        json!({ "type": "object", "additionalProperties": false, "required": required, "properties": properties })
    }
    let uuid = json!({ "type": "string", "format": "uuid" });
    match tool_id {
        "open_tab" => object(&["tool_id", "input_id", "background"], json!({
            "tool_id": {"const": "open_tab"}, "input_id": uuid, "background": {"const": false}
        })),
        "switch_tab" | "close_tab" => object(&["tool_id", "tab_id"], json!({
            "tool_id": {"const": tool_id}, "tab_id": {"type": "string", "maxLength": 128}
        })),
        "group_tabs" => object(&["tool_id", "tab_ids", "name", "color"], json!({
            "tool_id": {"const": "group_tabs"},
            "tab_ids": {"type": "array", "minItems": 1, "maxItems": 100, "items": {"type": "string"}},
            "name": {"type": "string", "minLength": 1, "maxLength": 60},
            "color": {"type": "string", "enum": ["purple", "blue", "green", "teal", "orange", "red"]}
        })),
        "open_saved_group" => object(&["tool_id", "group_id"], json!({
            "tool_id": {"const": "open_saved_group"}, "group_id": uuid
        })),
        "search_files" => object(&["tool_id", "text", "root_ids", "mode"], json!({
            "tool_id": {"const": "search_files"},
            "text": {"type": "string", "minLength": 1, "maxLength": 512},
            "root_ids": {"type": "array", "minItems": 1, "maxItems": 32, "items": uuid},
            "mode": {"const": "filename"}
        })),
        "read_file" => object(&["tool_id", "input_id", "location", "max_scalars"], json!({
            "tool_id": {"const": "read_file"}, "input_id": uuid,
            "location": {"type": "object"}, "max_scalars": {"type": "integer", "minimum": 1, "maximum": 65536}
        })),
        "describe_image" => object(&["tool_id", "input_id", "question"], json!({
            "tool_id": {"const": "describe_image"}, "input_id": uuid,
            "question": {"type": "string", "minLength": 1, "maxLength": 4096}
        })),
        "create_file" => object(&["tool_id", "parent_root_id", "name", "format", "content"], json!({
            "tool_id": {"const": "create_file"}, "parent_root_id": uuid,
            "name": {"type": "string", "minLength": 1, "maxLength": 255},
            "format": {"type": "string", "enum": ["text", "markdown", "csv"]},
            "content": {"type": "string", "maxLength": 65536}
        })),
        "create_folder" => object(&["tool_id", "parent_root_id", "name"], json!({
            "tool_id": {"const": "create_folder"}, "parent_root_id": uuid,
            "name": {"type": "string", "minLength": 1, "maxLength": 255}
        })),
        "create_from_template" => object(&["tool_id", "parent_root_id", "name", "template_id"], json!({
            "tool_id": {"const": "create_from_template"}, "parent_root_id": uuid,
            "name": {"type": "string", "minLength": 1, "maxLength": 255}, "template_id": uuid
        })),
        "rename_items" => object(&["tool_id", "items"], json!({
            "tool_id": {"const": "rename_items"},
            "items": {"type": "array", "minItems": 1, "maxItems": 100, "items": object(&["input_id", "new_name"], json!({
                "input_id": uuid, "new_name": {"type": "string", "minLength": 1, "maxLength": 255}
            }))}
        })),
        "move_items" | "copy_items" => object(&["tool_id", "input_ids", "target_root_id", "conflict"], json!({
            "tool_id": {"const": tool_id},
            "input_ids": {"type": "array", "minItems": 1, "maxItems": 100, "items": uuid},
            "target_root_id": uuid,
            "conflict": {"type": "string", "enum": ["keepBoth", "skip"]}
        })),
        "convert" => object(&["tool_id", "input_ids", "converter_id", "format", "options", "target_root_id", "accepted_losses", "accepted_warning_codes"], json!({
            "tool_id": {"const": "convert"},
            "input_ids": {"type": "array", "minItems": 1, "maxItems": 100, "items": uuid},
            "converter_id": {"type": "string", "maxLength": 64},
            "format": {"type": "string", "maxLength": 32},
            "options": {"type": "object"},
            "target_root_id": uuid,
            "accepted_losses": {"type": "array", "maxItems": 64, "items": {"type": "string"}},
            "accepted_warning_codes": {"type": "array", "maxItems": 64, "items": {"type": "string"}}
        })),
        "tag_items" => object(&["tool_id", "input_ids", "add_tag_ids", "remove_tag_ids"], json!({
            "tool_id": {"const": "tag_items"},
            "input_ids": {"type": "array", "minItems": 1, "maxItems": 100, "items": uuid},
            "add_tag_ids": {"type": "array", "maxItems": 32, "items": uuid},
            "remove_tag_ids": {"type": "array", "maxItems": 32, "items": uuid}
        })),
        "privacy_clean" => object(&["tool_id", "input_ids", "categories", "target_root_id"], json!({
            "tool_id": {"const": "privacy_clean"},
            "input_ids": {"type": "array", "minItems": 1, "maxItems": 100, "items": uuid},
            "categories": {"type": "array", "minItems": 1, "maxItems": 32, "items": {"type": "string"}},
            "target_root_id": uuid
        })),
        "recycle_items" => object(&["tool_id", "input_ids"], json!({
            "tool_id": {"const": "recycle_items"},
            "input_ids": {"type": "array", "minItems": 1, "maxItems": 100, "items": uuid}
        })),
        _ => json!({ "type": "object", "additionalProperties": false }),
    }
}

/// Exact request JSON. Nothing is string-concatenated into a URL or command.
pub fn build_chat_body(prompt: &GatewayPrompt<'_>, budget: &mut ResponseBudget) -> Result<Vec<u8>, String> {
    budget.max_completion_tokens = prompt.max_completion_tokens;
    budget.history_messages = prompt.history.len();
    budget.history_bytes = prompt.history.iter().map(|m| m.content.len()).sum();
    budget.source_bytes = prompt.sources_block.len();
    validate_budget(budget)?;
    let mut messages = Vec::with_capacity(prompt.history.len() + 2);
    messages.push(json!({ "role": "system", "content": prompt.system_text }));
    for item in prompt.history {
        messages.push(json!({ "role": item.role, "content": item.content }));
    }
    let user_content = if prompt.sources_block.is_empty() {
        prompt.user_text.to_string()
    } else {
        format!("{}\n\n{}", prompt.user_text, prompt.sources_block)
    };
    messages.push(json!({ "role": "user", "content": user_content }));
    let tools: Vec<Value> = prompt
        .tools
        .iter()
        .map(|spec| {
            json!({
                "type": "function",
                "function": {
                    "name": spec.tool_id,
                    "description": spec.description_key,
                    "parameters": tool_parameters(&spec.tool_id)
                }
            })
        })
        .collect();
    let body = json!({
        "model": META_MODEL,
        "messages": messages,
        "max_completion_tokens": prompt.max_completion_tokens,
        "temperature": 0,
        "stream": true,
        "response_format": {
            "type": "json_schema",
            "json_schema": { "name": "assistant_reply", "strict": true, "schema": schema_for_reply() }
        },
        "tools": tools
    });
    let bytes = serde_json::to_vec(&body).map_err(|_| "assistant.invalid".to_string())?;
    budget.request_bytes = bytes.len();
    validate_budget(budget)?;
    Ok(bytes)
}

/// Parse one final content string. A provider's `json_schema` promise is not
/// enough; unknown shapes are rejected as `assistant.api_response`.
pub fn parse_content(content: &str) -> Result<AssistantReply, String> {
    if content.len() > MAX_RESPONSE_BYTES {
        return Err("assistant.api_response".to_string());
    }
    let value: Value =
        serde_json::from_str(content).map_err(|_| "assistant.api_response".to_string())?;
    let reply: AssistantReply =
        serde_json::from_value(value).map_err(|_| "assistant.api_response".to_string())?;
    if !response_shape_valid(&reply) {
        return Err("assistant.api_response".to_string());
    }
    if let AssistantReply::Tool { request } = &reply {
        // A provider schema promise is not trusted: the typed arguments must
        // pass the exact app validator before any draft can be previewed.
        assistant_tools::validate_arguments(&request.arguments)
            .map_err(|_| "assistant.api_response".to_string())?;
    }
    if let AssistantReply::Answer { citations, .. } = &reply {
        for citation in citations {
            if citation.quote.chars().count() > 500 {
                return Err("assistant.api_response".to_string());
            }
        }
    }
    Ok(reply)
}

/// Raw `tool_calls` are normalized through the typed validator; more than one
/// call fails and no HTTP side effect is executed.
pub fn normalize_tool_calls(calls: &[Value], source_message_id: uuid::Uuid) -> Result<AssistantReply, String> {
    let call = one_tool_call(calls).map_err(|_| "assistant.api_response".to_string())?;
    let Some(call) = call else {
        return Err("assistant.api_response".to_string());
    };
    let function = call.get("function").ok_or_else(|| "assistant.api_response".to_string())?;
    let name = function
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| "assistant.api_response".to_string())?;
    let raw_args = function
        .get("arguments")
        .and_then(Value::as_str)
        .ok_or_else(|| "assistant.api_response".to_string())?;
    let args_value: Value =
        serde_json::from_str(raw_args).map_err(|_| "assistant.api_response".to_string())?;
    let arguments = assistant_tools::parse_arguments(name, &args_value)
        .map_err(|_| "assistant.api_response".to_string())?;
    let reply = AssistantReply::Tool {
        request: AssistantToolRequest {
            tool_id: name.to_string(),
            arguments,
            call_id: call
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("call-1")
                .to_string(),
            source_message_id,
        },
    };
    if !response_shape_valid(&reply) {
        return Err("assistant.api_response".to_string());
    }
    Ok(reply)
}

pub fn parse_chat_completion(body: &[u8], source_message_id: uuid::Uuid) -> Result<AssistantReply, String> {
    if body.len() > MAX_RESPONSE_BYTES {
        return Err("assistant.api_response".to_string());
    }
    let value: Value =
        serde_json::from_slice(body).map_err(|_| "assistant.api_response".to_string())?;
    let choice = value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .ok_or_else(|| "assistant.api_response".to_string())?;
    if let Some(calls) = choice
        .get("message")
        .and_then(|message| message.get("tool_calls"))
        .and_then(Value::as_array)
    {
        if !calls.is_empty() {
            return normalize_tool_calls(calls, source_message_id);
        }
    }
    let content = choice
        .get("message")
        .and_then(|message| message.get("content"))
        .and_then(Value::as_str)
        .ok_or_else(|| "assistant.api_response".to_string())?;
    parse_content(content)
}

pub fn parse_sse_delta(event: &crate::assistant_sse::SseEvent) -> Result<Option<String>, String> {
    if event.data == "[DONE]" || event.data.trim().is_empty() {
        return Ok(None);
    }
    let value: Value =
        serde_json::from_str(&event.data).map_err(|_| "assistant.api_response".to_string())?;
    Ok(value
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("delta"))
        .and_then(|delta| delta.get("content"))
        .and_then(Value::as_str)
        .map(str::to_string))
}

/// Streaming endpoint composition, never built from model text.
pub fn chat_url(base: &str) -> Result<String, String> {
    let url = validate_meta_url(base)?;
    if url.host != META_HOST {
        return Err("assistant.endpoint_denied".to_string());
    }
    Ok(format!("{}{}", META_BASE, CHAT_PATH))
}

pub fn models_url() -> String {
    format!("{META_BASE}{MODELS_PATH}")
}

pub fn status_error(status: u16) -> String {
    error_for_status(status)
}

/// A response body is read only up to the caps; cancellation drops it.
pub struct StreamState {
    pub parser: SseParser,
    pub provisional: ProvisionalText,
    pub received: usize,
}

impl Default for StreamState {
    fn default() -> Self {
        Self {
            parser: SseParser::new(),
            provisional: ProvisionalText::default(),
            received: 0,
        }
    }
}

pub fn feed_stream(state: &mut StreamState, chunk: &[u8]) -> Result<Vec<String>, String> {
    state.received += chunk.len();
    if state.received > MAX_RESPONSE_BYTES {
        return Err("assistant.api_response".to_string());
    }
    let events = state.parser.push(chunk)?;
    let mut pieces = Vec::new();
    for event in events {
        if let Some(piece) = parse_sse_delta(&event)? {
            state.provisional.push(&piece)?;
            pieces.push(piece);
        }
    }
    Ok(pieces)
}

/// Only `https://api.meta.ai:443` is accepted for the fixed provider.
pub fn validate_transport(raw: &str) -> Result<(), String> {
    let url = parse_url(raw)?;
    if url.scheme != "https" || url.host != META_HOST || url.port != 443 {
        return Err("assistant.endpoint_denied".to_string());
    }
    Ok(())
}

/// Citations from a provider are still checked by the caller against chunks.
pub fn provider_citations(reply: &AssistantReply) -> &[AiCitation] {
    match reply {
        AssistantReply::Answer { citations, .. } => citations,
        _ => &[],
    }
}
