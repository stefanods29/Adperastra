import { Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap } from "@codemirror/view";
import type { InlineCompletion } from "./aiInlineTypes";

/** The visible ghost (Step 17d T6, decision D9).
 *
 * One decoration at the captured cursor, aria-hidden, never a second edit
 * model. Tab inserts the text as one atomic transaction (one Undo entry);
 * Escape clears the decoration without a document change. When no current
 * ghost exists both keys return false, so the editor keeps its ordinary Tab
 * focus behavior.
 */

export interface InlineGhost {
  from: number;
  text: string;
  generation: number;
  revision: number;
  content_id: string;
  cursor_utf16: number;
}

export const setInlineGhost = StateEffect.define<InlineGhost | null>();

export const inlineGhostField = StateField.define<InlineGhost | null>({
  create: () => null,
  update(value, transaction) {
    let next = value;
    for (const effect of transaction.effects) {
      if (effect.is(setInlineGhost)) next = effect.value;
    }
    // Any edit invalidates a suggestion immediately.
    if (transaction.docChanged) return null;
    return next;
  },
});

class InlineGhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: InlineGhostWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "adp-inline-ghost";
    span.setAttribute("aria-hidden", "true");
    span.textContent = this.text;
    return span;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

const ghostDecorations = EditorView.decorations.compute([inlineGhostField], (state) => {
  const ghost = state.field(inlineGhostField);
  if (!ghost) return Decoration.none;
  return Decoration.set([
    Decoration.widget({ widget: new InlineGhostWidget(ghost.text), side: 1 }).range(ghost.from),
  ]);
});

export function currentGhost(view: EditorView): InlineGhost | null {
  return view.state.field(inlineGhostField, false) ?? null;
}

/** Show exactly one ghost for a validated completion at the captured cursor. */
export function showInlineGhost(
  view: EditorView,
  completion: InlineCompletion,
  from: number,
): void {
  const position = Math.max(0, Math.min(from, view.state.doc.length));
  view.dispatch({
    // The completion belongs at the captured cursor; accepting it stays one
    // Tab away and never moves text to a different position.
    selection: { anchor: position },
    effects: setInlineGhost.of({
      from: position,
      text: completion.text,
      generation: completion.generation,
      revision: completion.revision,
      content_id: completion.content_id,
      cursor_utf16: completion.cursor_utf16,
    }),
  });
}

/** Dismiss the ghost only; the document and its revision do not change. */
export function dismissInlineCompletion(view: EditorView): boolean {
  if (!currentGhost(view)) return false;
  view.dispatch({ effects: setInlineGhost.of(null) });
  return true;
}

/** Accept the current ghost at the exact cursor it was captured for. */
export function acceptInlineCompletion(view: EditorView): boolean {
  const ghost = currentGhost(view);
  if (!ghost || ghost.text === "") return false;
  const selection = view.state.selection.main;
  if (!selection.empty || selection.head !== ghost.from) return false;
  if (view.state.doc.length < ghost.from) return false;
  view.dispatch({
    changes: { from: ghost.from, insert: ghost.text },
    selection: { anchor: ghost.from + ghost.text.length },
    effects: setInlineGhost.of(null),
    userEvent: "input.complete",
    scrollIntoView: true,
  });
  return true;
}

/** Tab accepts a current ghost; Escape dismisses it. Both fall through when
 * no ghost exists (ordinary focus behavior stays untouched). */
export const inlineKeymap: Extension = Prec.highest(
  keymap.of([
    { key: "Tab", run: acceptInlineCompletion },
    { key: "Escape", run: dismissInlineCompletion },
  ]),
);

export const inlineGhostExtension: Extension = [inlineGhostField, ghostDecorations, inlineKeymap];
