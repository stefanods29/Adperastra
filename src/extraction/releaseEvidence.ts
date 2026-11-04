/** v0.5 milestone gate (Step 17d T8, decision D10).
 *
 * A draft release is prepared only after real gate, package, evaluation,
 * screenshot and owner evidence exists. Nothing here records or invents
 * results; the coordinator fills them from executed runs, and publishing
 * always needs the owner's explicit yes.
 */

export const MILESTONE_TAG = "v0.5.0";

export interface MilestoneEvidence {
  gate_passed: boolean;
  package_passed: boolean;
  evaluations_passed: boolean;
  screenshots_captured: boolean;
  accessibility_checked: boolean;
  source_hashes_recorded: boolean;
  owner_approved: boolean;
}

export type ReleaseDecision = "publish" | "hold";

const REQUIRED: ReadonlyArray<keyof MilestoneEvidence> = [
  "gate_passed",
  "package_passed",
  "evaluations_passed",
  "screenshots_captured",
  "accessibility_checked",
  "source_hashes_recorded",
  "owner_approved",
];

export function missingMilestoneEvidence(evidence: MilestoneEvidence): string[] {
  return REQUIRED.filter((key) => evidence[key] !== true);
}

/** Publishing is never automatic: any missing item keeps the draft closed. */
export function milestoneReleaseDecision(evidence: MilestoneEvidence): ReleaseDecision {
  return missingMilestoneEvidence(evidence).length === 0 ? "publish" : "hold";
}

/** A draft may exist while the remaining evidence is being produced; it is
 * still not published and the missing list is shown. */
export function draftReleaseAllowed(evidence: MilestoneEvidence): boolean {
  return evidence.gate_passed && evidence.package_passed;
}

export function emptyMilestoneEvidence(): MilestoneEvidence {
  return {
    gate_passed: false,
    package_passed: false,
    evaluations_passed: false,
    screenshots_captured: false,
    accessibility_checked: false,
    source_hashes_recorded: false,
    owner_approved: false,
  };
}
