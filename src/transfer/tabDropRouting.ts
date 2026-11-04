/** Typed drop routing for tabs, the tab bar and groups (Step 09c T4).
 *
 * A MIME label is a hint, never authority (D1). Tab and content drags carry
 * only opaque ids that the app resolves itself; external paths come only
 * from the host's file list, never from `text/plain`, `text/html` or from
 * fields inside an internal payload. A malformed internal payload is
 * refused instead of falling through to the file list, so a spoofed label
 * can never make the app open or copy a path.
 *
 * Folder drops delegate to the 03b conflict/queue pipeline through the
 * injected `copyMove` port (D3). Bar, tab and group drops go through
 * `planOpen` (U5); a group additionally assigns the freshly opened tabs
 * through the 09b reducer port. Nothing here mutates files directly. */
import type { OpenDecision } from "../handlers/openPipeline";
import { isAbsolutePath, isUuid } from "../documents/types";
import { parentPathOf, samePath } from "../services/explorer";

/** Internal tab reorder/activation payload: `{"tab_id":"..."}`. */
export const TAB_DRAG_MIME = "application/x-adperastra-tab";
/** Internal content transfer payload: `{"transfer_id":"<uuid>"}`. */
export const TRANSFER_DRAG_MIME = "application/x-adperastra-transfer";
/** The label browsers put on external file drags (not read as authority). */
export const FILES_DRAG_MIME = "files";

/** Opening more files than this from one drop is refused; a folder drop
 * (copy/move) keeps 03b's own limits and is not capped here. */
export const MAX_OPEN_PATHS = 256;

/** Tab ids (`file-...`, `explorer`) and group ids (UUIDs) both fit. */
const DROP_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export type DropPayload =
  | { kind: "files"; paths: readonly string[] }
  | { kind: "tab"; tabId: string }
  | { kind: "content"; transferId: string }
  | { kind: "invalid" };

/** The parts of `DataTransfer` this module reads. Plain objects are enough,
 * which keeps the tests independent from jsdom's missing DataTransfer. */
export interface DropDataTransfer {
  readonly types: readonly string[];
  getData(type: string): string;
  readonly files: ArrayLike<{ readonly path?: string }>;
}

