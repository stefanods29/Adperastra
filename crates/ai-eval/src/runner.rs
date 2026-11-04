use std::path::Path;

use crate::scoring::{score_fixture, summarize};
use crate::types::{
    EvalBackend, EvalFixture, EvalManifest, EvalResult, EvalSummary, InjectionManifest, ModelOutput,
};

pub struct EvalPlan {
    pub suite_id: String,
    pub backend: EvalBackend,
    /// API runs are paid and need an explicit reviewer/owner approval.
    pub cost_approved: bool,
    pub notrun: bool,
}

pub trait ModelUnderTest {
    fn run(&mut self, fixture: &EvalFixture) -> Result<ModelOutput, String>;
    fn model_id(&self) -> &str;
    fn model_revision(&self) -> &str;
    fn template_revision(&self) -> u32;
}

pub fn load_fixtures(path: &Path) -> Result<EvalManifest, String> {
    let bytes = std::fs::read(path).map_err(|_| "ai_eval.fixture_missing".to_string())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("ai_eval.fixture_too_large".to_string());
    }
    serde_json::from_slice(&bytes).map_err(|_| "ai_eval.fixture_invalid".to_string())
}

pub fn load_injections(path: &Path) -> Result<InjectionManifest, String> {
    let bytes = std::fs::read(path).map_err(|_| "ai_eval.fixture_missing".to_string())?;
    if bytes.len() > 2 * 1024 * 1024 {
        return Err("ai_eval.fixture_too_large".to_string());
    }
    serde_json::from_slice(&bytes).map_err(|_| "ai_eval.fixture_invalid".to_string())
}

/// Run every fixture. `notrun` never becomes a passing summary; an API plan
/// without cost approval returns before the model is called.
pub fn run_suite(
    plan: &EvalPlan,
    fixtures: &[EvalFixture],
    model: &mut dyn ModelUnderTest,
) -> Result<EvalSummary, String> {
    if plan.backend == EvalBackend::Api && !plan.cost_approved {
        return Err("ai_eval.cost_approval_required".to_string());
    }
    if plan.notrun {
        return Ok(summarize(&plan.suite_id, &[], plan.backend, true));
    }
    if fixtures.is_empty() {
        return Err("ai_eval.fixture_missing".to_string());
    }
    let mut results = Vec::with_capacity(fixtures.len());
    for fixture in fixtures {
        let output = model.run(fixture)?;
        results.push(score_fixture(
            fixture,
            &output,
            model.model_id(),
            model.model_revision(),
            model.template_revision(),
            plan.backend,
        ));
    }
    Ok(summarize(&plan.suite_id, &results, plan.backend, false))
}

/// A deterministic no-op model for fixture-shape tests only. It never claims
/// a passing run; callers must not ship it as an evaluation result.
pub struct NotRunModel;

impl ModelUnderTest for NotRunModel {
    fn run(&mut self, _fixture: &EvalFixture) -> Result<ModelOutput, String> {
        Err("ai_eval.notrun".to_string())
    }

    fn model_id(&self) -> &str {
        "notrun"
    }

    fn model_revision(&self) -> &str {
        "notrun"
    }

    fn template_revision(&self) -> u32 {
        0
    }
}

pub fn results_are_real(results: &[EvalResult]) -> bool {
    !results.is_empty() && results.iter().all(|result| result.error_code.is_none())
}
