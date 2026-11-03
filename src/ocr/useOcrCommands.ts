import { Copy, Search } from "lucide-react";
import { useMemo } from "react";
import type { Command } from "../commands/registry";

/** OCR ribbon commands (Step 07e D7/T5).
 *
 * IDs are fixed by the guide: `image.copyAllText` / `image.searchText` and
 * `pdf.copyAllText` / `pdf.searchImageText`. Both reuse the viewer ribbon;
 * there is no global shortcut beyond the existing Find routing.
 */
export type OcrCommandKind = "image" | "pdf";

export interface OcrCommandContext {
  /** A result exists or can be started, and a sensitive PDF allows copy. */
  canCopy: boolean;
  canSearch: boolean;
}

export interface OcrCommandActions {
  /** Explicit user action: recognise if needed, then write once. */
  copyAll: () => Promise<void>;
  /** Focus the viewer's find row / start its search. */
  search: () => void;
}

const HELP_SLUG = "copying-text-from-images";

export function createOcrCommands(
  kind: OcrCommandKind,
  actions: OcrCommandActions,
): Command<OcrCommandContext>[] {
  const copyId = kind === "image" ? "image.copyAllText" : "pdf.copyAllText";
  const searchId = kind === "image" ? "image.searchText" : "pdf.searchImageText";
  return [
    {
      id: copyId,
      labelKey: "ocr.copyAll",
      icon: Copy,
      risk: "read-only",
      helpSlug: HELP_SLUG,
      enabledWhen: (context) => context.canCopy,
      run: () => {
        void actions.copyAll().catch(() => undefined);
      },
    },
    {
      id: searchId,
      labelKey: "ocr.search",
      icon: Search,
      risk: "read-only",
      helpSlug: HELP_SLUG,
      enabledWhen: (context) => context.canSearch,
      run: () => {
        actions.search();
      },
    },
  ];
}

/** Memoised commands for a viewer's ribbon. */
export function useOcrCommands(
  kind: OcrCommandKind,
  actions: OcrCommandActions,
): Command<OcrCommandContext>[] {
  return useMemo(
    () => createOcrCommands(kind, actions),
    [kind, actions.copyAll, actions.search],
  );
}
