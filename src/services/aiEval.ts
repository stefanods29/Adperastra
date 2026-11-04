import { invoke } from "@tauri-apps/api/core";
import type { EvalSummary } from "../assistant/evalTypes";
import { runJob, type JobHandle } from "./jobs";
import {
  AI_EVAL_DEFAULT_PAGE,
  assertEvalSuite,
  normalizeEvalPageRequest,
  validateEvalPage,
  type AiEvalPage,
} from "./aiEvalValidation";

export {
  AI_EVAL_DEFAULT_PAGE,
  AI_EVAL_MAX_CASES,
  AI_EVAL_MAX_PAGE,
  AI_EVAL_SUITES,
  type AiEvalCase,
  type AiEvalPage,
  type AiEvalSuiteId,
} from "./aiEvalValidation";

/**
 * Evaluation runner for coordinator/test mode only (Step 17a T8, E9).
 * Never registered as an assistant tool. A real API suite needs the reviewer's
 * explicit cost approval in the native plan; absence returns notrun.
 */
export async function runEvalSuite(suiteId: string): Promise<JobHandle<EvalSummary>> {
  const suite = assertEvalSuite(suiteId);
  return runJob<EvalSummary>("aieval", async (requestId) => {
    await invoke("ai_eval_start", { requestId, suiteId: suite });
  });
}

/**
 * Read one bounded page of the deterministic fixture validation (Step 17a T8).
 * This never starts a model: every page carries `notrun: true`, and the
 * validator refuses a page that claims otherwise. No native run state is
 * kept, so any page of a suite is reproducible. There is no eval UI yet, so
 * this wrapper is the only way the coordinator lists cases.
 */
export async function evalPage(
  suiteId: string,
  offset = 0,
  limit = AI_EVAL_DEFAULT_PAGE,
): Promise<AiEvalPage> {
  const request = normalizeEvalPageRequest(suiteId, offset, limit);
  return validateEvalPage(
    await invoke("ai_eval_page", {
      suiteId: request.suiteId,
      offset: request.offset,
      limit: request.limit,
    }),
  );
}
