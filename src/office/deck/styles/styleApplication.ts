import type { OfficeController } from "../../OfficeController";
import type { OfficeTransactionResult } from "../../types";
import {
  applyDeckStyleNative,
  prepareDeckStyleNative,
} from "../../../services/deckStyles";
import { applyDeckTheme } from "../deckThemes";
import { validateDeckStyle } from "./styleValidation";
import {
  previewCanApply,
  previewExpired,
  validateDeckStylePreview,
} from "./stylePreview";
import {
  DeckStyleError,
  isDeckStyleUuid,
  type DeckStyle,
  type DeckStylePreview,
} from "./styleTypes";

/** E4: preview, then one 22a apply_theme transaction.
 *
 * The preview record is native-authoritative and binds the session, source
 * revision, scope, theme and warnings. The UI can choose Apply, but it cannot
 * forge a warning acknowledgement: native compares the IDs against its own
 * record and refuses overflow. */

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

function validateScope(scopeIds: readonly string[] | null): readonly string[] | null {
  if (scopeIds === null) return null;
  if (scopeIds.length < 1 || scopeIds.length > 1000) throw new DeckStyleError("deck_style.invalid");
  const unique = new Set(scopeIds);
  if (unique.size !== scopeIds.length) throw new DeckStyleError("deck_style.invalid");
  if (scopeIds.some((id) => !isDeckStyleUuid(id))) throw new DeckStyleError("deck_style.invalid");
  return [...scopeIds];
}

function requireEditableDeck(controller: OfficeController, mutates: boolean): void {
  const state = controller.getState();
  if (state.family !== "deck") throw new DeckStyleError("deck_style.unsupported");
  if (state.busy) throw new DeckStyleError("deck_style.changed");
  if (!state.capabilities.includes("deck_themes")) {
    throw new DeckStyleError("deck_style.unsupported");
  }
  if (mutates && state.mode !== "editing") throw new DeckStyleError("deck_style.unsupported");
  if (mutates && !state.ready) throw new DeckStyleError("deck_style.unsupported");
}

export async function prepareDeckStyle(
  controller: OfficeController,
  style: DeckStyle,
  scopeIds: readonly string[] | null,
): Promise<DeckStylePreview> {
  const normalized = validateDeckStyle(style);
  const scope = validateScope(scopeIds);
  requireEditableDeck(controller, false);
  const raw = await prepareDeckStyleNative(controller.session_id, normalized, scope);
  const preview = validateDeckStylePreview(raw);
  // The native record is authoritative, but it must describe the style the
  // caller asked for; a mismatched record is never displayed or applied.
  if (preview.style_id !== normalized.id) throw new DeckStyleError("deck_style.invalid");
  return preview;
}

/** Apply one prepared style. `preview.warnings` are the exact warnings the
 * review panel displayed; native still refuses overflow and unknown IDs. */
export async function applyDeckStyle(
  controller: OfficeController,
  preview: DeckStylePreview,
): Promise<OfficeTransactionResult> {
  const authorized = validateDeckStylePreview(preview);
  requireEditableDeck(controller, true);
  if (previewExpired(authorized, nowUnix())) throw new DeckStyleError("deck_style.changed");
  if (authorized.expected_revision !== controller.getState().revision) {
    throw new DeckStyleError("deck_style.changed");
  }
  if (!previewCanApply(authorized)) throw new DeckStyleError("deck_style.unsupported");

  const confirmed = validateDeckStylePreview(
    await applyDeckStyleNative(
      authorized.id,
      authorized.warnings.map((warning) => warning.id),
    ),
  );
  // Native revalidated revision/content/scope. The engine change itself is the
  // existing 22a transaction: one Undo entry, manual formatting preserved.
  return applyDeckTheme(controller, confirmed.theme, confirmed.slide_ids);
}
