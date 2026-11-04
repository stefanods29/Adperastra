//! Deterministic validation of the reviewed assistant evaluation fixtures
//! (Step 17a T8, `ai-eval-1`). The manifests are compiled into the binary, so
//! this module reads no user file, starts no model and opens no network
//! connection. It is the fixture half of `ai_eval_commands.rs`.

use std::collections::BTreeSet;

use serde::Serialize;
use serde_json::Value;

/// The suite name is not one of the compiled-in suites.
pub const ERR_UNKNOWN_SUITE: &str = "ai_eval.unknown_suite";
/// The manifest shape, locale or case count is wrong.
pub const ERR_FIXTURE_INVALID: &str = "ai_eval.fixture_invalid";
/// One case has an invalid ID, field or oracle.
pub const ERR_CASE_INVALID: &str = "ai_eval.case_invalid";

/// The largest combined suite; keeps one run and one page bounded.
pub const MAX_CASES: usize = 512;

/// The reviewed assistant manifests and injection corpus. Embedding them
/// keeps a packaged app path-free and makes every run reproducible.
const ASSISTANT_EN: &str = include_str!("../../tests/fixtures/ai/assistant/en/requests.json");
const ASSISTANT_ES: &str = include_str!("../../tests/fixtures/ai/assistant/es/requests.json");
const INJECTION: &str = include_str!("../../tests/fixtures/ai/assistant/injection.json");

const EN_CASES: usize = 100;
const ES_CASES: usize = 100;
const INJECTION_CASES: usize = 40;
const SCHEMA_VERSION: u32 = 1;
const ASSISTANT_SCHEMA_ID: &str = "assistant.reply.v1";
const MAX_ID_LEN: usize = 64;
const MAX_TEXT_LEN: usize = 8 * 1024;
const MAX_REFS: usize = 64;
const MAX_EFFECTS: usize = 16;
const EFFECTS: &[&str] = &[
    "disk_write",
    "disk_read",
    "network",
    "shell",
    "permanent_delete",
];

/// The four suites the coordinator can ask for. Names are stable because the
/// UI passes them through `runEvalSuite(suiteId)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(clippy::enum_variant_names)]
pub(crate) enum Suite {
    AssistantEn,
    AssistantEs,
    AssistantInjection,
    AssistantAll,
}

impl Suite {
    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        match value {
            "assistant-en" => Ok(Self::AssistantEn),
            "assistant-es" => Ok(Self::AssistantEs),
            "assistant-injection" => Ok(Self::AssistantInjection),
            "assistant-all" => Ok(Self::AssistantAll),
            _ => Err(ERR_UNKNOWN_SUITE.to_string()),
        }
    }

    pub(crate) fn id(self) -> &'static str {
        match self {
            Self::AssistantEn => "assistant-en",
            Self::AssistantEs => "assistant-es",
            Self::AssistantInjection => "assistant-injection",
            Self::AssistantAll => "assistant-all",
        }
    }

    pub(crate) fn case_count(self) -> usize {
        match self {
            Self::AssistantEn => EN_CASES,
            Self::AssistantEs => ES_CASES,
            Self::AssistantInjection => INJECTION_CASES,
            Self::AssistantAll => EN_CASES + ES_CASES + INJECTION_CASES,
        }
    }
}

/// One validated fixture. It carries no model output and no quality claim.
#[derive(Debug, Clone, Serialize)]
pub struct AiEvalCaseRow {
    pub id: String,
    pub feature: String,
    pub locale: String,
    pub tool_id: Option<String>,
    pub must_refuse: bool,
    pub must_warn: bool,
    pub forbidden_effects: Vec<String>,
    pub valid: bool,
}

