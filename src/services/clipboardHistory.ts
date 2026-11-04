import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { TransferEnvelope } from "../transfer/types";
import { validateTransferEnvelope } from "../transfer/transferValidation";
import type { ExportSnapshot } from "./exportSnapshots";
import { isTauriRuntime } from "./settings";

/** Clipboard-history service (Step 09j E2/E3, `clipboard-history-1`).
 * The native mirror is `src-tauri/src/clipboard_history_types.rs`. No
 * image bytes ever cross these calls: an image item resolves to an 08a
 * snapshot identity inside an ordinary 09c transfer. */

export type ClipboardHistoryKind = "text" | "files" | "image";
export type ClipboardHistorySource = "app" | "windows";

export interface ClipboardHistoryItem {
  id: string;
  kind: ClipboardHistoryKind;
  created_unix: number;
  source: ClipboardHistorySource;
  source_label?: string;
  preview: string;
  byte_len: number;
  pinned: boolean;
  missing: boolean;
  payload_token?: string;
}

export interface ClipboardHistoryPage {
  items: ClipboardHistoryItem[];
  next_cursor?: string;
  complete: boolean;
  total: number;
  used_bytes: number;
  generation: number;
}

export type ClipboardHistoryPayload =
  | { kind: "text"; text: string }
  | { kind: "files"; paths: string[] }
  | { kind: "image"; snapshot: ExportSnapshot; width: number; height: number };

export type ClipboardHistoryPatch =
  | { kind: "pin"; id: string; pinned: boolean; expected_generation: number }
  | { kind: "remove"; ids: string[]; expected_generation: number }
  | { kind: "clear"; include_pinned: boolean; expected_generation: number };

export interface ClipboardHistorySettings {
  enabled: boolean;
  capture_windows: boolean;
  persist: boolean;
  max_items: number;
  max_mib: number;
}

export const MAX_HISTORY_ITEMS = 100;
export const MAX_PINNED_ITEMS = 20;
export const MAX_HISTORY_BYTES = 64 * 1024 * 1024;
export const MAX_PAGE_ITEMS = 50;
export const MAX_SEARCH_CHARS = 256;
export const MAX_PREVIEW_CHARS = 512;
export const MAX_REMOVE_IDS = 100;
export const CLIPBOARD_HISTORY_CHANGED_EVENT = "clipboard-history-changed";

export const DEFAULT_CLIPBOARD_HISTORY_SETTINGS: ClipboardHistorySettings = {
  enabled: true,
  capture_windows: false,
  persist: false,
  max_items: 100,
  max_mib: 64,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS: readonly ClipboardHistoryKind[] = ["text", "files", "image"];
const SOURCES: readonly ClipboardHistorySource[] = ["app", "windows"];

type Obj = Record<string, unknown>;

function shape(value: unknown, keys: readonly string[]): Obj | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Obj;
  return Object.keys(object).every((key) => keys.includes(key)) ? object : null;
}

