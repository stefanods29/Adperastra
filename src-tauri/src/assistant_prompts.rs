//! App-owned prompt templates and examples (Step 17a T2, E3).
//!
//! Prompt text comes from `assets/ai/prompts/`, compiled into the binary. It
//! never comes from a file the user opened. Example JSON is checked by the
//! same typed schema validator used for real responses.
#![allow(dead_code)]


use serde::{Deserialize, Serialize};

pub const MAX_SYSTEM_PROMPT: usize = 32_768;
pub const MIN_EXAMPLES: usize = 3;
pub const MAX_EXAMPLES: usize = 5;
pub const ROUTER_ID: &str = "assistant-router";
pub const ROUTER_SCHEMA: &str = "assistant.reply.v1";

const ASSET_EN: &str = include_str!("../../assets/ai/prompts/assistant-router.en.md");
const ASSET_ES: &str = include_str!("../../assets/ai/prompts/assistant-router.es.md");

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PromptExample {
    pub user: String,
    pub expected_canonical_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PromptAsset {
    pub id: String,
    pub revision: u32,
    pub locale: String,
    pub schema_id: String,
    pub source_argument_names: Vec<String>,
    pub system_text: String,
    pub examples: Vec<PromptExample>,
}

fn header_value<'a>(text: &'a str, key: &str) -> Option<&'a str> {
    let prefix = format!("{key}:");
    text.lines()
        .take_while(|line| !line.starts_with("## "))
        .find_map(|line| line.strip_prefix(&prefix).map(str::trim))
}

/// Parse one compiled prompt asset. The format is deliberately tiny so no
/// parser or third-party markup is involved.
pub fn parse_prompt_asset(text: &str) -> Result<PromptAsset, String> {
    let id = header_value(text, "id").ok_or_else(|| "assistant.invalid_prompt".to_string())?;
    let revision = header_value(text, "revision")
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|value| *value >= 1)
        .ok_or_else(|| "assistant.invalid_prompt".to_string())?;
    let locale = header_value(text, "locale").ok_or_else(|| "assistant.invalid_prompt".to_string())?;
    if locale != "en" && locale != "es" {
        return Err("assistant.invalid_prompt".to_string());
    }
    let schema_id =
        header_value(text, "schema").ok_or_else(|| "assistant.invalid_prompt".to_string())?;
    let source_argument_names = header_value(text, "source-arguments")
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if source_argument_names.len() > 32 {
        return Err("assistant.invalid_prompt".to_string());
    }
    let system_start = text
        .find("## System")
        .ok_or_else(|| "assistant.invalid_prompt".to_string())?
        + "## System".len();
    let examples_start = text
        .find("## Examples")
        .ok_or_else(|| "assistant.invalid_prompt".to_string())?;
    if examples_start <= system_start {
        return Err("assistant.invalid_prompt".to_string());
    }
    let system_text = text[system_start..examples_start].trim().to_string();
    if system_text.is_empty() || system_text.chars().count() > MAX_SYSTEM_PROMPT {
        return Err("assistant.invalid_prompt".to_string());
    }

    let mut examples = Vec::new();
    let mut current_user: Option<String> = None;
    for line in text[examples_start..].lines() {
        let line = line.trim();
        if let Some(user) = line.strip_prefix("user:") {
            if current_user.is_some() {
                return Err("assistant.invalid_prompt".to_string());
            }
            current_user = Some(user.trim().to_string());
        } else if let Some(json) = line.strip_prefix("json:") {
            let user = current_user
                .take()
                .ok_or_else(|| "assistant.invalid_prompt".to_string())?;
            let json = json.trim().to_string();
            if serde_json::from_str::<serde_json::Value>(&json).is_err() {
                return Err("assistant.invalid_prompt".to_string());
            }
            examples.push(PromptExample {
                user,
                expected_canonical_json: json,
            });
        }
    }
    if current_user.is_some()
        || examples.len() < MIN_EXAMPLES
        || examples.len() > MAX_EXAMPLES
        || examples.iter().any(|example| example.user.is_empty())
    {
        return Err("assistant.invalid_prompt".to_string());
    }
    Ok(PromptAsset {
        id: id.to_string(),
        revision,
        locale: locale.to_string(),
        schema_id: schema_id.to_string(),
        source_argument_names,
        system_text,
        examples,
    })
}

/// The two assets are compiled in; a malformed asset is an integration bug,
/// not a runtime fallback.
pub fn builtin_router_prompts() -> Result<Vec<PromptAsset>, String> {
    let en = parse_prompt_asset(ASSET_EN)?;
    let es = parse_prompt_asset(ASSET_ES)?;
    if en.id != ROUTER_ID
        || es.id != ROUTER_ID
        || en.locale != "en"
        || es.locale != "es"
        || en.schema_id != ROUTER_SCHEMA
        || es.schema_id != ROUTER_SCHEMA
    {
        return Err("assistant.invalid_prompt".to_string());
    }
    Ok(vec![en, es])
}

pub fn router_prompt(locale: &str) -> Result<PromptAsset, String> {
    builtin_router_prompts()?
        .into_iter()
        .find(|asset| asset.locale == locale)
        .ok_or_else(|| "assistant.invalid_prompt".to_string())
}

/// The system text is app-owned; the gateway never accepts one from a model.
pub fn system_text(locale: &str) -> Result<String, String> {
    Ok(router_prompt(locale)?.system_text)
}
