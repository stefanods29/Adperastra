use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvalBackend {
    Local,
    Api,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalManifest {
    pub schema_version: u32,
    pub locale: String,
    pub fixtures: Vec<EvalFixture>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalFixture {
    pub id: String,
    pub feature: String,
    pub locale: String,
    pub prompt_template_id: String,
    pub input_fixture_ids: Vec<String>,
    pub request: String,
    pub oracle: EvalOracle,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalOracle {
    pub schema_id: String,
    pub required_tool_id: Option<String>,
    pub expected_arguments_canonical_json: Option<String>,
    pub must_refuse: bool,
    pub must_require_preview: bool,
    pub must_require_two_confirmations: bool,
    pub citation_input_ids: Vec<String>,
    pub forbidden_effects: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalResult {
    pub id: String,
    pub model_id: String,
    pub model_revision: String,
    pub template_revision: u32,
    pub backend: EvalBackend,
    pub tool_ok: bool,
    pub args_ok: bool,
    pub safety_ok: bool,
    pub citations_ok: bool,
    pub quality_ok: bool,
    pub first_token_ms: u64,
    pub total_ms: u64,
    pub error_code: Option<String>,
}

impl EvalResult {
    pub fn passed(&self) -> bool {
        self.tool_ok
            && self.args_ok
            && self.safety_ok
            && self.citations_ok
            && self.quality_ok
            && self.error_code.is_none()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalSummary {
    pub suite_id: String,
    pub model_id: String,
    pub model_revision: String,
    pub template_revision: u32,
    pub backend: EvalBackend,
    pub fixture_count: u32,
    pub passed: u32,
    pub safety_failures: u32,
    pub tool_failures: u32,
    pub argument_failures: u32,
    pub citation_failures: u32,
    pub quality_failures: u32,
    pub first_token_median_ms: u64,
    pub total_median_ms: u64,
    pub results_artifact_id: String,
    pub notrun: bool,
}

impl EvalSummary {
    pub fn passing(&self) -> bool {
        !self.notrun && self.passed == self.fixture_count
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct InjectionManifest {
    pub schema_version: u32,
    pub cases: Vec<InjectionCase>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InjectionCase {
    pub id: String,
    pub locale: String,
    pub category: String,
    pub text: String,
    pub expect_warning: bool,
    pub expect_refusal: bool,
    pub forbidden_effects: Vec<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ModelOutput {
    pub tool_id: Option<String>,
    pub arguments_json: Option<String>,
    pub text: String,
    pub citations: Vec<ModelCitation>,
    pub effects: Vec<String>,
    pub refused: bool,
    pub warned: bool,
    pub previewed: bool,
    pub two_confirmations: bool,
    pub first_token_ms: u64,
    pub total_ms: u64,
    /// Ignored by the scorer; kept only to prove it is not used.
    pub self_reported_quality: u32,
}

#[derive(Debug, Clone)]
pub struct ModelCitation {
    pub input_id: String,
    pub quote: String,
}
