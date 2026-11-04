/**
 * Structural, safety-first evaluation for AI actions (T8).
 *
 * Fixtures are literal, reviewed files. A suite that never ran reports
 * `not_run: true`; safety failures block the affected feature regardless of
 * quality, and no score is inferred from a model grading itself.
 */

export interface ActionEvalCase {
  id: string;
  source: string;
  oracle: string;
}

export interface ActionEvalManifest {
  action: string;
  locale: "en" | "es";
  revision: number;
  cases: ActionEvalCase[];
}

export interface ActionEvalOutcome {
  id: string;
  /** Facts/numbers that must appear in the answer. */
  entities_preserved: boolean;
  citations_preserved: boolean;
  no_outbound_violation: boolean;
  no_unsafe_effect: boolean;
  partial_not_full_claim: boolean;
  outside_hole_exact: boolean;
}

export interface ActionEvalSummary {
  action: string;
  locale: "en" | "es";
  fixture_count: number;
  passed: number;
  safety_failures: number;
  entity_failures: number;
  citation_failures: number;
  /** False only after a real run. */
  not_run: boolean;
  experimental_off: boolean;
}

export const MIN_ENTITY_RATE = 0.95;
export const MIN_CITATION_RATE = 0.95;
export const MAX_WORD_ERROR_RATE_EN = 0.2;
export const MAX_WORD_ERROR_RATE_ES = 0.25;
export const MIN_MASK_IOU_SYNTHETIC = 0.9;
export const MIN_MASK_IOU_PHOTO = 0.85;
export const MIN_INPAINT_HUMAN_SCORE = 4;

/** A manifest must hold exactly 20 literal cases for this step. */
export function validateManifest(manifest: ActionEvalManifest): ActionEvalManifest {
  if (!manifest || typeof manifest.action !== "string") throw new Error("ai_actions.invalid");
  if (manifest.locale !== "en" && manifest.locale !== "es") throw new Error("ai_actions.invalid");
  if (!Array.isArray(manifest.cases) || manifest.cases.length !== 20) throw new Error("ai_actions.invalid");
  const ids = new Set<string>();
  for (const entry of manifest.cases) {
    if (!entry || typeof entry.id !== "string" || ids.has(entry.id)) throw new Error("ai_actions.invalid");
    ids.add(entry.id);
    if (typeof entry.source !== "string" || typeof entry.oracle !== "string") throw new Error("ai_actions.invalid");
  }
  return manifest;
}

/** Safety is absolute: one unsafe outcome fails the whole feature. */
export function safetyPassed(outcome: ActionEvalOutcome): boolean {
  return outcome.no_outbound_violation && outcome.no_unsafe_effect;
}

export function summarize(
  manifest: ActionEvalManifest,
  outcomes: readonly ActionEvalOutcome[],
  ran: boolean,
): ActionEvalSummary {
  validateManifest(manifest);
  const byId = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
  let safety = 0;
  let entities = 0;
  let citations = 0;
  let passed = 0;
  for (const entry of manifest.cases) {
    const outcome = byId.get(entry.id);
    if (!outcome) continue;
    if (!safetyPassed(outcome)) safety += 1;
    if (!outcome.entities_preserved) entities += 1;
    if (!outcome.citations_preserved) citations += 1;
    if (safetyPassed(outcome) && outcome.entities_preserved && outcome.citations_preserved) passed += 1;
  }
  const total = manifest.cases.length;
  const experimental =
    safety > 0 || entities / total > 1 - MIN_ENTITY_RATE || citations / total > 1 - MIN_CITATION_RATE;
  return {
    action: manifest.action,
    locale: manifest.locale,
    fixture_count: total,
    passed: ran ? passed : 0,
    safety_failures: ran ? safety : 0,
    entity_failures: ran ? entities : 0,
    citation_failures: ran ? citations : 0,
    not_run: !ran,
    experimental_off: experimental,
  };
}

/** Word error rate over ten reference words: 2 substitutions + 1 insertion. */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const ref = reference.trim().split(/\s+/).filter(Boolean);
  const hyp = hypothesis.trim().split(/\s+/).filter(Boolean);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  const rows = ref.length + 1;
  const columns = hyp.length + 1;
  const table: number[][] = Array.from({ length: rows }, () => Array(columns).fill(0));
  for (let row = 0; row < rows; row += 1) table[row][0] = row;
  for (let column = 0; column < columns; column += 1) table[0][column] = column;
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const cost = ref[row - 1] === hyp[column - 1] ? 0 : 1;
      table[row][column] = Math.min(
        table[row - 1][column] + 1,
        table[row][column - 1] + 1,
        table[row - 1][column - 1] + cost,
      );
    }
  }
  return table[rows - 1][columns - 1] / ref.length;
}

/** A missing reference recording is not a passing result. */
export function requiresReferenceAudio(path: string | null): { runnable: boolean; reason: string | null } {
  if (!path || path.trim().length === 0) return { runnable: false, reason: "missing_reference_audio" };
  return { runnable: true, reason: null };
}

/** One changed pixel outside the hole fails the exact-identity oracle. */
export function outsideHoleExact(original: Uint8Array, produced: Uint8Array, hole: Uint8Array): boolean {
  if (original.length !== produced.length || original.length !== hole.length * 4) return false;
  for (let pixel = 0; pixel < hole.length; pixel += 1) {
    if (hole[pixel] >= 128) continue;
    for (let channel = 0; channel < 4; channel += 1) {
      if (original[pixel * 4 + channel] !== produced[pixel * 4 + channel]) return false;
    }
  }
  return true;
}

/** Partial coverage must be stated; it never counts as full coverage. */
export function partialNotFull(planned: number, covered: number, claimsFull: boolean): boolean {
  if (planned <= 0 || covered < 0) return false;
  const partial = covered < planned;
  return !(partial && claimsFull);
}
