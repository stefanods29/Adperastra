import { Transaction, type Extension, type Text } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { DocumentHandle } from "../documents/types";
import type { AssistantBackend } from "../assistant/types";
import {
  INLINE_MAX_AFTER,
  INLINE_MAX_BEFORE,
  type InlineCompletion,
  type InlineCompletionRequest,
  type InlineFileType,
} from "./aiInlineTypes";
import {
  acceptInlineCompletion,
  currentGhost,
  dismissInlineCompletion,
  inlineGhostExtension,
  setInlineGhost,
  showInlineGhost,
} from "./aiInlineGhost";
import { InlineScheduler, type InlineContext } from "./aiInlineScheduler";
import type { JobHandle } from "../services/jobs";

/** One inline-suggestion extension for the existing CodeMirror (T6, E4).
 *
 * There is no second mutable document: the extension reads the shared
 * `DocumentHandle` revision/content id and the existing editor state. It is
 * attached only when the user enabled the matching file type and the selected
 * backend is Local AI; with an API backend a typing pause cannot authorize an
 * upload, so nothing is requested.
 */

export type InlineDocument = Pick<DocumentHandle, "id" | "getState" | "subscribe">;

export interface InlineCompletionOptions {
  document: InlineDocument;
  fileType: InlineFileType;
  language: string;
  enabled: boolean;
  /** Inline suggestions exist only while Local AI is selected (D8). */
  backend?: AssistantBackend;
  /** Test seam; production uses the 17d service. */
  start?: (request: InlineCompletionRequest) => Promise<JobHandle<InlineCompletion>>;
  /** The host renders one short polite announcement per available ghost. */
  onAvailability?: (available: boolean) => void;
}

/** CodeMirror counts positions in UTF-16 code units; the request limit is in
 * Unicode scalars, so the window is trimmed by code points. */
function takeBefore(doc: Text, position: number, max: number): number {
  const start = Math.max(0, position - max * 2);
  const window = doc.sliceString(start, position);
  const scalars = Array.from(window);
  if (scalars.length <= max) return start;
  return position - scalars.slice(scalars.length - max).join("").length;
}

function takeAfter(doc: Text, position: number, max: number): number {
  const end = Math.min(doc.length, position + max * 2);
  const window = doc.sliceString(position, end);
  const scalars = Array.from(window);
  if (scalars.length <= max) return end;
  return position + scalars.slice(0, max).join("").length;
}

export function createInlineCompletionExtension(options: InlineCompletionOptions): Extension {
  if (!options.enabled || options.backend !== "local") {
    // Disabled: no keymap, no listener, no timer. Tab keeps its focus role.
    // An API or unknown backend never receives a typing-pause upload.
    return [];
  }

  class InlinePlugin {
    private readonly view: EditorView;
    private readonly scheduler: InlineScheduler;
    private revision: number;
    private unsubscribe: () => void = () => undefined;
    private readonly onCompositionStart = (): void => {
      this.scheduler.noteCompositionStart();
      dismissInlineCompletion(this.view);
      options.onAvailability?.(false);
    };
    private readonly onCompositionEnd = (): void => {
      this.scheduler.noteCompositionEnd();
    };
    private readonly onBlur = (): void => {
      this.scheduler.noteBlur();
      dismissInlineCompletion(this.view);
      options.onAvailability?.(false);
    };

    constructor(view: EditorView) {
      this.view = view;
      this.revision = options.document.getState().revision;
      this.scheduler = new InlineScheduler({
        // Loaded only when a suggestion is actually requested; a disabled or
        // injected test start never pulls the assistant gateway in.
        start:
          options.start ??
          ((request) =>
            import("../services/aiExtraction").then((module) =>
              module.requestInlineCompletion(request),
            )),
        onAvailable: (completion, context) => {
          const state = options.document.getState();
          if (state.revision !== context.revision || state.content_id !== context.content_id) return;
          showInlineGhost(view, completion, context.cursor_utf16);
          options.onAvailability?.(true);
        },
        onCancelled: () => {
          dismissInlineCompletion(view);
          options.onAvailability?.(false);
        },
      });
      this.unsubscribe = options.document.subscribe((state) => {
        if (state.read_only_reason === "locked") {
          this.scheduler.noteLock();
          dismissInlineCompletion(this.view);
          options.onAvailability?.(false);
        } else if (state.revision !== this.revision) {
          this.revision = state.revision;
        }
      });
      view.dom.addEventListener("compositionstart", this.onCompositionStart);
      view.dom.addEventListener("compositionend", this.onCompositionEnd);
      view.dom.addEventListener("blur", this.onBlur);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged) {
        const events = update.transactions.map((transaction) => transaction.annotation(Transaction.userEvent));
        const loading = events.some((event) => event === "adp.load");
        const accepted = events.some((event) => event === "input.complete");
        if (!loading && !accepted) {
          this.scheduler.noteInsertion(this.context(update.view));
        }
        return;
      }
      if (update.selectionSet) {
        // Showing a ghost moves the caret to the captured cursor in the same
        // transaction; that is not a user cursor move and must not cancel it.
        const showing = update.transactions.some((transaction) =>
          transaction.effects.some((effect) => effect.is(setInlineGhost)),
        );
        if (showing) return;
        this.scheduler.noteCursor(this.context(update.view));
        if (currentGhost(update.view)) {
          dismissInlineCompletion(update.view);
          options.onAvailability?.(false);
        }
      }
    }

    destroy(): void {
      this.scheduler.dispose();
      this.unsubscribe();
      this.view.dom.removeEventListener("compositionstart", this.onCompositionStart);
      this.view.dom.removeEventListener("compositionend", this.onCompositionEnd);
      this.view.dom.removeEventListener("blur", this.onBlur);
    }

    private context(view: EditorView): InlineContext {
      const state = options.document.getState();
      const selection = view.state.selection.main;
      const head = Math.min(selection.head, view.state.doc.length);
      const before = takeBefore(view.state.doc, head, INLINE_MAX_BEFORE);
      const after = takeAfter(view.state.doc, head, INLINE_MAX_AFTER);
      return {
        document_id: options.document.id,
        revision: state.revision,
        content_id: state.content_id,
        cursor_utf16: head,
        before: view.state.doc.sliceString(before, head),
        after: view.state.doc.sliceString(head, after),
        file_type: options.fileType,
        language: options.language,
      };
    }
  }

  return [inlineGhostExtension, ViewPlugin.fromClass(InlinePlugin)];
}

export { acceptInlineCompletion, dismissInlineCompletion, currentGhost };
