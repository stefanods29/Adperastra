import { invoke } from "@tauri-apps/api/core";
import { DocumentRegistry } from "../documents/DocumentRegistry";
import type { DocumentHandle } from "../documents/types";
import { acquireOfficeController, type OfficeController } from "../office/OfficeController";
import type { DeckTheme, OfficeDraftSourceRef, OfficeFamily } from "../office/types";
import type { AiInputRef } from "./localAiTypes";
import { runJob, type JobHandle } from "./jobs";
import { isTauriRuntime } from "./settings";

/** Ordinary blank and deck drafts (20a E23/E25).
 *
 * Native creates the immutable draft backing and registers the draft
 * document authority; this wrapper only acquires the returned live source
 * and its controller. No path, byte buffer, sensitivity flag or snapshot
 * token is supplied by the UI. A missing draft provider or engine fails
 * closed instead of fabricating an empty file.
 *
 * Source references are rebuilt from their exact canonical shape before
 * `invoke`: only native-issued context/input IDs survive, at most32 of them,
 * and a caller cannot attach bytes, a path or a trust flag. `saved` state is
 * never invented here; discarding a draft uses the controller's atomic
 * `discardToSaved` and verifies the live identity afterwards. */

export interface OfficeDraftHandle {
  document: DocumentHandle;
  controller: OfficeController;
  initial_slide_id: string;
}

export interface OfficeBlankDraftHandle {
  document: DocumentHandle;
  controller: OfficeController;
}