function jsonObject(raw: string): Record<string, unknown> | null {
  if (raw === "") return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function hostFiles(data: DropDataTransfer): DropPayload {
  const files = data.files;
  if (!files || typeof files.length !== "number" || files.length === 0) return { kind: "invalid" };
  const paths: string[] = [];
  for (let index = 0; index < files.length; index += 1) {
    const candidate = files[index] as { readonly path?: unknown } | null | undefined;
    const path = candidate?.path;
    // Every dropped file must expose an absolute host path. If one does
    // not, refuse the whole drop: opening the rest would silently lose it.
    if (typeof path !== "string" || !isAbsolutePath(path)) return { kind: "invalid" };
    paths.push(path);
  }
  return paths.length === 0 ? { kind: "invalid" } : { kind: "files", paths };
}

/** Classify one drop. Internal labels win over the file list; two internal
 * labels at once are contradictory and refused. */
export function readDropPayload(data: DropDataTransfer | null | undefined): DropPayload {
  if (!data) return { kind: "invalid" };
  let types: string[];
  try {
    types = Array.from(data.types ?? [], (type) => String(type).toLowerCase());
  } catch {
    return { kind: "invalid" };
  }
  const internal = [TAB_DRAG_MIME, TRANSFER_DRAG_MIME].filter((mime) => types.includes(mime));
  if (internal.length > 1) return { kind: "invalid" };
  if (internal.length === 1) {
    let raw = "";
    try {
      raw = data.getData(internal[0]);
    } catch {
      return { kind: "invalid" };
    }
    const value = jsonObject(raw);
    if (!value) return { kind: "invalid" };
    if (internal[0] === TAB_DRAG_MIME) {
      return typeof value.tab_id === "string" && DROP_ID_RE.test(value.tab_id)
        ? { kind: "tab", tabId: value.tab_id }
        : { kind: "invalid" };
    }
    return isUuid(value.transfer_id)
      ? { kind: "content", transferId: value.transfer_id }
      : { kind: "invalid" };
  }
  return hostFiles(data);
}

export interface DropModifiers {
  readonly ctrl: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
}

export type DropDestination =
  | { kind: "tab"; tabId: string }
  | { kind: "bar" }
  | { kind: "group"; groupId: string }
  | { kind: "folder"; destDir: string };

/** What a drop may do on the host. Only the ports the destination needs are
 * required; a missing port refuses the drop instead of guessing. */
export interface FileDropPorts {
  planOpen?: (path: string) => Promise<OpenDecision>;
  /** Open one planned file; returns the new tab id, or null when the
   * decision opened a Windows default app instead. */
  openDecision?: (decision: OpenDecision, background: boolean) => Promise<string | null>;
  addToGroup?: (groupId: string, tabIds: readonly string[]) => void;
  copyMove?: (kind: "copy" | "move", sources: readonly string[], destDir: string) => Promise<void>;
  volumeOf?: (path: string) => string;
}

export type FileDropResult =
  | {
      kind: "none";
      reason: "empty" | "invalid" | "same_folder" | "modifier" | "too_many" | "unavailable";
    }
  | { kind: "opened"; opened: number; refused: number }
  | { kind: "copied"; count: number }
  | { kind: "moved"; count: number };

function volumeOfPath(path: string): string {
  const plain = path
    .replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\\\\\?\\/, "")
    .replace(/\//g, "\\");
  if (plain.startsWith("\\\\")) {
    return plain.split("\\").slice(0, 4).join("\\").toUpperCase();
  }
  return `${plain.split("\\")[0].toUpperCase()}\\`;
}

export const defaultVolumeOf = volumeOfPath;

/** D3's folder rules: a same-folder drop does nothing, Ctrl copies, Shift
 * moves, and the default moves only within one volume. Alt (Windows link)
 * is not part of content-transfer-1, so it never turns into a copy. */
export function dropEffectFor(
  paths: readonly string[],
  destDir: string,
  modifiers: DropModifiers,
  volumeOf: (path: string) => string = defaultVolumeOf,
): "none" | "copy" | "move" {
  if (paths.length === 0 || !paths.every((path) => isAbsolutePath(path))) return "none";
  const sameFolder = paths.every((path) => {
    const parent = parentPathOf(path);
    return parent !== null && samePath(parent, destDir);
  });
  if (sameFolder) return "none";
  if (modifiers.ctrl) return "copy";
  if (modifiers.shift) return "move";
  if (modifiers.alt) return "none";
  const destinationVolume = volumeOf(destDir);
  if (destinationVolume === "") return "copy";
  // Explorer's default: move only when every source shares the destination's volume.
  return paths.every((path) => volumeOf(path) === destinationVolume) ? "move" : "copy";
}

async function routeOpen(
  destination: { kind: "bar" } | { kind: "tab"; tabId: string } | { kind: "group"; groupId: string },
  paths: readonly string[],
  ports: FileDropPorts,
): Promise<FileDropResult> {
  const planOpen = ports.planOpen;
  const openDecision = ports.openDecision;
  if (!planOpen || !openDecision) return { kind: "none", reason: "unavailable" };
  const grouped = destination.kind === "group";
  const addToGroup = ports.addToGroup;
  if (grouped && !addToGroup) return { kind: "none", reason: "unavailable" };
  let opened = 0;
  let refused = 0;
  const newTabs: string[] = [];
  for (const path of paths) {
    try {
      const decision = await planOpen(path);
      const tabId = await openDecision(decision, grouped);
      opened += 1;
      if (tabId !== null) newTabs.push(tabId);
    } catch {
      refused += 1;
    }
  }
  if (grouped && addToGroup && newTabs.length > 0) addToGroup(destination.groupId, newTabs);
  return { kind: "opened", opened, refused };
}

/** Route one validated file drop. The caller already read the payload with
 * `readDropPayload` and only calls this for `kind === "files"`. */
export async function routeFileDrop(
  destination: DropDestination,
  paths: readonly string[],
  modifiers: DropModifiers,
  ports: FileDropPorts,
): Promise<FileDropResult> {
  if (paths.length === 0) return { kind: "none", reason: "empty" };
  if (!paths.every((path) => isAbsolutePath(path))) return { kind: "none", reason: "invalid" };
  if (destination.kind === "folder") {
    const copyMove = ports.copyMove;
    if (!copyMove) return { kind: "none", reason: "unavailable" };
    if (!isAbsolutePath(destination.destDir)) return { kind: "none", reason: "invalid" };
    const effect = dropEffectFor(paths, destination.destDir, modifiers, ports.volumeOf ?? defaultVolumeOf);
    if (effect === "none") {
      return { kind: "none", reason: modifiers.alt ? "modifier" : "same_folder" };
    }
    await copyMove(effect, paths, destination.destDir);
    return effect === "copy"
      ? { kind: "copied", count: paths.length }
      : { kind: "moved", count: paths.length };
  }
  if (paths.length > MAX_OPEN_PATHS) return { kind: "none", reason: "too_many" };
  return routeOpen(destination, paths, ports);
}
