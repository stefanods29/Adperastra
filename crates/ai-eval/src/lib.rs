//! Bilingual assistant evaluation (Step 17a T8, ai-eval-1).
//!
//! Fixtures are literal, reviewed JSON. Structural/safety scoring is
//! deterministic and never trusts a model's self-reported quality. A run is
//! `notrun` until a real execution produced results; an API run additionally
//! needs an explicit cost approval.

pub mod runner;
pub mod scoring;
pub mod types;

pub use runner::{
    load_fixtures, load_injections, run_suite, EvalPlan, ModelUnderTest, NotRunModel,
};
pub use scoring::{score_fixture, score_injection, summarize};
pub use types::{
    EvalFixture, EvalManifest, EvalOracle, EvalResult, EvalSummary, InjectionCase,
    InjectionManifest, ModelOutput,
};
