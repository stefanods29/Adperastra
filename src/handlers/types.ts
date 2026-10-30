import type { LucideIcon } from "lucide-react";
import type { ComponentType, LazyExoticComponent } from "react";
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
  view: LazyExoticComponent<ComponentType<HandlerViewProps>>;
}
