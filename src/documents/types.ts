import type { ComponentType } from "react";
import type { FileTabStatus, FindRequest } from "../handlers/types";
import type { SourceStamp } from "../services/cache";
import type { ExportSnapshot } from "../services/exportSnapshots";

/** Shared document contracts (Step 09a, tabs-documents-1). One canonical
 * definition for every later editor, split, group and locked-folder step.
 * A document is identified by its source, never by a tab id: several views
 * (tabs) can share one document while keeping their own view state. */

/** Where a document's bytes come from. `disk` is a real file the user asked
 * to open; `virtual` lives inside a locked container (Step 09k registers the
 * only provider; until then no virtual source is advertised); `draft` is a
 * native-created unsaved document (reserved until Step 20a). */
export type DocumentRef =
  | { kind: "disk"; path: string }
  | { kind: "virtual"; provider: "locked"; container_path: string; entry_id: string }
  | { kind: "draft"; draft_id: string };

export type DocumentProviderId = "disk" | "locked" | "draft";

/** Facts about a document that do not change while it is open.
 * `disk_path` is present only for `disk` sources; virtual and draft sources
 * never fabricate an OS path. */
export interface DocumentInfo {
  document_id: string;
  source: DocumentRef;
  name: string;
  ext: string;
  mime: string;
  size: number;
  modified_unix: number;
  read_only: boolean;
  from_internet: boolean;
  sensitive: boolean;
  disk_path?: string;
}

export type DocumentReadOnlyReason = "protected" | "permissions" | "unsupported" | "locked";

/** Live state of the shared editable model. `dirty` is derived from the
 * content identities, so Undo back to the saved content makes it false
 * again even though `revision` keeps growing. */
export interface DocumentState {
  revision: number;
  saved_revision: number;
  content_id: string;
  saved_content_id: string;
  dirty: boolean;
  ready: boolean;
  editing_enabled: boolean;
  can_save_existing: boolean;
  can_save_copy: boolean;
  status_code?: string;
  read_only_reason?: DocumentReadOnlyReason;
}

/** One view's handle on a shared document. Views come and go; the document
 * (and its unsaved changes) lives until the last view releases it. */
export interface DocumentHandle {
  readonly id: string;
  readonly source: DocumentRef;
  readonly info: DocumentInfo;
  /** Exact native stamp captured at open for `disk` sources. The
   * whole-second `info` cannot detect a sub-second change. Absent for
   * virtual/draft documents and for handles not opened by the registry. */
  readonly sourceStamp?: SourceStamp;
  getState(): DocumentState;
  subscribe(listener: (state: DocumentState) => void): () => void;
  /** Original authorized source bytes, never unsaved edits. At most 4 MiB. */
  readRange(offset: number, length: number): Promise<Uint8Array>;
  /** Immutable snapshot of the current revision (Step 08a). */
  captureSnapshot(): Promise<ExportSnapshot>;
  save(): Promise<boolean>;
  saveCopy(destPath: string): Promise<boolean>;
  discard(): Promise<void>;
  release(): void;
}

/** A trusted, statically registered source provider. A JavaScript provider
 * can never authorize a filesystem path by itself; native code grants disk
 * sources. */
export interface DocumentProvider {
  readonly id: DocumentProviderId;
  supports(ref: DocumentRef): boolean;
  open(ref: DocumentRef): Promise<DocumentHandle>;
}

/** JSON-only view state (Step 09a D6 caps are enforced by
 * `services/viewState.ts` before anything is stored). */
export type SerializableViewState =
  | null
  | boolean
  | number
  | string
  | SerializableViewState[]
  | { [key: string]: SerializableViewState };

/** Props of a view for a virtual (locked-container) document. There is no
 * `FileTypeInfo` and no path: virtual ids must never be passed to
 * filesystem commands. `onOpenInWindowsApp` is present only when the host
 * offers an explicit external open for this disk document (Step 13 fallback
 * "Open in my chosen app", for example LibreOffice as the Windows default);
 * it is absent for virtual/sensitive/draft sources that must stay
 * memory-only. */
