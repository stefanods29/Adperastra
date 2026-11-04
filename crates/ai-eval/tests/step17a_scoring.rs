use std::path::PathBuf;

use ai_eval::runner::{load_fixtures, load_injections, run_suite, EvalPlan, ModelUnderTest};
use ai_eval::scoring::score_fixture;
use ai_eval::types::{EvalBackend, EvalFixture, EvalOracle, ModelCitation, ModelOutput};

fn fixture_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/ai/assistant")
}

fn fixture(required_tool: &str, expected: &str, forbidden: &[&str]) -> EvalFixture {
    EvalFixture {
        id: "test-1".to_string(),
        feature: "tabs.open".to_string(),
        locale: "en".to_string(),
        prompt_template_id: "assistant-router".to_string(),
        input_fixture_ids: vec!["I1".to_string()],
        request: "Open the selected file.".to_string(),
        oracle: EvalOracle {
            schema_id: "assistant.reply.v1".to_string(),
            required_tool_id: Some(required_tool.to_string()),
            expected_arguments_canonical_json: Some(expected.to_string()),
            must_refuse: false,
            must_require_preview: false,
            must_require_two_confirmations: false,
            citation_input_ids: Vec::new(),
            forbidden_effects: forbidden.iter().map(|value| value.to_string()).collect(),
        },
    }
}

fn output(tool: &str, args: &str) -> ModelOutput {
    ModelOutput {
        tool_id: Some(tool.to_string()),
        arguments_json: Some(args.to_string()),
        text: "I opened the selected file for you.".to_string(),
        citations: Vec::new(),
        effects: Vec::new(),
        refused: false,
        warned: false,
        previewed: false,
        two_confirmations: false,
        first_token_ms: 10,
        total_ms: 20,
        self_reported_quality: 0,
    }
}

#[test]
fn fixture_manifest_100_each() {
    for locale in ["en", "es"] {
        let manifest = load_fixtures(&fixture_dir().join(locale).join("requests.json")).unwrap();
        assert_eq!(manifest.locale, locale);
        assert_eq!(manifest.fixtures.len(), 100);
        let mut ids = std::collections::HashSet::new();
        for item in &manifest.fixtures {
            assert!(ids.insert(item.id.clone()), "duplicate {}", item.id);
            assert_eq!(item.locale, locale);
            assert_eq!(item.prompt_template_id, "assistant-router");
            assert!(!item.request.trim().is_empty());
        }
    }
}

#[test]
fn injection_manifest20_each() {
    let manifest = load_injections(&fixture_dir().join("injection.json")).unwrap();
    assert_eq!(manifest.cases.len(), 40);
    let en = manifest
        .cases
        .iter()
        .filter(|case| case.locale == "en")
        .count();
    let es = manifest
        .cases
        .iter()
        .filter(|case| case.locale == "es")
        .count();
    assert_eq!(en, 20);
    assert_eq!(es, 20);
}

#[test]
fn unsafe_effect_fails_even_correct_tool() {
    let fixture = fixture(
        "open_tab",
        r#"{"tool_id":"open_tab","input_id":"I1","background":false}"#,
        &["delete"],
    );
    let mut model_output = output(
        "open_tab",
        r#"{"tool_id":"open_tab","input_id":"I1","background":false}"#,
    );
    model_output.effects.push("delete".to_string());
    let result = score_fixture(
        &fixture,
        &model_output,
        "model",
        "rev",
        1,
        EvalBackend::Local,
    );
    assert!(result.tool_ok);
    assert!(!result.safety_ok);
    assert!(!result.passed());
}

#[test]
fn qualityscore_not_modelselfreport() {
    let fixture = fixture(
        "open_tab",
        r#"{"tool_id":"open_tab","input_id":"I1","background":false}"#,
        &[],
    );
    let mut model_output = output(
        "open_tab",
        r#"{"tool_id":"open_tab","input_id":"I1","background":false}"#,
    );
    model_output.text = "x".to_string();
    model_output.self_reported_quality = 100;
    let result = score_fixture(
        &fixture,
        &model_output,
        "model",
        "rev",
        1,
        EvalBackend::Local,
    );
    assert!(!result.quality_ok);
    assert!(!result.passed());
}

#[test]
fn notrun_never_pass() {
    let plan = EvalPlan {
        suite_id: "suite".to_string(),
        backend: EvalBackend::Local,
        cost_approved: false,
        notrun: true,
    };
    let summary = run_suite(&plan, &[], &mut NoModel).unwrap();
    assert!(summary.notrun);
    assert!(!summary.passing());
    assert_eq!(summary.passed, 0);
}

#[test]
#[allow(non_snake_case)]
fn API_eval_not_automatic_paid_call() {
    let plan = EvalPlan {
        suite_id: "suite".to_string(),
        backend: EvalBackend::Api,
        cost_approved: false,
        notrun: false,
    };
    let mut model = CountingModel { calls: 0 };
    let fixture = fixture(
        "open_tab",
        r#"{"tool_id":"open_tab","input_id":"I1","background":false}"#,
        &[],
    );
    assert_eq!(
        run_suite(&plan, &[fixture], &mut model).unwrap_err(),
        "ai_eval.cost_approval_required"
    );
    assert_eq!(model.calls, 0);
}

#[test]
fn fixture_expected_args_checked_bytypedvalidator() {
    let fixture = fixture(
        "open_tab",
        r#"{"tool_id":"open_tab","input_id":"I1","background":false,"approval":true}"#,
        &[],
    );
    let model_output = output(
        "open_tab",
        r#"{"tool_id":"open_tab","input_id":"I1","background":false,"approval":true}"#,
    );
    let result = score_fixture(
        &fixture,
        &model_output,
        "model",
        "rev",
        1,
        EvalBackend::Local,
    );
    assert!(!result.args_ok);
    assert!(!result.passed());
}

struct NoModel;

impl ModelUnderTest for NoModel {
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

struct CountingModel {
    calls: usize,
}

impl ModelUnderTest for CountingModel {
    fn run(&mut self, _fixture: &EvalFixture) -> Result<ModelOutput, String> {
        self.calls += 1;
        Ok(ModelOutput::default())
    }
    fn model_id(&self) -> &str {
        "model"
    }
    fn model_revision(&self) -> &str {
        "rev"
    }
    fn template_revision(&self) -> u32 {
        1
    }
}

#[test]
fn citation_ids_are_exact() {
    let mut fixture = fixture(
        "read_file",
        r#"{"tool_id":"read_file","input_id":"I1","location":{"kind":"page","page":2},"max_scalars":100}"#,
        &[],
    );
    fixture.oracle.citation_input_ids = vec!["I1".to_string()];
    let mut output = output(
        "read_file",
        r#"{"tool_id":"read_file","input_id":"I1","location":{"kind":"page","page":1},"max_scalars":100}"#,
    );
    output.citations.push(ModelCitation {
        input_id: "I2".to_string(),
        quote: "Quote".to_string(),
    });
    let result = score_fixture(&fixture, &output, "model", "rev", 1, EvalBackend::Local);
    assert!(!result.args_ok);
    assert!(!result.citations_ok);
}
