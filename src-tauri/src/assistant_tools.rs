//! Native assistant tool registry and argument validation (Step 17a T1).
//!
//! The UI registry and this one must agree exactly. Native validation is the
//! authority: a model-generated tool name or argument object can never reach
//! an adapter without passing this module.
#![allow(dead_code)]


use serde_json::{Map, Value};

use convert::MetadataCategory;

use crate::assistant_types::{
    AssistantRisk, AssistantToolArguments, AssistantToolRequest, AssistantToolSpec,
};
use crate::local_ai_types::AiSourceLocation;

/// One row of the exact tool table. The last field is the capability.
const TOOL_TABLE: &[(&str, AssistantRisk, &str, bool)] = &[
    ("open_tab", AssistantRisk::ReadOnly, "assistant.tabs", true),
    ("switch_tab", AssistantRisk::ReadOnly, "assistant.tabs", true),
    ("close_tab", AssistantRisk::ReadOnly, "assistant.tabs", true),
    ("group_tabs", AssistantRisk::ReadOnly, "assistant.tabs", true),
    ("open_saved_group", AssistantRisk::ReadOnly, "assistant.tabs", true),
    ("search_files", AssistantRisk::ReadOnly, "assistant.search", true),
    ("read_file", AssistantRisk::ReadOnly, "assistant.read", true),
    ("describe_image", AssistantRisk::ReadOnly, "assistant.vision", false),
    ("create_file", AssistantRisk::Change, "assistant.create", false),
    ("create_folder", AssistantRisk::Change, "assistant.create", false),
    ("create_from_template", AssistantRisk::Change, "assistant.create", false),
    ("rename_items", AssistantRisk::Change, "assistant.transform", false),
    ("move_items", AssistantRisk::Change, "assistant.transform", false),
    ("copy_items", AssistantRisk::Change, "assistant.transform", false),
    ("convert", AssistantRisk::Change, "assistant.transform", false),
    ("tag_items", AssistantRisk::Change, "assistant.tags", false),
    ("privacy_clean", AssistantRisk::Change, "assistant.privacy", false),
    ("recycle_items", AssistantRisk::Recycle, "assistant.recycle", false),
];

const COLORS: &[&str] = &["purple", "blue", "green", "teal", "orange", "red"];
const CREATE_FORMATS: &[&str] = &["text", "markdown", "csv"];
const CONVERTER_KINDS: &[&str] = &[
    "image", "pdf", "document", "table", "archive", "media", "office",
];

fn invalid() -> String {
    "assistant.invalid_arguments".to_string()
}

pub fn specs() -> Vec<AssistantToolSpec> {
    TOOL_TABLE
        .iter()
        .map(|(tool_id, risk, capability, automatic)| AssistantToolSpec {
            tool_id: (*tool_id).to_string(),
            command_id: format!("assistant.tool.{tool_id}"),
            schema_id: format!("assistant.tool.{tool_id}.v1"),
            risk: *risk,
            required_capability: (*capability).to_string(),
            automatic_allowed: *automatic,
            description_key: format!("assistant.tool.{tool_id}"),
            help_slug: "assistant-capabilities".to_string(),
        })
        .collect()
}

pub fn spec(tool_id: &str) -> Option<AssistantToolSpec> {
    specs().into_iter().find(|row| row.tool_id == tool_id)
}

/// The tools a chat may see. Irreversible tools are excluded unconditionally.
pub fn list_for_capabilities(capabilities: &[String], recycle_available: bool) -> Vec<AssistantToolSpec> {
    specs()
        .into_iter()
        .filter(|row| row.risk != AssistantRisk::Irreversible)
        .filter(|row| capabilities.iter().any(|cap| cap == &row.required_capability))
        .filter(|row| row.tool_id != "recycle_items" || recycle_available)
        .collect()
}

/// Permanent deletion is not representable in this interface. The function
/// exists so tests and reviewers can assert the absence explicitly.
pub fn permanent_delete_representable() -> bool {
    false
}

fn exact_keys<'a>(value: &'a Value, keys: &[&str]) -> Result<&'a Map<String, Value>, String> {
    let object = value.as_object().ok_or_else(invalid)?;
    if object.len() != keys.len() {
        return Err(invalid());
    }
    for key in keys {
        if !object.contains_key(*key) {
            return Err(invalid());
        }
    }
    for key in object.keys() {
        if !keys.contains(&key.as_str()) {
            return Err(invalid());
        }
    }
    Ok(object)
}

