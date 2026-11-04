import { invoke } from "@tauri-apps/api/core";
import type { ConversionInput } from "../convert/types";
import {
  validateDeckStyle,
  validateDeckStyleCatalog,
} from "../office/deck/styles/styleValidation";
import {
  DeckStyleError,
  type DeckStyle,
  type DeckStyleCatalog,
} from "../office/deck/styles/styleTypes";
import { runJob, type JobHandle } from "./jobs";

/** E2: the only UI entry to the user-style catalog and the native style
 * preview/exchange jobs. Every response is re-validated; a built-in can never
 * be saved or removed. Components and style helpers never call `invoke`. */

export async function listDeckStyles(): Promise<DeckStyleCatalog> {
  return validateDeckStyleCatalog(await invoke<unknown>("deck_styles_list"));
}

export async function saveDeckStyle(
  style: DeckStyle,
  expectedRevision: number,
): Promise<DeckStyleCatalog> {
  const normalized = validateDeckStyle(style);
  if (normalized.builtin) throw new DeckStyleError("deck_style.invalid");
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new DeckStyleError("deck_style.invalid");
  }
  const catalog = await invoke<unknown>("deck_styles_save", {
    style: normalized,
    expectedRevision,
  });
  return validateDeckStyleCatalog(catalog);
}

export async function removeDeckStyle(
  id: string,
  expectedRevision: number,
): Promise<DeckStyleCatalog> {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
    throw new DeckStyleError("deck_style.invalid");
  }
  const catalog = await invoke<unknown>("deck_styles_remove", {
    id,
    expectedRevision,
  });
  return validateDeckStyleCatalog(catalog);
}

/** User styles only. Built-ins come from `BUILTIN_DECK_STYLES`. */
export function userDeckStyles(catalog: DeckStyleCatalog): readonly DeckStyle[] {
  return catalog.styles.filter((style) => !style.builtin);
}

/** E4 native prepare. The returned record is validated by the style service;
 * no warnings or revisions are accepted from the UI. */
export async function prepareDeckStyleNative(
  sessionId: string,
  style: DeckStyle,
  slideIds: readonly string[] | null,
): Promise<unknown> {
  return invoke<unknown>("deck_style_prepare", {
    request: {
      session_id: sessionId,
      style,
      slide_ids: slideIds === null ? null : [...slideIds],
    },
  });
}

/** E4 native apply authorization. Overflow remains native-blocked. */
export async function applyDeckStyleNative(
  previewId: string,
  acknowledgedWarningIds: readonly string[],
): Promise<unknown> {
  return invoke<unknown>("deck_style_apply", {
    previewId,
    acknowledgedWarningIds: [...acknowledgedWarningIds],
  });
}

/** E5 `.adp-deck-style` import through the existing bounded job API. */
export async function importDeckStyleFile(input: ConversionInput): Promise<JobHandle<unknown>> {
  return runJob<unknown>("deckstyle", (requestId) =>
    invoke<void>("deck_style_file_import_start", { requestId, input }),
  );
}

/** E5 new-file style export. The destination is chosen by the caller and is
 * never replaced by this service. */
export async function exportDeckStyleFile(
  styleId: string,
  destPath: string,
): Promise<JobHandle<unknown>> {
  return runJob<unknown>("deckstyle", (requestId) =>
    invoke<void>("deck_style_file_export_start", { requestId, styleId, destPath }),
  );
}
