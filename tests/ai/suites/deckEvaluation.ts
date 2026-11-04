import { DECK_STYLE_SUFFIXES, type DeckStyleSuffix } from "../../../src/office/deck/styles/stylePalettes";

/** Deck quality evaluation (Step 22b T14). Scores exist only after a real
 * run; a parser pass or an unrun suite is never a quality pass. */

export interface DeckEvalGroupResult {
  style: DeckStyleSuffix;
  locale: "en" | "es";
  schema_pass: number;
  schema_total: number;
  layout_pass: number;
  layout_total: number;
  font_license_pass: number;
  font_license_total: number;
  safe_ops_pass: number;
  safe_ops_total: number;
  overflow_accepted: number;
  protected_facts_total: number;
  protected_facts_preserved: number;
  image_downloads: number;
  style_fit: number | null;
  groundedness: number | null;
  readability: number | null;
}

export interface DeckEvalSuiteResult {
  run_completed: boolean;
  groups: DeckEvalGroupResult[];
}

export interface DeckQualityDecision {
  status: "pending" | "fail" | "pass";
  failures: string[];
}

export interface DeckReleaseEvidence {
  quality: DeckQualityDecision;
  gate_passed: boolean;
  package_passed: boolean;
  speed_passed: boolean;
  security_passed: boolean;
  fidelity_passed: boolean;
  owner_approved_release: boolean;
  open_blockers: number;
  open_majors: number;
}

export interface TuningArtifact {
  repository_path: string;
  kind: "dataset" | "adapter" | "weights" | "script";
  license: string;
  provenance: string;
  rights_confirmed: boolean;
  training_outside_app_repo: boolean;
}

export function requiredDeckGroups(): { style: DeckStyleSuffix; locale: "en" | "es" }[] {
  const groups: { style: DeckStyleSuffix; locale: "en" | "es" }[] = [];
  for (const style of DECK_STYLE_SUFFIXES) {
    for (const locale of ["en", "es"] as const) groups.push({ style, locale });
  }
  return groups;
}

function ratio(pass: number, total: number): boolean {
  return total > 0 && pass === total;
}

export function deckQualityDecision(result: DeckEvalSuiteResult | null): DeckQualityDecision {
  if (!result || !result.run_completed) return { status: "pending", failures: ["deck_eval_not_run"] };
  const failures: string[] = [];
  const present = new Set(result.groups.map((group) => `${group.style}:${group.locale}`));
  for (const group of requiredDeckGroups()) {
    if (!present.has(`${group.style}:${group.locale}`)) failures.push(`missing:${group.style}:${group.locale}`);
  }
  const byGroup = new Map(result.groups.map((group) => [`${group.style}:${group.locale}`, group]));
  for (const { style, locale } of requiredDeckGroups()) {
    const group = byGroup.get(`${style}:${locale}`);
    if (!group) continue;
    if (!ratio(group.schema_pass, group.schema_total)) failures.push(`schema:${style}:${locale}`);
    if (!ratio(group.layout_pass, group.layout_total)) failures.push(`layout:${style}:${locale}`);
    if (!ratio(group.font_license_pass, group.font_license_total)) failures.push(`font:${style}:${locale}`);
    if (!ratio(group.safe_ops_pass, group.safe_ops_total)) failures.push(`safe:${style}:${locale}`);
    if (group.overflow_accepted !== 0) failures.push(`overflow:${style}:${locale}`);
    if (group.protected_facts_total === 0 || group.protected_facts_preserved !== group.protected_facts_total) {
      failures.push(`facts:${style}:${locale}`);
    }
    if (group.image_downloads !== 0) failures.push(`download:${style}:${locale}`);
    if (group.style_fit === null || group.style_fit < 4) failures.push(`style_fit:${style}:${locale}`);
    if (group.groundedness === null || group.groundedness < 0.95) failures.push(`grounded:${style}:${locale}`);
    if (group.readability === null || group.readability < 4) failures.push(`readability:${style}:${locale}`);
  }
  for (const style of DECK_STYLE_SUFFIXES) {
    const en = byGroup.get(`${style}:en`);
    const es = byGroup.get(`${style}:es`);
    if (en && es && en.style_fit !== null && es.style_fit !== null && en.style_fit - es.style_fit > 0.25) {
      failures.push(`spanish_drop:${style}`);
    }
  }
  return failures.length === 0 ? { status: "pass", failures } : { status: "fail", failures };
}

export function deckReleaseDecision(evidence: DeckReleaseEvidence): {
  publish: boolean;
  draft_allowed: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (evidence.quality.status !== "pass") reasons.push("quality_not_passed");
  if (!evidence.gate_passed) reasons.push("gate_not_run");
  if (!evidence.package_passed) reasons.push("package_not_run");
  if (!evidence.speed_passed) reasons.push("speed_not_measured");
  if (!evidence.security_passed) reasons.push("security_not_verified");
  if (!evidence.fidelity_passed) reasons.push("fidelity_not_verified");
  if (evidence.open_blockers > 0) reasons.push("open_blocker");
  if (evidence.open_majors > 0) reasons.push("open_major");
  if (!evidence.owner_approved_release) reasons.push("owner_approval_missing");
  return {
    publish: reasons.length === 0,
    draft_allowed: true,
    reasons,
  };
}

export function validateTuningArtifacts(artifacts: readonly TuningArtifact[]): string[] {
  const failures: string[] = [];
  for (const artifact of artifacts) {
    if (/(\.gguf|\.onnx|\.safetensors|\.bin|\.pt)$/i.test(artifact.repository_path)) {
      failures.push(`weight_in_repository:${artifact.repository_path}`);
    }
    if (/(^|\/)(weights|models)\//i.test(artifact.repository_path)) {
      failures.push(`weights_folder_in_repository:${artifact.repository_path}`);
    }
    if (!artifact.training_outside_app_repo) failures.push(`training_in_repo:${artifact.repository_path}`);
    if (!artifact.rights_confirmed) failures.push(`rights_missing:${artifact.repository_path}`);
    if (artifact.license.trim().length === 0 || artifact.provenance.trim().length === 0) {
      failures.push(`license_missing:${artifact.repository_path}`);
    }
  }
  return failures;
}
