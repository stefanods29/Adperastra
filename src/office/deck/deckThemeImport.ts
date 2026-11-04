import type { ConversionInput } from "../../convert/types";
import type { JobHandle } from "../../services/jobs";
import {
  importDeckTheme as importOfficeDeckTheme,
  inspectDeckTemplate as inspectOfficeDeckTemplate,
  type DeckTemplateInspection,
  type OfficeFontMapping,
} from "../../services/officeDeck";
import type { DeckTheme } from "../types";
import { validateDeckTheme } from "./deckThemes";

/** Template inspection and theme import (Step 22a T5 E7).
 *
 * The approved binding does the parsing; this wrapper only bounds the
 * answer and refuses a template source that is not a local Office template
 * file. There is no remote URL, custom code, macro execution or external
 * media fetch on this path. All inspection/font-mapping types are imported
 * from the 20a service, never copied here. */

const MAX_THEMES = 32;
const MAX_WARNINGS = 32;
const TEMPLATE_EXTENSIONS = new Set(["pptx", "potx", "odp", "otp"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Only a local path with a known template extension is accepted. A remote
 * URL or a double extension is refused before any helper work. */
export function isDeckTemplateInput(input: ConversionInput): boolean {
  if (input.kind === "file") {
    if (!/^[A-Za-z]:[\\/]|^\\\\/.test(input.path)) return false;
    if (input.path.includes("\0") || input.path.split(/[\\/]/).some((part) => part === "..")) return false;
    const name = input.path.split(/[\\/]/).filter(Boolean).pop() ?? "";
    const dot = name.lastIndexOf(".");
    if (dot <= 0) return false;
    const ext = name.slice(dot + 1).toLowerCase();
    if (!TEMPLATE_EXTENSIONS.has(ext)) return false;
    const previous = name.slice(0, dot);
    return !previous.includes(".");
  }
  if (input.kind === "snapshot") {
    return UUID.test(input.snapshot_id) && typeof input.document_id === "string" &&
      input.document_id.length > 0 && input.document_id.length <= 128 &&
      Number.isSafeInteger(input.revision) && input.revision >= 0;
  }
  return false;
}

function validInspection(value: unknown): value is DeckTemplateInspection {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Partial<DeckTemplateInspection>;
  return typeof item.inspection_id === "string" && UUID.test(item.inspection_id) &&
    Array.isArray(item.themes) && item.themes.length <= MAX_THEMES && item.themes.every(validateDeckTheme) &&
    Array.isArray(item.warnings) && item.warnings.length <= MAX_WARNINGS &&
    item.warnings.every((warning) => typeof warning === "string" && warning.length <= 512) &&
    typeof item.source_revision === "number" && Number.isSafeInteger(item.source_revision) &&
    typeof item.expires_unix === "number" && Number.isSafeInteger(item.expires_unix);
}

/** Inspect a template without changing a document. The returned job keeps
 * the real cancellation handle; only the completion value is bounded. */
export async function inspectDeckTemplate(input: ConversionInput): Promise<JobHandle<DeckTemplateInspection>> {
  if (!isDeckTemplateInput(input)) throw new Error("deck.invalid_template");
  const job = await inspectOfficeDeckTemplate(input);
  const completion = job.completion.then((inspection) => {
    if (!validInspection(inspection)) throw new Error("deck.invalid_template");
    return inspection;
  });
  return { id: job.id, cancel: job.cancel, completion };
}

/** Import exactly one theme from an unexpired inspection. */
export async function importDeckTheme(
  inspectionId: string,
  themeId: string,
  name: string,
  fontMappings: readonly OfficeFontMapping[],
): Promise<DeckTheme> {
  if (!UUID.test(inspectionId) || !UUID.test(themeId)) throw new Error("deck.invalid_template");
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 60) throw new Error("deck.invalid_name");
  if (fontMappings.length > 128) throw new Error("deck.invalid_template");
  const theme = await importOfficeDeckTheme(inspectionId, themeId, trimmed, fontMappings);
  if (!validateDeckTheme(theme)) throw new Error("deck.invalid_theme");
  return theme;
}