pub(crate) fn load_suite(suite: Suite) -> Result<Vec<AiEvalCaseRow>, String> {
    let rows = match suite {
        Suite::AssistantEn => load_assistant(ASSISTANT_EN, "en", EN_CASES)?,
        Suite::AssistantEs => load_assistant(ASSISTANT_ES, "es", ES_CASES)?,
        Suite::AssistantInjection => load_injections(INJECTION)?,
        Suite::AssistantAll => {
            let mut rows = load_assistant(ASSISTANT_EN, "en", EN_CASES)?;
            rows.extend(load_assistant(ASSISTANT_ES, "es", ES_CASES)?);
            rows.extend(load_injections(INJECTION)?);
            rows
        }
    };
    if rows.len() > MAX_CASES || rows.len() != suite.case_count() {
        return Err(ERR_FIXTURE_INVALID.to_string());
    }
    let mut ids = BTreeSet::new();
    for row in &rows {
        if !ids.insert(row.id.as_str()) {
            return Err(ERR_CASE_INVALID.to_string());
        }
    }
    Ok(rows)
}

fn load_assistant(
    source: &str,
    locale: &str,
    expected: usize,
) -> Result<Vec<AiEvalCaseRow>, String> {
    let manifest: ::ai_eval::EvalManifest =
        serde_json::from_str(source).map_err(|_| ERR_FIXTURE_INVALID.to_string())?;
    if manifest.schema_version != SCHEMA_VERSION
        || manifest.locale != locale
        || manifest.fixtures.len() != expected
    {
        return Err(ERR_FIXTURE_INVALID.to_string());
    }
    let mut rows = Vec::with_capacity(expected);
    for fixture in &manifest.fixtures {
        validate_id(&fixture.id)?;
        if fixture.locale != locale {
            return Err(ERR_CASE_INVALID.to_string());
        }
        validate_text(&fixture.feature)?;
        validate_id(&fixture.prompt_template_id)?;
        validate_text(&fixture.request)?;
        validate_refs(&fixture.input_fixture_ids)?;
        validate_oracle(fixture)?;
        rows.push(AiEvalCaseRow {
            id: fixture.id.clone(),
            feature: fixture.feature.clone(),
            locale: fixture.locale.clone(),
            tool_id: fixture.oracle.required_tool_id.clone(),
            must_refuse: fixture.oracle.must_refuse,
            must_warn: false,
            forbidden_effects: fixture.oracle.forbidden_effects.clone(),
            valid: true,
        });
    }
    Ok(rows)
}

fn load_injections(source: &str) -> Result<Vec<AiEvalCaseRow>, String> {
    let manifest: ::ai_eval::InjectionManifest =
        serde_json::from_str(source).map_err(|_| ERR_FIXTURE_INVALID.to_string())?;
    if manifest.schema_version != SCHEMA_VERSION || manifest.cases.len() != INJECTION_CASES {
        return Err(ERR_FIXTURE_INVALID.to_string());
    }
    let mut rows = Vec::with_capacity(INJECTION_CASES);
    for case in &manifest.cases {
        validate_id(&case.id)?;
        if case.locale != "en" && case.locale != "es" {
            return Err(ERR_CASE_INVALID.to_string());
        }
        validate_text(&case.category)?;
        validate_text(&case.text)?;
        validate_effects(&case.forbidden_effects)?;
        if case.forbidden_effects.is_empty() && !case.expect_warning && !case.expect_refusal {
            return Err(ERR_CASE_INVALID.to_string());
        }
        rows.push(AiEvalCaseRow {
            id: case.id.clone(),
            feature: format!("injection.{}", case.category),
            locale: case.locale.clone(),
            tool_id: None,
            must_refuse: case.expect_refusal,
            must_warn: case.expect_warning,
            forbidden_effects: case.forbidden_effects.clone(),
            valid: true,
        });
    }
    Ok(rows)
}

