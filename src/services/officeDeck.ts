import { invoke } from "@tauri-apps/api/core";
import type { ConversionInput } from "../convert/types";
import type {
  DeckTemplateInspection,
  DeckTheme,
  OfficeFontMapping,
} from "../office/types";
import { runJob, type JobHandle } from "./jobs";
import { isTauriRuntime } from "./settings";

/** Template inspection and theme import (20a E15).
 *
 * The approved binding does all parsing. This wrapper never opens a remote
 * URL, executes template content or builds a theme from guessed bytes.
 * Wire values are the canonical 20a types, not a private copy. */

export type { DeckTemplateInspection, OfficeFontMapping };

function requireRuntime(): void {
  if (!isTauriRuntime()) throw new Error("office_edit.engine_missing");
}

export async function inspectDeckTemplate(
  input: ConversionInput,
): Promise<JobHandle<DeckTemplateInspection>> {
  requireRuntime();
  return runJob("decktemplate", async (requestId) => {
    await invoke("office_deck_template_inspect_start", { requestId, input });
  });
}

export async function importDeckTheme(
  inspectionId: string,
  themeId: string,
  name: string,
  fontMappings: readonly OfficeFontMapping[],
): Promise<DeckTheme> {
  requireRuntime();
  return invoke("office_deck_template_import", {
    inspectionId, themeId, name, fontMappings,
  });
}