function safeInt(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function validateSettings(input: unknown): ClipboardHistorySettings {
  const object = shape(input, ["enabled", "capture_windows", "persist", "max_items", "max_mib"]);
  if (!object) return { ...DEFAULT_CLIPBOARD_HISTORY_SETTINGS };
  return {
    enabled: typeof object.enabled === "boolean" ? object.enabled : true,
    capture_windows: typeof object.capture_windows === "boolean" ? object.capture_windows : false,
    persist: typeof object.persist === "boolean" ? object.persist : false,
    max_items:
      safeInt(object.max_items) && object.max_items >= 10 && object.max_items <= 100
        ? object.max_items
        : 100,
    max_mib:
      safeInt(object.max_mib) && object.max_mib >= 8 && object.max_mib <= 64
        ? object.max_mib
        : 64,
  };
}

export function validateClipboardHistoryItem(value: unknown): ClipboardHistoryItem | null {
  const object = shape(value, [
    "id",
    "kind",
    "created_unix",
    "source",
    "source_label",
    "preview",
    "byte_len",
    "pinned",
    "missing",
    "payload_token",
  ]);
  if (!object) return null;
  if (!isUuid(object.id)) return null;
  if (!KINDS.includes(object.kind as ClipboardHistoryKind)) return null;
  if (!safeInt(object.created_unix) || !safeInt(object.byte_len)) return null;
  if (!SOURCES.includes(object.source as ClipboardHistorySource)) return null;
  if (object.source_label !== undefined) {
    if (
      typeof object.source_label !== "string" ||
      object.source_label.length > 128 ||
      /[\u0000-\u001f]/.test(object.source_label)
    ) {
      return null;
    }
  }
  if (typeof object.preview !== "string" || object.preview.length > MAX_PREVIEW_CHARS) {
    return null;
  }
  if (typeof object.pinned !== "boolean" || typeof object.missing !== "boolean") return null;
  if (object.payload_token !== undefined && !isUuid(object.payload_token)) return null;
  return {
    id: object.id,
    kind: object.kind as ClipboardHistoryKind,
    created_unix: object.created_unix,
    source: object.source as ClipboardHistorySource,
    ...(object.source_label ? { source_label: object.source_label } : {}),
    preview: object.preview,
    byte_len: object.byte_len,
    pinned: object.pinned,
    missing: object.missing,
    ...(object.payload_token ? { payload_token: object.payload_token } : {}),
  };
}

export function validateClipboardHistoryPage(value: unknown): ClipboardHistoryPage {
  const object = shape(value, [
    "items",
    "next_cursor",
    "complete",
    "total",
    "used_bytes",
    "generation",
  ]);
  if (!object) throw new Error("clipboard_history.invalid");
  if (!Array.isArray(object.items) || object.items.length > MAX_PAGE_ITEMS) {
    throw new Error("clipboard_history.invalid");
  }
  const items = object.items.map(validateClipboardHistoryItem);
  if (items.some((item) => item === null)) throw new Error("clipboard_history.invalid");
  if (object.next_cursor !== undefined && !isUuid(object.next_cursor)) {
    throw new Error("clipboard_history.invalid");
  }
  if (typeof object.complete !== "boolean") throw new Error("clipboard_history.invalid");
  if (!safeInt(object.total, 4_294_967_295) || !safeInt(object.used_bytes) || !safeInt(object.generation)) {
    throw new Error("clipboard_history.invalid");
  }
  return {
    items: items as ClipboardHistoryItem[],
    ...(object.next_cursor ? { next_cursor: object.next_cursor } : {}),
    complete: object.complete,
    total: object.total,
    used_bytes: object.used_bytes,
    generation: object.generation,
  };
}

export function validatePatch(patch: ClipboardHistoryPatch): ClipboardHistoryPatch {
  if (!safeInt(patch.expected_generation)) throw new Error("clipboard_history.invalid");
  if (patch.kind === "pin") {
    if (!isUuid(patch.id) || typeof patch.pinned !== "boolean") {
      throw new Error("clipboard_history.invalid");
    }
    return { kind: "pin", id: patch.id, pinned: patch.pinned, expected_generation: patch.expected_generation };
  }
  if (patch.kind === "remove") {
    if (
      !Array.isArray(patch.ids) ||
      patch.ids.length === 0 ||
      patch.ids.length > MAX_REMOVE_IDS ||
      !patch.ids.every(isUuid)
    ) {
      throw new Error("clipboard_history.invalid");
    }
    return {
      kind: "remove",
      ids: [...patch.ids],
      expected_generation: patch.expected_generation,
    };
  }
  if (patch.kind === "clear") {
    if (typeof patch.include_pinned !== "boolean") {
      throw new Error("clipboard_history.invalid");
    }
    return {
      kind: "clear",
      include_pinned: patch.include_pinned,
      expected_generation: patch.expected_generation,
    };
  }
  throw new Error("clipboard_history.invalid");
}

export async function listClipboardHistory(
  query: string,
  cursor?: string,
): Promise<ClipboardHistoryPage> {
  if (query.length > MAX_SEARCH_CHARS) throw new Error("clipboard_history.invalid");
  if (cursor !== undefined && !isUuid(cursor)) throw new Error("clipboard_history.invalid");
  const response = await invoke("clipboard_history_list", {
    query,
    cursor: cursor ?? null,
  });
  return validateClipboardHistoryPage(response);
}

export async function patchClipboardHistory(
  patch: ClipboardHistoryPatch,
): Promise<ClipboardHistoryPage> {
  const normalized = validatePatch(patch);
  const response = await invoke("clipboard_history_patch", { patch: normalized });
  return validateClipboardHistoryPage(response);
}

/** Resolve one item into a live 09c transfer. The caller must release it
 * with `releaseTransfer` after the target commits or cancels. */
export async function resolveClipboardHistory(
  id: string,
  targetDocumentId?: string,
): Promise<TransferEnvelope> {
  if (!isUuid(id)) throw new Error("clipboard_history.invalid");
  if (targetDocumentId !== undefined && !isUuid(targetDocumentId)) {
    throw new Error("clipboard_history.invalid");
  }
  const response = await invoke("clipboard_history_resolve", {
    id,
    targetDocumentId: targetDocumentId ?? null,
  });
  const envelope = validateTransferEnvelope(response);
  if (!envelope) throw new Error("clipboard_history.invalid");
  return envelope;
}

/** Record a successful app copy from its authoritative transfer id. The
 * native side derives the payload and sensitivity again. */
export async function recordAppClipboard(transferId: string): Promise<void> {
  if (!isUuid(transferId)) throw new Error("clipboard_history.invalid");
  await invoke("clipboard_history_record", { transferId });
}

/** Listen for captures and history mutations; returns an unsubscribe. */
export async function listenClipboardHistoryChanged(
  listener: (generation: number) => void,
): Promise<UnlistenFn> {
  if (!isTauriRuntime()) return () => undefined;
  return listen<number>(CLIPBOARD_HISTORY_CHANGED_EVENT, (event) => listener(event.payload));
}
