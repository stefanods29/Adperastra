import { FileText, ReceiptText, Sparkles, Table } from "lucide-react";
import type { Command } from "./registry";

/** The four extraction/inline commands (Step 17d T8).
 *
 * The first three only open a read-only review: they never export by
 * themselves. `text.inlineSuggestions` changes a setting. No command takes a
 * global shortcut; they appear in the ordinary bars and menus.
 */

export interface ExtractionCommandContext {
  /** Selected files in the current folder. */
  selected_files: number;
  /** The extraction has been asked for and is preparing. */
  busy: boolean;
  /** The saved inline setting. */
  inline_enabled: boolean;
  /** Local AI is selected and its pack is ready. */
  inline_available: boolean;
}

export interface ExtractionActions {
  scanToDocument: () => void;
  tablesToSheet: () => void;
  receiptsToSheet: () => void;
  toggleInlineSuggestions: () => void;
}

const MIN_INPUTS = 1;
const MAX_INPUTS = 100;

function canExtract(context: ExtractionCommandContext): boolean {
  return (
    !context.busy &&
    context.selected_files >= MIN_INPUTS &&
    context.selected_files <= MAX_INPUTS
  );
}

export function createExtractionCommands(
  actions: ExtractionActions,
): Command<ExtractionCommandContext>[] {
  return [
    {
      id: "file.scanToDocument",
      labelKey: "aiExtract.document",
      icon: FileText,
      risk: "read-only",
      helpSlug: "turning-scans-into-documents",
      enabledWhen: canExtract,
      run: () => actions.scanToDocument(),
    },
    {
      id: "file.tablesToSheet",
      labelKey: "aiExtract.tables",
      icon: Table,
      risk: "read-only",
      helpSlug: "extracting-tables",
      enabledWhen: canExtract,
      run: () => actions.tablesToSheet(),
    },
    {
      id: "file.receiptsToSheet",
      labelKey: "aiExtract.receipts",
      icon: ReceiptText,
      risk: "read-only",
      helpSlug: "extracting-receipts-and-invoices",
      enabledWhen: canExtract,
      run: () => actions.receiptsToSheet(),
    },
    {
      id: "text.inlineSuggestions",
      labelKey: "aiInline.title",
      icon: Sparkles,
      risk: "change",
      helpSlug: "inline-writing-suggestions",
      checkKind: "toggle",
      checkedWhen: (context) => context.inline_enabled,
      enabledWhen: (context) => !context.busy,
      run: () => actions.toggleInlineSuggestions(),
    },
  ];
}

/** The exact help slugs these commands open (T8 help test). */
export const EXTRACTION_HELP_SLUGS = [
  "turning-scans-into-documents",
  "extracting-tables",
  "extracting-receipts-and-invoices",
  "inline-writing-suggestions",
] as const;
