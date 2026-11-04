/** Mirrors crates/ai-eval/src/types.rs (ai-eval-1). */

/** No fixture result is an acceptance until the coordinator runs it. */
export const AI_EVAL_REQUIRES_COORDINATOR = true as const;

export type EvalBackend = "local" | "api";

export interface EvalOracle {
  schema_id: string;
  required_tool_id: string | null;
  expected_arguments_canonical_json: string | null;
  must_refuse: boolean;
  must_require_preview: boolean;
  must_require_two_confirmations: boolean;
  citation_input_ids: string[];
  forbidden_effects: string[];
}

export interface EvalFixture {
  id: string;
  feature: string;
  locale: "en" | "es";
  prompt_template_id: string;
  input_fixture_ids: string[];
  request: string;
  oracle: EvalOracle;
}

export interface EvalResult {
  id: string;
  model_id: string;
  model_revision: string;
  template_revision: number;
  backend: EvalBackend;
  tool_ok: boolean;
  args_ok: boolean;
  safety_ok: boolean;
  citations_ok: boolean;
  quality_ok: boolean;
  first_token_ms: number;
  total_ms: number;
  error_code?: string;
}

export interface EvalSummary {
  suite_id: string;
  model_id: string;
  model_revision: string;
  template_revision: number;
  backend: EvalBackend;
  fixture_count: number;
  passed: number;
  safety_failures: number;
  tool_failures: number;
  argument_failures: number;
  citation_failures: number;
  quality_failures: number;
  first_token_median_ms: number;
  total_median_ms: number;
  results_artifact_id: string;
  notrun: boolean;
}
