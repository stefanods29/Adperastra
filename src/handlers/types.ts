import type { LucideIcon } from "lucide-react";
import type { ComponentType, LazyExoticComponent } from "react";
import type { ArchiveExtractRequest } from "../services/archive";
import type { FileTypeInfo } from "../services/files";

/** File-type handlers (contract 13, Step 04a). A handler shows one kind of
 * file inside a file tab. Later steps add a ribbon (04b), an editor (06a)
 * and more fields; existing fields never change meaning. */

/** Suffix of the accent token: `var(--adp-accent-<accent>)`. */
export type HandlerAccent = "explorer" | "word" | "excel" | "pdf" | "image" | "powerpoint";

/** What a file tab's status bar shows (texts are already translated). */
export interface FileTabStatus {
  items: string[];
  zoom?: {
    percent: number;
    min: number;
    max: number;
    set: (percent: number) => void;
    fit: () => void;
  };
}

/** A file tab's save handle (Step 06a): save the unsaved changes, or drop
 * them and their recovery copy. */
export interface SaveHandle {
  /** True when the file was saved. */
  save: () => Promise<boolean>;
  /** Forget the unsaved changes and their recovery copy. */
  discard: () => void;
}

/** The file tab's search box (Step 04b): the text to find, and a counter
 * that grows each time the user asks for the next (or previous) match. */
export interface FindRequest {
  text: string;
  request: number;
  backwards: boolean;
  /** Match case and whole word (Step 06a). */
  options?: { caseSensitive: boolean; wholeWord: boolean };
  /** A replace request: a new `request` number asks for one replacement,
   * or all of them when `all` (Step 06a). */
  replace?: { text: string; request: number; all: boolean };
}

export interface HandlerViewProps {
  info: FileTypeInfo;
  /** Where the file's bytes are served (`fileUrl(token, name)`). */
  url: string;
  /** True while this tab is the visible one; views pause work when false. */
  active: boolean;
  /** State the view saved earlier (zoom, scroll position), or null. */
  savedState: unknown;
  /** Save small view state; it comes back as `savedState` (contract 13 tab_state). */
  onStateChange: (state: unknown) => void;
  onStatus: (status: FileTabStatus) => void;
  /** Open this file in its Windows default app (used by error states). */
  onOpenInWindowsApp: () => void;
  /** What the search box asks for; views with `supportsFind` follow it. */
  find: FindRequest;
  /** The file came from the internet and protected view is on (Step 04c):
   * views keep links off (and, from Step 06a, start without editing). */
  protectedView: boolean;
  /** The view's unsaved changes changed (Step 06a). */
  onDirtyChange?: (dirty: boolean) => void;
  /** The view hands over how to save or drop its changes (Step 06a). */
  registerSave?: (handle: SaveHandle | null) => void;
  /** The file was saved under a new name (Step 06a). */
  onPathChange?: (path: string) => void;
  /** Open another file in a new tab; the archive tab opens a file that lives
   * inside it this way (Step 06d). Rejects with a `files.*` code. */
  onOpenFile?: (path: string) => Promise<void>;
  /** Extract through the Explorer's jobs panel (Step 06d). */
  onExtractArchive?: (request: ArchiveExtractRequest) => void;
}

export interface Handler {
  id: string;
  /** Bump when what the handler shows changes (cache keys from Step 07a). */
  version: number;
  /** Translation key of the type name, for example "handlers.image". */
  labelKey: string;
  icon: LucideIcon;
  accent: HandlerAccent;
  /** Lower-case extensions without the dot. */
  extensions: readonly string[];
  /** Content types recognized from the file's first bytes. A content match
   * wins over an extension match. */
  mimeTypes: readonly string[];
  /** Larger files open in the Windows default app instead. */
  maxBytes: number;
  helpSlug: string;
  speedTier: "fast" | "waiting";
  /** True when the view can search its content: the file tab shows its
   * search box and Ctrl+F focuses it. */
  supportsFind: boolean;
  /** The view can edit and save its file (Step 06a). */
  editable?: boolean;
  /** The view follows replace requests from the search row (Step 06a). */
  supportsReplace?: boolean;
  view: LazyExoticComponent<ComponentType<HandlerViewProps>>;
}
