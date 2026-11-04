//! Native entry point for the assistant evaluation harness (Step 17a T8,
//! `ai-eval-1`). Coordinator/test mode only; never an assistant tool.
//!
//! The reviewed fixtures are compiled into the binary, so a run reads no
//! user files, starts no model and opens no network connection. The job does
//! the deterministic part of evaluation: it validates every case ID, count,
//! locale and oracle with the same `ai-eval` types and typed-argument
//! validator the scorers use, then returns an honestly `notrun` summary.
//! A passing summary still requires a real local-model run (or an API run
//! with explicit cost approval), which this command deliberately cannot fake.

use std::sync::atomic::Ordering;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, State, WebviewWindow};

use crate::ai_eval_fixtures::{load_suite, AiEvalCaseRow, Suite, ERR_FIXTURE_INVALID};
use crate::jobs::{spawn_job, JobContext, Jobs};
use crate::{ensure_main, valid_request_id};

/// A page offset or limit is outside the bounded page.
pub const ERR_PAGE_INVALID: &str = "ai_eval.page_invalid";
/// The result could not be serialized for `job_poll`.
pub const ERR_FAILED: &str = "ai_eval.failed";

/// The largest page the caller may request.
pub const MAX_PAGE: u32 = 200;
/// The page used when the caller asks for zero.
pub const DEFAULT_PAGE: u32 = 50;

/// One bounded page of validated cases. `notrun` is always true here: the
/// rows prove fixture/oracle shape, never model quality.
#[derive(Debug, Clone, Serialize)]
pub struct AiEvalPage {
    pub suite_id: String,
    pub offset: u32,
    pub limit: u32,
    pub total: u32,
    pub next_offset: Option<u32>,
    pub notrun: bool,
    pub cases: Vec<AiEvalCaseRow>,
}

/// Start the deterministic local fixture evaluation as a shared job. The job
/// result is an `EvalSummary` (mirrored by `src/assistant/evalTypes.ts`).
#[tauri::command]
pub fn ai_eval_start(
    window: WebviewWindow,
    app: AppHandle,
    jobs: State<'_, Jobs>,
    request_id: String,
    suite_id: String,
) -> Result<(), String> {
    ensure_main(window.label())?;
    valid_request_id(&request_id)?;
    let suite = Suite::parse(&suite_id)?;
    let token = jobs.begin(&request_id, suite.case_count())?;
    spawn_job(app, request_id, token, move |context| run_eval(context, suite));
    Ok(())
}

/// Read one bounded page of the same deterministic validation. No run state is
/// kept: the embedded corpus is immutable, so every page is reproducible.
#[tauri::command]
pub fn ai_eval_page(
    window: WebviewWindow,
    suite_id: String,
    offset: u32,
    limit: u32,
) -> Result<AiEvalPage, String> {
    ensure_main(window.label())?;
    let suite = Suite::parse(&suite_id)?;
    let cases = load_suite(suite)?;
    build_page(suite, cases, offset, limit)
}

fn run_eval(context: &JobContext, suite: Suite) -> Result<Value, String> {
    if context.token().load(Ordering::Relaxed) {
        return Err("background.cancelled".to_string());
    }
    let cases = load_suite(suite)?;
    if context.token().load(Ordering::Relaxed) {
        return Err("background.cancelled".to_string());
    }
    context.set_progress(&fs_service::OpProgress {
        items_done: cases.len(),
        items_total: cases.len(),
        bytes_done: 0,
        bytes_total: 0,
        current: suite.id().to_string(),
    });
    // `notrun` makes `run_suite` return before it ever calls the model. The
    // no-op model would fail closed if that guard were ever removed, so this
    // path cannot silently turn into a fake passing run.
    let plan = ::ai_eval::EvalPlan {
        suite_id: suite.id().to_string(),
        backend: ::ai_eval::types::EvalBackend::Local,
        cost_approved: false,
        notrun: true,
    };
    let mut model = ::ai_eval::NotRunModel;
    let mut summary = ::ai_eval::run_suite(&plan, &[], &mut model)?;
    let count = u32::try_from(cases.len()).map_err(|_| ERR_FIXTURE_INVALID.to_string())?;
    summary.fixture_count = count;
    serde_json::to_value(summary).map_err(|_| ERR_FAILED.to_string())
}

fn build_page(
    suite: Suite,
    cases: Vec<AiEvalCaseRow>,
    offset: u32,
    limit: u32,
) -> Result<AiEvalPage, String> {
    let total = u32::try_from(cases.len()).map_err(|_| ERR_FIXTURE_INVALID.to_string())?;
    if offset > total {
        return Err(ERR_PAGE_INVALID.to_string());
    }
    let limit = if limit == 0 {
        DEFAULT_PAGE
    } else {
        limit.min(MAX_PAGE)
    };
    let start = offset as usize;
    let end = (start + limit as usize).min(cases.len());
    let next_offset = if end < cases.len() {
        Some(end as u32)
    } else {
        None
    };
    Ok(AiEvalPage {
        suite_id: suite.id().to_string(),
        offset,
        limit,
        total,
        next_offset,
        notrun: true,
        cases: cases[start..end].to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_is_bounded_and_rejects_past_the_end() {
        let cases = load_suite(Suite::AssistantAll).unwrap();
        let first = build_page(Suite::AssistantAll, cases, 0, u32::MAX).unwrap();
        assert_eq!(first.limit, MAX_PAGE);
        assert_eq!(first.cases.len(), MAX_PAGE as usize);
        assert_eq!(first.next_offset, Some(MAX_PAGE));

        let total = Suite::AssistantAll.case_count() as u32;
        let tail = build_page(
            Suite::AssistantAll,
            load_suite(Suite::AssistantAll).unwrap(),
            total,
            10,
        )
        .unwrap();
        assert!(tail.cases.is_empty());
        assert_eq!(tail.next_offset, None);

        assert_eq!(
            build_page(
                Suite::AssistantAll,
                load_suite(Suite::AssistantAll).unwrap(),
                total + 1,
                10,
            )
            .unwrap_err(),
            ERR_PAGE_INVALID
        );
    }
}