fn scalar_len(value: &str) -> usize {
    value.chars().count()
}

fn bounded_string(value: &Value, min: usize, max: usize) -> Result<String, String> {
    let text = value.as_str().ok_or_else(invalid)?;
    let len = scalar_len(text);
    if len < min || len > max {
        return Err(invalid());
    }
    Ok(text.to_string())
}

fn valid_basename(value: &str) -> bool {
    if value.is_empty() || value.chars().count() > 255 {
        return false;
    }
    if value.ends_with('.') || value.ends_with(' ') {
        return false;
    }
    if value
        .chars()
        .any(|c| c.is_control() || matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'))
    {
        return false;
    }
    let stem = value.split('.').next().unwrap_or(value).to_ascii_lowercase();
    !matches!(
        stem.as_str(),
        "con" | "prn" | "aux" | "nul" | "com1" | "com2" | "com3" | "com4" | "com5" | "com6"
            | "com7" | "com8" | "com9" | "lpt1" | "lpt2" | "lpt3" | "lpt4" | "lpt5" | "lpt6"
            | "lpt7" | "lpt8" | "lpt9"
    )
}

pub fn validate_source_location(location: &AiSourceLocation) -> Result<(), String> {
    match location {
        AiSourceLocation::Text { start, end } if end > start => Ok(()),
        AiSourceLocation::Page { page } if *page >= 1 && *page <= 10_000 => Ok(()),
        AiSourceLocation::Time { start_us, end_us } if end_us > start_us => Ok(()),
        AiSourceLocation::Sheet { sheet_id, range }
            if !sheet_id.is_empty()
                && sheet_id.len() <= 128
                && !range.is_empty()
                && range.len() <= 64 =>
        {
            Ok(())
        }
        AiSourceLocation::Slide { slide_id }
            if !slide_id.is_empty() && slide_id.len() <= 128 =>
        {
            Ok(())
        }
        AiSourceLocation::Image { region: None } => Ok(()),
        AiSourceLocation::Image { region: Some(rect) }
            if rect.width > 0
                && rect.height > 0
                && u64::from(rect.x) + u64::from(rect.width) <= u64::from(u32::MAX)
                && u64::from(rect.y) + u64::from(rect.height) <= u64::from(u32::MAX) =>
        {
            Ok(())
        }
        _ => Err(invalid()),
    }
}

/// Raw `AiSourceLocation` values are internally tagged and flat. The canonical
/// serde enum ignores unknown variant fields, so the model path rejects them
/// here before deserialization, matching the TypeScript exact-object check.
pub fn validate_location_value(raw: &Value) -> Result<(), String> {
    let kind = raw
        .as_object()
        .and_then(|object| object.get("kind"))
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    let keys: &[&str] = match kind {
        "text" => &["kind", "start", "end"],
        "page" => &["kind", "page"],
        "time" => &["kind", "start_us", "end_us"],
        "sheet" => &["kind", "sheet_id", "range"],
        "slide" => &["kind", "slide_id"],
        "image" => &["kind", "region"],
        _ => return Err(invalid()),
    };
    exact_keys(raw, keys)?;
    let location: AiSourceLocation = serde_json::from_value(raw.clone()).map_err(|_| invalid())?;
    validate_source_location(&location)
}

fn unique(ids: &[uuid::Uuid]) -> bool {
    let mut seen = std::collections::HashSet::new();
    ids.iter().all(|id| seen.insert(*id))
}

pub fn validate_arguments(args: &AssistantToolArguments) -> Result<(), String> {
    match args {
        AssistantToolArguments::OpenTab { background, .. } if !*background => Ok(()),
        AssistantToolArguments::SwitchTab { tab_id }
        | AssistantToolArguments::CloseTab { tab_id }
            if scalar_len(tab_id) >= 1 && scalar_len(tab_id) <= 128 =>
        {
            Ok(())
        }
        AssistantToolArguments::GroupTabs {
            tab_ids,
            name,
            color,
        } => {
            if tab_ids.is_empty() || tab_ids.len() > 100 {
                return Err(invalid());
            }
            if tab_ids.iter().any(|id| scalar_len(id) == 0 || scalar_len(id) > 128) {
                return Err(invalid());
            }
            if scalar_len(name) == 0 || scalar_len(name) > 60 {
                return Err(invalid());
            }
            if !COLORS.contains(&color.as_str()) {
                return Err(invalid());
            }
            Ok(())
        }
        AssistantToolArguments::OpenSavedGroup { .. } => Ok(()),
        AssistantToolArguments::SearchFiles {
            text,
            root_ids,
            mode,
        } => {
            if scalar_len(text) == 0 || scalar_len(text) > 512 || mode != "filename" {
                return Err(invalid());
            }
            if root_ids.is_empty() || root_ids.len() > 32 || !unique(root_ids) {
                return Err(invalid());
            }
            Ok(())
        }
        AssistantToolArguments::ReadFile {
            location,
            max_scalars,
            ..
        } => {
            if *max_scalars == 0 || *max_scalars > 65_536 {
                return Err(invalid());
            }
            validate_source_location(location)
        }
        AssistantToolArguments::DescribeImage { question, .. } => {
            if scalar_len(question) == 0 || scalar_len(question) > 4_096 {
                return Err(invalid());
            }
            Ok(())
        }
        AssistantToolArguments::CreateFile {
            name,
            format,
            content,
            ..
        } => {
            if !valid_basename(name) || !CREATE_FORMATS.contains(&format.as_str()) {
                return Err(invalid());
            }
            if scalar_len(content) > 65_536 {
                return Err(invalid());
            }
            Ok(())
        }
        AssistantToolArguments::CreateFolder { name, .. }
        | AssistantToolArguments::CreateFromTemplate { name, .. }
            if valid_basename(name) =>
        {
            Ok(())
        }
        AssistantToolArguments::RenameItems { items } => {
            if items.is_empty() || items.len() > 100 {
                return Err(invalid());
            }
            let mut seen = std::collections::HashSet::new();
            for item in items {
                if !seen.insert(item.input_id) || !valid_basename(&item.new_name) {
                    return Err(invalid());
                }
            }
            Ok(())
        }
        AssistantToolArguments::MoveItems {
            input_ids,
            conflict,
            ..
        }
        | AssistantToolArguments::CopyItems {
            input_ids,
            conflict,
            ..
        } => {
            if input_ids.is_empty() || input_ids.len() > 100 || !unique(input_ids) {
                return Err(invalid());
            }
            if conflict != "keepBoth" && conflict != "skip" {
                return Err(invalid());
            }
            Ok(())
        }
        AssistantToolArguments::Convert {
            input_ids,
            converter_id,
            format,
            options,
            accepted_losses,
            accepted_warning_codes,
            ..
        } => {
            if input_ids.is_empty() || input_ids.len() > 100 || !unique(input_ids) {
                return Err(invalid());
            }
            if scalar_len(converter_id) == 0
                || scalar_len(converter_id) > 64
                || scalar_len(format) == 0
                || scalar_len(format) > 32
            {
                return Err(invalid());
            }
            let kind = options.get("kind").and_then(Value::as_str).unwrap_or("");
            if !CONVERTER_KINDS.contains(&kind) {
                return Err(invalid());
            }
            if accepted_losses.len() > 64
                || accepted_warning_codes.len() > 64
                || !unique_categories(accepted_losses)
                || !unique_strings(accepted_warning_codes)
            {
                return Err(invalid());
            }
            if accepted_warning_codes
                .iter()
                .any(|code| scalar_len(code) == 0 || scalar_len(code) > 64)
            {
                return Err(invalid());
            }
            Ok(())
        }
        AssistantToolArguments::TagItems {
            input_ids,
            add_tag_ids,
            remove_tag_ids,
        } => {
            if input_ids.is_empty() || input_ids.len() > 100 || !unique(input_ids) {
                return Err(invalid());
            }
            if add_tag_ids.len() > 32 || remove_tag_ids.len() > 32 {
                return Err(invalid());
            }
            if !unique(add_tag_ids) || !unique(remove_tag_ids) {
                return Err(invalid());
            }
            if add_tag_ids.iter().any(|id| remove_tag_ids.contains(id)) {
                return Err(invalid());
            }
            Ok(())
        }
        AssistantToolArguments::PrivacyClean {
            input_ids,
            categories,
            ..
        } => {
            if input_ids.is_empty() || input_ids.len() > 100 || !unique(input_ids) {
                return Err(invalid());
            }
            if categories.is_empty() || categories.len() > 32 || !unique_categories(categories) {
                return Err(invalid());
            }
            Ok(())
        }
        AssistantToolArguments::RecycleItems { input_ids } => {
            if input_ids.is_empty() || input_ids.len() > 100 || !unique(input_ids) {
                return Err(invalid());
            }
            Ok(())
        }
        _ => Err(invalid()),
    }
}

fn unique_strings(values: &[String]) -> bool {
    let mut seen = std::collections::HashSet::new();
    values.iter().all(|value| seen.insert(value))
}

fn unique_categories(values: &[MetadataCategory]) -> bool {
    let mut seen = std::collections::HashSet::new();
    values.iter().all(|value| seen.insert(*value))
}

/// Parse one raw argument object for a known tool. Unknown keys and unknown
/// tools are refused before any adapter is reached.
pub fn parse_arguments(tool_id: &str, raw: &Value) -> Result<AssistantToolArguments, String> {
    let keys: &[&str] = match tool_id {
        "open_tab" => &["tool_id", "input_id", "background"],
        "switch_tab" | "close_tab" => &["tool_id", "tab_id"],
        "group_tabs" => &["tool_id", "tab_ids", "name", "color"],
        "open_saved_group" => &["tool_id", "group_id"],
        "search_files" => &["tool_id", "text", "root_ids", "mode"],
        "read_file" => &["tool_id", "input_id", "location", "max_scalars"],
        "describe_image" => &["tool_id", "input_id", "question"],
        "create_file" => &["tool_id", "parent_root_id", "name", "format", "content"],
        "create_folder" => &["tool_id", "parent_root_id", "name"],
        "create_from_template" => &["tool_id", "parent_root_id", "name", "template_id"],
        "rename_items" => &["tool_id", "items"],
        "move_items" | "copy_items" => &["tool_id", "input_ids", "target_root_id", "conflict"],
        "convert" => &[
            "tool_id",
            "input_ids",
            "converter_id",
            "format",
            "options",
            "target_root_id",
            "accepted_losses",
            "accepted_warning_codes",
        ],
        "tag_items" => &["tool_id", "input_ids", "add_tag_ids", "remove_tag_ids"],
        "privacy_clean" => &["tool_id", "input_ids", "categories", "target_root_id"],
        "recycle_items" => &["tool_id", "input_ids"],
        _ => return Err("assistant.invalid_tool".to_string()),
    };
    let object = exact_keys(raw, keys)?;
    if object.get("tool_id").and_then(Value::as_str) != Some(tool_id) {
        return Err(invalid());
    }
    if tool_id == "read_file" {
        validate_location_value(object.get("location").ok_or_else(invalid)?)?;
    }
    let args: AssistantToolArguments = serde_json::from_value(raw.clone()).map_err(|_| invalid())?;
    validate_arguments(&args)?;
    Ok(args)
}

/// The provider may return several `tool_calls`; the assistant accepts zero
/// (normal answer text) or exactly one structured request. Anything else is
/// refused before execution.
pub fn one_tool_call(calls: &[Value]) -> Result<Option<&Value>, String> {
    match calls.len() {
        0 => Ok(None),
        1 => Ok(Some(&calls[0])),
        _ => Err("assistant.invalid_arguments".to_string()),
    }
}

/// Validate a full typed request against the registry and capabilities.
pub fn validate_request(
    request: &AssistantToolRequest,
    capabilities: &[String],
    recycle_available: bool,
) -> Result<(), String> {
    let row = spec(&request.tool_id).ok_or_else(|| "assistant.invalid_tool".to_string())?;
    if row.risk == AssistantRisk::Irreversible {
        return Err("assistant.invalid_tool".to_string());
    }
    if request.arguments.tool_id() != request.tool_id {
        return Err(invalid());
    }
    if !capabilities.contains(&row.required_capability) {
        return Err("assistant.scope_denied".to_string());
    }
    if row.tool_id == "recycle_items" && !recycle_available {
        return Err("assistant.recycle_unavailable".to_string());
    }
    if request.call_id.is_empty() || request.call_id.len() > 64 || !request.call_id.is_ascii() {
        return Err(invalid());
    }
    validate_arguments(&request.arguments)
}

#[cfg(test)]
#[path = "assistant_tools_step17a_tests.rs"]
mod step17a_tests;