export interface VirtualViewProps {
  document: DocumentHandle;
  active: boolean;
  savedState: SerializableViewState | null;
  onStateChange: (state: SerializableViewState) => void;
  onStatus: (status: FileTabStatus) => void;
  find: FindRequest;
  previewOnly: boolean;
  onOpenHelp: (slug: string) => void;
  onOpenInWindowsApp?: () => void;
}

export type VirtualViewComponent = ComponentType<VirtualViewProps>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Windows absolute path: a drive path (`C:\...`, `C:/...`) or a UNC path,
 * at most 32,768 UTF-16 units, without `..` segments. */
export function isAbsolutePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 32768) return false;
  if (value.includes("\0")) return false;
  const drive = /^[A-Za-z]:[\\/]/.test(value);
  const unc = value.startsWith("\\\\");
  if (!drive && !unc) return false;
  return !value.split(/[\\/]/).some((part) => part === "..");
}

/** Validate one source reference. Unknown virtual providers are refused:
 * only `locked` exists, and only once Step 09k registers it. */
export function validateDocumentRef(ref: unknown): DocumentRef | null {
  if (ref === null || typeof ref !== "object") return null;
  const value = ref as Record<string, unknown>;
  if (value.kind === "disk") {
    return isAbsolutePath(value.path) ? { kind: "disk", path: value.path } : null;
  }
  if (value.kind === "virtual") {
    if (value.provider !== "locked") return null;
    if (!isAbsolutePath(value.container_path) || !isUuid(value.entry_id)) return null;
    return { kind: "virtual", provider: "locked", container_path: value.container_path, entry_id: value.entry_id };
  }
  if (value.kind === "draft") {
    return isUuid(value.draft_id) ? { kind: "draft", draft_id: value.draft_id } : null;
  }
  return null;
}

function plainPath(path: string): string {
  return path.replace(/^\\\\\?\\/, "").replace(/\//g, "\\").toLowerCase();
}

/** The registry key of a source: one document per normalized source.
 * Path comparison is case-insensitive and ignores the `\\?\` prefix, like
 * every other path comparison in the app (plan/pitfalls.md P-11). */
export function documentSourceKey(ref: DocumentRef): string {
  if (ref.kind === "disk") return `disk:${plainPath(ref.path)}`;
  if (ref.kind === "virtual") return `virtual:locked:${plainPath(ref.container_path)}:${ref.entry_id.toLowerCase()}`;
  return `draft:${ref.draft_id.toLowerCase()}`;
}

export function providerIdOf(ref: DocumentRef): DocumentProviderId {
  return ref.kind === "disk" ? "disk" : ref.kind === "virtual" ? "locked" : "draft";
}

/** A fresh state for a just-opened document: revision 1, clean. */
export function initialDocumentState(contentId: string): DocumentState {
  return {
    revision: 1,
    saved_revision: 1,
    content_id: contentId,
    saved_content_id: contentId,
    dirty: false,
    ready: false,
    editing_enabled: false,
    can_save_existing: false,
    can_save_copy: true,
  };
}

/** The state after the model's content changed to `contentId`. */
export function stateAfterContentChange(state: DocumentState, contentId: string): DocumentState {
  return {
    ...state,
    revision: state.revision + 1,
    content_id: contentId,
    dirty: contentId !== state.saved_content_id,
  };
}

/** The state after revision `revision` with content `contentId` was saved.
 * Later edits are untouched: only the saved markers move. */
export function stateAfterSave(state: DocumentState, revision: number, contentId: string): DocumentState {
  if (revision > state.revision) return state;
  return {
    ...state,
    saved_revision: revision,
    saved_content_id: contentId,
    dirty: state.content_id !== contentId,
  };
}
