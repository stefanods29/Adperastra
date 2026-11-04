import type { AiCapabilityStatus } from "../services/localAiTypes";
import type { AiActionId, AiActionSpec, AiActionInputKind } from "../services/aiActionTypes";
import {
  AI_ACTION_MAX_INPUTS,
  AI_ACTION_IDS,
  AI_CAPABILITY_FOREGROUND,
  AI_CAPABILITY_INPAINT,
  AI_CAPABILITY_OCR,
  AI_CAPABILITY_TEXT,
  AI_CAPABILITY_TRANSCRIBE,
  AI_CAPABILITY_UPSCALE,
  AI_CAPABILITY_VISION,
} from "../services/aiActionTypes";

/**
 * The one typed AI-action registry (Step 17b, `ai-actions-1` E1).
 *
 * A missing or untested capability keeps an action visible but disabled.
 * Presence of a pack file alone never reports an action as working.
 * `copy_text` is the 07e Windows OCR command and needs no AI pack.
 */

/**
 * A namespaced capability row (`ai.*`, `assistant.*`). The native mirror
 * uses the same string ids, so the 14c task rows and the 17a backend rows
 * can sit in one context without duplicating a task type.
 */
export interface AssistantCapabilityRow {
  id: string;
  available: boolean;
  reason: string | null;
}

/** A 14c task row or a 17a backend row; never a duplicated task type. */
export type AiActionCapability = AiCapabilityStatus | AssistantCapabilityRow;

/**
 * What the current selection offers (`ai-actions-1` E1). `capabilities`
 * widens 14c's task rows with the 17a backend rows so text actions report
 * their own missing capability instead of borrowing a model task name.
 */
export interface AiActionContext {
  input_kinds: string[];
  input_count: number;
  capabilities: readonly AiActionCapability[];
}

const HELP_IMAGES = "ai-actions-images";
const HELP_DOCUMENTS = "ai-actions-documents";
const HELP_MEDIA = "ai-actions-media";
const HELP_MULTIPLE = "ai-actions-multiple";

function spec(
  id: AiActionId,
  capability: string,
  input_kind: AiActionInputKind,
  min: number,
  max: number,
  help: string,
  local_only: boolean,
  preview_required = true,
): AiActionSpec {
  return {
    id,
    label_key: `aiActions.${id}`,
    help_slug: help,
    required_capabilities: capability === AI_CAPABILITY_OCR ? [] : [capability],
    input_kind,
    min_inputs: min,
    max_inputs: max,
    local_only,
    preview_required,
  };
}

/** Every one of the 17 actions, in menu order. */
export const DEFAULT_AI_ACTION_SPECS: readonly AiActionSpec[] = [
  spec("remove_background", AI_CAPABILITY_FOREGROUND, "image", 1, 1, HELP_IMAGES, true),
  spec("blur_background", AI_CAPABILITY_FOREGROUND, "image", 1, 1, HELP_IMAGES, true),
  spec("erase_object", AI_CAPABILITY_INPAINT, "image", 1, 1, HELP_IMAGES, true),
  spec("copy_text", AI_CAPABILITY_OCR, "image", 1, 1, HELP_IMAGES, true, false),
  spec("describe_image", AI_CAPABILITY_VISION, "image", 1, 1, HELP_IMAGES, false),
  spec("ask_image", AI_CAPABILITY_VISION, "image", 1, 1, HELP_IMAGES, false),
  spec("upscale", AI_CAPABILITY_UPSCALE, "image", 1, 1, "ai-upscaling", true),
  spec("summarize", AI_CAPABILITY_TEXT, "document", 1, AI_ACTION_MAX_INPUTS, HELP_DOCUMENTS, false),
  spec("create_faq", AI_CAPABILITY_TEXT, "document", 1, AI_ACTION_MAX_INPUTS, HELP_DOCUMENTS, false),
  spec("translate", AI_CAPABILITY_TEXT, "document", 1, AI_ACTION_MAX_INPUTS, HELP_DOCUMENTS, false),
  spec("key_points", AI_CAPABILITY_TEXT, "document", 1, AI_ACTION_MAX_INPUTS, HELP_DOCUMENTS, false),
  spec("ask_file", AI_CAPABILITY_TEXT, "document", 1, AI_ACTION_MAX_INPUTS, HELP_DOCUMENTS, false),
  spec("transcribe", AI_CAPABILITY_TRANSCRIBE, "audio", 1, 1, HELP_MEDIA, true),
  spec("summarize_media", AI_CAPABILITY_TEXT, "audio", 1, 1, HELP_MEDIA, false),
  spec("find_moments", AI_CAPABILITY_TEXT, "audio", 1, 1, HELP_MEDIA, false),
  spec("compare_documents", AI_CAPABILITY_TEXT, "multiple", 2, 2, HELP_MULTIPLE, false),
  spec("summarize_folder", AI_CAPABILITY_TEXT, "folder", 1, AI_ACTION_MAX_INPUTS, HELP_MULTIPLE, false),
];

/** A video file exposes its audio track to the media actions. */
const EXTRA_INPUT_KINDS: Partial<Record<AiActionId, readonly AiActionInputKind[]>> = {
  transcribe: ["audio", "video"],
  summarize_media: ["audio", "video"],
  find_moments: ["audio", "video"],
};

const registered = new Map<AiActionId, AiActionSpec>();

for (const entry of DEFAULT_AI_ACTION_SPECS) registered.set(entry.id, entry);

