import { describe, expect, it } from "vitest";
import { DECK_STYLE_SUFFIXES, type DeckStyleSuffix } from "../office/deck/styles/stylePalettes";
import {
  deckQualityDecision,
  deckReleaseDecision,
  requiredDeckGroups,
  validateTuningArtifacts,
  type DeckEvalGroupResult,
} from "../../tests/ai/suites/deckEvaluation";

function group(style: DeckStyleSuffix, locale: "en" | "es"): DeckEvalGroupResult {
  return {
    style,
    locale,
    schema_pass: 10,
    schema_total: 10,
    layout_pass: 10,
    layout_total: 10,
    font_license_pass: 10,
    font_license_total: 10,
    safe_ops_pass: 10,
    safe_ops_total: 10,
    overflow_accepted: 0,
    protected_facts_total: 120,
    protected_facts_preserved: 120,
    image_downloads: 0,
    style_fit: 4.5,
    groundedness: 0.98,
    readability: 4.4,
  };
}

function allGroups(): DeckEvalGroupResult[] {
  return requiredDeckGroups().map(({ style, locale }) => group(style, locale));
}

describe("deck quality evaluation", () => {
  it("fails when one of the sixteen language/style groups is missing", () => {
    const groups = allGroups();
    groups.splice(groups.findIndex((item) => item.style === "technical" && item.locale === "es"), 1);
    const decision = deckQualityDecision({ run_completed: true, groups });
    expect(decision.status).toBe("fail");
    expect(decision.failures).toContain("missing:technical:es");
  });

  it("has zero tolerance for one accepted overflow", () => {
    const groups = allGroups();
    groups[3].overflow_accepted = 1;
    const decision = deckQualityDecision({ run_completed: true, groups });
    expect(decision.status).toBe("fail");
    expect(decision.failures.some((failure) => failure.startsWith("overflow:"))).toBe(true);
  });

  it("fails when protected facts fall from 120 to 12", () => {
    const groups = allGroups();
    groups[0].protected_facts_preserved = 12;
    const decision = deckQualityDecision({ run_completed: true, groups });
    expect(decision.status).toBe("fail");
    expect(decision.failures).toContain("facts:business:en");
  });

  it("passes only when every group meets every threshold", () => {
    expect(deckQualityDecision({ run_completed: true, groups: allGroups() })).toEqual({
      status: "pass",
      failures: [],
    });
    expect(DECK_STYLE_SUFFIXES).toHaveLength(8);
  });

  it("keeps evaluation pending until an actual run exists", () => {
    expect(deckQualityDecision(null)).toEqual({ status: "pending", failures: ["deck_eval_not_run"] });
    expect(deckQualityDecision({ run_completed: false, groups: [] }).status).toBe("pending");
  });

  it("rejects repository weight paths in a tuning manifest", () => {
    expect(
      validateTuningArtifacts([
        {
          repository_path: "weights/deck-adapter.gguf",
          kind: "weights",
          license: "Apache-2.0",
          provenance: "local",
          rights_confirmed: true,
          training_outside_app_repo: false,
        },
      ]),
    ).toEqual([
      "weight_in_repository:weights/deck-adapter.gguf",
      "weights_folder_in_repository:weights/deck-adapter.gguf",
      "training_in_repo:weights/deck-adapter.gguf",
    ]);
  });

  it("never publishes an unrun suite or an unapproved release", () => {
    const decision = deckReleaseDecision({
      quality: { status: "pending", failures: ["deck_eval_not_run"] },
      gate_passed: false,
      package_passed: false,
      speed_passed: false,
      security_passed: false,
      fidelity_passed: false,
      owner_approved_release: false,
      open_blockers: 1,
      open_majors: 1,
    });
    expect(decision.publish).toBe(false);
    expect(decision.draft_allowed).toBe(true);
    expect(decision.reasons).toContain("owner_approval_missing");
    expect(decision.reasons).toContain("quality_not_passed");
  });
});