interface NativeDraftResult {
  draft_id: string;
  document_id: string;
  initial_slide_id?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_SOURCE_REFERENCES = 32;
const INPUT_KINDS = ["document", "snapshot", "artifact"] as const;
const FONT_SOURCES = ["bundled", "installed", "document"] as const;
const LAYOUT_KINDS = [
  "title", "title_body", "two_column", "section", "image_caption", "chart", "quote", "blank",
] as const;

function invalid(): never {
  throw new Error("office_edit.invalid");
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function safeRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function nonEmpty(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= max;
}

function finitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 10_000;
}

function requireRuntime(): void {
  if (!isTauriRuntime()) throw new Error("office_edit.engine_missing");
}

function validDraft(value: NativeDraftResult): boolean {
  return Boolean(value && typeof value.draft_id === "string" && UUID.test(value.draft_id) &&
    typeof value.document_id === "string" && UUID.test(value.document_id));
}

function channel(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 255;
}

function color(value: unknown): boolean {
  return exact(value, ["r", "g", "b", "a"]) &&
    channel(value.r) && channel(value.g) && channel(value.b) && channel(value.a);
}

function font(value: unknown): boolean {
  return exact(value, ["family", "source", "embeddable"]) &&
    nonEmpty(value.family, 256) &&
    FONT_SOURCES.includes(value.source as typeof FONT_SOURCES[number]) &&
    typeof value.embeddable === "boolean";
}

function layout(value: unknown): boolean {
  if (!record(value) || !uuid(value.id) || !nonEmpty(value.name, 256) ||
      !LAYOUT_KINDS.includes(value.kind as typeof LAYOUT_KINDS[number])) return false;
  const placeholders = value.placeholders;
  if (!Array.isArray(placeholders) || placeholders.length > 64) return false;
  return placeholders.every((placeholder) =>
    exact(placeholder, ["id", "role", "rect", "text", "paragraph"]) && uuid(placeholder.id));
}

/** Rebuild the exact theme record the native creator accepts. Extra caller
 * fields are dropped instead of being forwarded. */
function sanitizeTheme(value: unknown): DeckTheme {
  if (!exact(value, [
    "id", "name", "slide_width_pt", "slide_height_pt", "colors", "heading_font",
    "body_font", "layouts", "default_layout_id", "density", "version",
  ])) invalid();
  const colors = value.colors;
  const headingFont = value.heading_font;
  const bodyFont = value.body_font;
  const layouts = value.layouts;
  if (!nonEmpty(value.id, 128) || !nonEmpty(value.name, 256) ||
      !finitePositive(value.slide_width_pt) || !finitePositive(value.slide_height_pt) ||
      !record(colors) ||
      !exact(colors, ["background", "text", "muted", "accent", "accent2", "surface"]) ||
      Object.values(colors).some((entry) => !color(entry)) ||
      !font(headingFont) || !font(bodyFont) ||
      !Array.isArray(layouts) || layouts.length < 1 || !layouts.every(layout) ||
      !uuid(value.default_layout_id) ||
      !layouts.some((entry) => (entry as Record<string, unknown>).id === value.default_layout_id) ||
      (value.density !== "comfortable" && value.density !== "compact") || value.version !== 1) {
    invalid();
  }
  return {
    id: value.id,
    name: value.name,
    slide_width_pt: value.slide_width_pt,
    slide_height_pt: value.slide_height_pt,
    colors: {
      background: structuredClone(colors.background),
      text: structuredClone(colors.text),
      muted: structuredClone(colors.muted),
      accent: structuredClone(colors.accent),
      accent2: structuredClone(colors.accent2),
      surface: structuredClone(colors.surface),
    },
    heading_font: structuredClone(headingFont),
    body_font: structuredClone(bodyFont),
    layouts: (layouts as Record<string, unknown>[]).map((entry) => ({
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      placeholders: (entry.placeholders as Record<string, unknown>[]).map((placeholder) => ({
        id: placeholder.id,
        role: placeholder.role,
        rect: structuredClone(placeholder.rect),
        text: structuredClone(placeholder.text),
        paragraph: structuredClone(placeholder.paragraph),
      })),
    })) as unknown as DeckTheme["layouts"],
    default_layout_id: value.default_layout_id,
    density: value.density,
    version: 1,
  } as unknown as DeckTheme;
}

function inputRef(value: unknown): value is AiInputRef {
  return exact(value, ["kind", "id", "expected_revision"]) &&
    INPUT_KINDS.includes(value.kind as typeof INPUT_KINDS[number]) &&
    uuid(value.id) && safeRevision(value.expected_revision);
}

/** Exact native-issued source scope. Anything else, including extra fields,
 * is refused instead of being treated as authorized content. */
export function validateOfficeDraftSourceRefs(
  value: unknown,
): OfficeDraftSourceRef[] {
  if (!Array.isArray(value) || value.length > MAX_SOURCE_REFERENCES) {
    throw new Error("office_edit.too_large");
  }
  return value.map((reference): OfficeDraftSourceRef => {
    if (record(reference) && reference.kind === "office_context") {
      if (!exact(reference, ["kind", "context_id"])) invalid();
      const contextId = reference.context_id;
      if (!uuid(contextId)) invalid();
      return { kind: "office_context", context_id: contextId };
    }
    if (record(reference) && reference.kind === "ai_input") {
      if (!exact(reference, ["kind", "input"])) invalid();
      const input = reference.input;
      if (!inputRef(input)) invalid();
      return {
        kind: "ai_input",
        input: {
          kind: input.kind,
          id: input.id,
          expected_revision: input.expected_revision,
        },
      };
    }
    return invalid();
  });
}

async function acquireDraft(
  result: NativeDraftResult,
  family: OfficeFamily,
): Promise<{ document: DocumentHandle; controller: OfficeController }> {
  if (!validDraft(result)) throw new Error("office_edit.invalid");
  const document = await DocumentRegistry.acquire({ kind: "draft", draft_id: result.draft_id });
  if (document.id !== result.document_id) {
    document.release();
    throw new Error("office_edit.invalid");
  }
  try {
    const controller = await acquireOfficeController(document, family);
    return { document, controller };
  } catch (error) {
    // Release the caller reference; the last release runs the normal native
    // draft disposal. A user-edited draft is never discarded by job cleanup.
    document.release();
    throw error;
  }
}

export async function createOfficeDraft(
  family: "deck",
  theme: DeckTheme,
  sourceReferences: readonly OfficeDraftSourceRef[],
): Promise<JobHandle<OfficeDraftHandle>> {
  requireRuntime();
  if (family !== "deck") invalid();
  const boundedTheme = sanitizeTheme(theme);
  const boundedSources = validateOfficeDraftSourceRefs(sourceReferences);
  const job = await runJob<NativeDraftResult>("officedraft", async (requestId) => {
    await invoke("office_draft_create_start", {
      requestId, family, theme: boundedTheme, sourceReferences: boundedSources,
    });
  });
  return {
    id: job.id,
    cancel: job.cancel,
    completion: job.completion.then(async (result) => {
      const acquired = await acquireDraft(result, family);
      if (typeof result.initial_slide_id !== "string" || !UUID.test(result.initial_slide_id)) {
        try {
          await acquired.controller.close();
        } finally {
          acquired.document.release();
        }
        throw new Error("office_edit.invalid");
      }
      return { ...acquired, initial_slide_id: result.initial_slide_id };
    }),
  };
}

export async function createOfficeBlankDraft(
  family: "document" | "sheet",
): Promise<JobHandle<OfficeBlankDraftHandle>> {
  requireRuntime();
  if (family !== "document" && family !== "sheet") invalid();
  const job = await runJob<NativeDraftResult>("officeblank", async (requestId) => {
    await invoke("office_blank_draft_create_start", { requestId, family });
  });
  return {
    id: job.id,
    cancel: job.cancel,
    completion: job.completion.then((result) => acquireDraft(result, family)),
  };
}

/** Restore the engine's saved content for a draft through the controller's
 * atomic discard. The live saved identity must be native-issued, and the
 * post-state is verified: this never marks a dirty draft saved. */
export async function discardOfficeDraftToSaved(controller: OfficeController): Promise<void> {
  const state = controller.getState();
  if (!state || state.session_id !== controller.session_id || !uuid(state.saved_content_id) ||
      !uuid(state.content_id)) {
    invalid();
  }
  await controller.discardToSaved(state.saved_content_id);
  const after = controller.getState();
  if (after.dirty || after.content_id !== state.saved_content_id ||
      after.saved_content_id !== state.saved_content_id ||
      after.revision !== state.revision || after.session_id !== state.session_id) {
    throw new Error("office_edit.changed");
  }
}