/** Trusted registrations only (17a/17d/UI static tables). */
export function registerAiAction(entry: AiActionSpec): void {
  if (!entry || typeof entry.id !== "string") throw new Error("ai_actions.invalid");
  if (!(AI_ACTION_IDS as readonly string[]).includes(entry.id)) throw new Error("ai_actions.invalid");
  if (registered.has(entry.id) && registered.get(entry.id) !== entry) {
    throw new Error("ai_actions.invalid");
  }
  if (!entry.label_key || !entry.help_slug) throw new Error("ai_actions.invalid");
  if (!Number.isInteger(entry.min_inputs) || !Number.isInteger(entry.max_inputs)) throw new Error("ai_actions.invalid");
  if (entry.min_inputs < 1 || entry.max_inputs < entry.min_inputs || entry.max_inputs > AI_ACTION_MAX_INPUTS) {
    throw new Error("ai_actions.invalid");
  }
  if (!Array.isArray(entry.required_capabilities) || entry.required_capabilities.length > 4) {
    throw new Error("ai_actions.invalid");
  }
  registered.set(entry.id, entry);
}

export function allAiActions(): readonly AiActionSpec[] {
  return [...registered.values()];
}

export function aiActionSpec(id: AiActionId): AiActionSpec {
  const found = registered.get(id);
  if (!found) throw new Error("ai_actions.invalid");
  return found;
}

/** The input kinds one action accepts (audio actions also take video). */
export function inputKindsForAction(id: AiActionId): readonly AiActionInputKind[] {
  const found = registered.get(id);
  if (!found) return [];
  const extra = EXTRA_INPUT_KINDS[id];
  return extra ? extra : [found.input_kind];
}

function contextKinds(context: AiActionContext): string[] {
  return Array.isArray(context.input_kinds) ? context.input_kinds : [];
}

/** Actions matching the current selection shape; disabled ones stay listed. */
export function actionsFor(context: AiActionContext): readonly AiActionSpec[] {
  const kinds = contextKinds(context);
  const count = Number.isInteger(context.input_count) ? context.input_count : 0;
  if (kinds.length === 0 || count < 1) return [];
  const uniqueKinds = new Set(kinds);
  const result: AiActionSpec[] = [];
  for (const entry of registered.values()) {
    if (count < entry.min_inputs || count > entry.max_inputs) continue;
    const accepted = inputKindsForAction(entry.id);
    if (!kinds.every((kind) => accepted.includes(kind as AiActionInputKind))) continue;
    if (entry.id === "summarize_folder" && uniqueKinds.size !== 1) continue;
    result.push(entry);
  }
  return result;
}

/**
 * The 14c task rows use bare task ids (`foreground_mask`) while action specs
 * and the native rows use namespaced ids (`ai.foreground_mask`,
 * `assistant.structured_text`). Both describe the same installed capability;
 * never treat a namespaced id as missing only because the row is bare.
 */
function capabilityMatches(row: AiActionCapability, capability: string): boolean {
  if ("id" in row && row.id === capability) return true;
  if (!("task" in row)) return false;
  if (row.task === capability) return true;
  if (capability.startsWith("ai.") && row.task === capability.slice(3)) return true;
  if (capability.startsWith("assistant.") && row.task === capability.slice("assistant.".length)) {
    return true;
  }
  return false;
}

function capabilityStatus(
  capability: string,
  context: AiActionContext,
): { available: boolean; reason: string | null } | null {
  const rows = Array.isArray(context.capabilities) ? context.capabilities : [];
  for (const row of rows) {
    if (capabilityMatches(row, capability)) {
      return { available: row.available, reason: row.reason ?? null };
    }
  }
  return null;
}

/**
 * Why an action cannot run now, or null when it can. The menu shows this
 * reason and offers App storage for a missing pack; nothing downloads by
 * itself and no action starts because a pack file exists.
 */
export function aiActionDisabledReason(entry: AiActionSpec, context: AiActionContext): string | null {
  if (entry.id === "copy_text") {
    const ocr = capabilityStatus(AI_CAPABILITY_OCR, context);
    return ocr === null || ocr.available ? null : ocr.reason ?? "unsupported";
  }
  for (const capability of entry.required_capabilities) {
    const status = capabilityStatus(capability, context);
    if (status === null) return "unavailable";
    if (!status.available) return status.reason ?? "unavailable";
  }
  return null;
}

/** True only when every required capability is installed and tested. */
export function isAiActionEnabled(entry: AiActionSpec, context: AiActionContext): boolean {
  return aiActionDisabledReason(entry, context) === null;
}

/** Copy text never disappears just because AI is off (D1). */
export function copyTextStaysAvailable(context: AiActionContext): boolean {
  const ocr = capabilityStatus(AI_CAPABILITY_OCR, context);
  return ocr === null || ocr.available;
}

export interface AiActionMenuEntry {
  spec: AiActionSpec;
  disabled_reason: string | null;
  show_storage_link: boolean;
}

/** The exact rows the Explorer context menu and file-tab ribbon show. */
export function aiActionMenuEntries(context: AiActionContext): readonly AiActionMenuEntry[] {
  return actionsFor(context).map((entry) => {
    const disabled_reason = aiActionDisabledReason(entry, context);
    return {
      spec: entry,
      disabled_reason,
      // Any disabled row names App storage as the next step (D1); a missing
      // or untested capability is never a silent dead menu entry.
      show_storage_link: disabled_reason !== null,
    };
  });
}