fn validate_oracle(fixture: &::ai_eval::EvalFixture) -> Result<(), String> {
    let oracle = &fixture.oracle;
    if oracle.schema_id != ASSISTANT_SCHEMA_ID {
        return Err(ERR_CASE_INVALID.to_string());
    }
    validate_effects(&oracle.forbidden_effects)?;
    if oracle.citation_input_ids.len() > MAX_REFS {
        return Err(ERR_CASE_INVALID.to_string());
    }
    let mut citations = BTreeSet::new();
    for citation in &oracle.citation_input_ids {
        validate_ref(citation)?;
        if !citations.insert(citation.as_str())
            || !fixture.input_fixture_ids.iter().any(|id| id == citation)
        {
            return Err(ERR_CASE_INVALID.to_string());
        }
    }
    match (
        oracle.required_tool_id.as_deref(),
        oracle.expected_arguments_canonical_json.as_deref(),
    ) {
        (Some(tool_id), Some(expected)) => {
            validate_tool_id(tool_id)?;
            let value: Value =
                serde_json::from_str(expected).map_err(|_| ERR_CASE_INVALID.to_string())?;
            ::ai_eval::scoring::validate_expected_arguments(tool_id, &value)
                .map_err(|_| ERR_CASE_INVALID.to_string())?;
            if value.get("tool_id").and_then(Value::as_str) != Some(tool_id) {
                return Err(ERR_CASE_INVALID.to_string());
            }
        }
        (None, None) => {}
        _ => return Err(ERR_CASE_INVALID.to_string()),
    }
    if oracle.must_refuse && oracle.required_tool_id.is_some() {
        return Err(ERR_CASE_INVALID.to_string());
    }
    if oracle.required_tool_id.is_none()
        && (oracle.must_require_preview || oracle.must_require_two_confirmations)
    {
        return Err(ERR_CASE_INVALID.to_string());
    }
    if oracle.must_refuse && oracle.must_require_preview {
        return Err(ERR_CASE_INVALID.to_string());
    }
    Ok(())
}

fn validate_text(value: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.len() > MAX_TEXT_LEN {
        return Err(ERR_CASE_INVALID.to_string());
    }
    Ok(())
}

/// Fixture and injection IDs: short, lower-case, ASCII, path-free.
fn validate_id(value: &str) -> Result<(), String> {
    if value.len() > MAX_ID_LEN {
        return Err(ERR_CASE_INVALID.to_string());
    }
    let mut chars = value.chars();
    match chars.next() {
        Some(first) if first.is_ascii_lowercase() || first.is_ascii_digit() => {}
        _ => return Err(ERR_CASE_INVALID.to_string()),
    }
    if !chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        return Err(ERR_CASE_INVALID.to_string());
    }
    Ok(())
}

fn validate_tool_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_ID_LEN
        || !value
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
    {
        return Err(ERR_CASE_INVALID.to_string());
    }
    Ok(())
}

/// Input/citation references are opaque fixture IDs (`I1`, `I2`, ...).
fn validate_ref(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > MAX_ID_LEN
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(ERR_CASE_INVALID.to_string());
    }
    Ok(())
}

fn validate_refs(values: &[String]) -> Result<(), String> {
    if values.len() > MAX_REFS {
        return Err(ERR_CASE_INVALID.to_string());
    }
    let mut seen = BTreeSet::new();
    for value in values {
        validate_ref(value)?;
        if !seen.insert(value.as_str()) {
            return Err(ERR_CASE_INVALID.to_string());
        }
    }
    Ok(())
}

fn validate_effects(values: &[String]) -> Result<(), String> {
    if values.len() > MAX_EFFECTS {
        return Err(ERR_CASE_INVALID.to_string());
    }
    let mut seen = BTreeSet::new();
    for value in values {
        if !EFFECTS.contains(&value.as_str()) || !seen.insert(value.as_str()) {
            return Err(ERR_CASE_INVALID.to_string());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_suites_validate_with_exact_counts() {
        assert_eq!(load_suite(Suite::AssistantEn).unwrap().len(), 100);
        assert_eq!(load_suite(Suite::AssistantEs).unwrap().len(), 100);
        assert_eq!(load_suite(Suite::AssistantInjection).unwrap().len(), 40);
        assert_eq!(load_suite(Suite::AssistantAll).unwrap().len(), 240);
    }

    #[test]
    fn unknown_suite_is_a_stable_error() {
        for name in ["", "assistant-fr", "../../fixtures", "assistant"] {
            assert_eq!(Suite::parse(name).unwrap_err(), ERR_UNKNOWN_SUITE);
        }
    }
}
