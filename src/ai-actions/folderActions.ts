import type { AiInputRef } from "../services/localAiTypes";
import type { AiActionOptions, AiActionRequest } from "../services/aiActionTypes";

/**
 * Folder summary review (D11): the exact list is shown and accepted first,
 * names are the default, contents need their own scope, and denied or
 * online-only files are skipped with a visible reason.
 */

export const MAX_FOLDER_FILES = 100;
export const MAX_FOLDER_SKIPPED = 100;

export interface FolderReviewItem {
  input_id: string;
  label: string;
  readable: boolean;
  denied: boolean;
  online_only: boolean;
  is_folder: boolean;
}

export interface FolderSkip {
  label: string;
  reason_code: "scope_denied" | "online_only" | "subfolder" | "unreadable";
}

export interface FolderReviewPlan {
  included: string[];
  skipped: FolderSkip[];
  partial: boolean;
  names_only: boolean;
  recursive: boolean;
  include_contents: boolean;
}

export function buildFolderPlan(
  items: readonly FolderReviewItem[],
  options: { recursive: boolean; includeContents: boolean },
): FolderReviewPlan {
  if (!Array.isArray(items) || items.length > MAX_FOLDER_FILES) throw new Error("ai_actions.too_large");
  const included: string[] = [];
  const skipped: FolderSkip[] = [];
  for (const item of items) {
    if (item.denied) {
      skipped.push({ label: item.label, reason_code: "scope_denied" });
      continue;
    }
    if (item.online_only) {
      skipped.push({ label: item.label, reason_code: "online_only" });
      continue;
    }
    if (!options.recursive && item.is_folder) {
      skipped.push({ label: item.label, reason_code: "subfolder" });
      continue;
    }
    if (options.includeContents && !item.readable) {
      skipped.push({ label: item.label, reason_code: "unreadable" });
      continue;
    }
    included.push(item.input_id);
  }
  return {
    included,
    skipped: skipped.slice(0, MAX_FOLDER_SKIPPED),
    partial: skipped.length > 0,
    names_only: !options.includeContents,
    recursive: options.recursive,
    include_contents: options.includeContents,
  };
}

/** Generating stays disabled until the displayed list is accepted. */
export function canGenerate(plan: FolderReviewPlan, accepted: boolean): boolean {
  return accepted && plan.included.length > 0 && plan.included.length <= MAX_FOLDER_FILES;
}

/** Content scope is separate from the folder list; names never imply it. */
export function needsContentScope(plan: FolderReviewPlan): boolean {
  return plan.include_contents;
}

export function buildFolderOptions(rootId: string, plan: FolderReviewPlan): AiActionOptions {
  if (!rootId) throw new Error("ai_actions.invalid");
  if (!canGenerate(plan, true)) throw new Error("ai_actions.no_sources");
  return {
    kind: "summarize_folder",
    root_id: rootId,
    recursive: plan.recursive,
    include_contents: plan.include_contents,
    approved_input_ids: [...plan.included],
  };
}

export function buildFolderRequest(
  rootId: string,
  inputs: readonly AiInputRef[],
  plan: FolderReviewPlan,
  revision = 1,
  outboundConsentId: string | null = null,
): AiActionRequest {
  if (plan.names_only && plan.include_contents) throw new Error("ai_actions.invalid");
  return {
    action: "summarize_folder",
    inputs: [...inputs],
    options: buildFolderOptions(rootId, plan),
    request_revision: revision,
    expected_content_id: null,
    scope_id: null,
    outbound_consent_id: outboundConsentId,
  };
}

/** A names-only result may not make claims about what a file contains. */
export function folderTextClaimsContent(plan: FolderReviewPlan, text: string): boolean {
  if (!plan.names_only) return false;
  const lowered = text.toLowerCase();
  return ["the file says", "according to", "contains", "states that"].some((marker) => lowered.includes(marker));
}
