import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { displayPath, type ExplorerItem } from "./explorer";
import { runJob, type JobHandle } from "./jobs";
import { isTauriRuntime } from "./settings";

/** Gallery sources and paging (Step 07c, export E1). Mirrors
 * `src-tauri/src/gallery_types.rs`; fields stay snake_case on both sides. */

export const MAX_GALLERY_SOURCES = 32;
export const MAX_GALLERY_SOURCE_PATH_UTF16 = 32_768;
export const MAX_GALLERY_PAGE_ROWS = 256;
export const MAX_GALLERY_PAGE_BYTES = 768 * 1024;

export type GalleryDateSource = "taken" | "modified";
export type GalleryLimitReason = "depth" | "items" | "folders" | "access" | "drive";

/** One folder the user chose. `path` is stored exactly as picked. */
export interface GallerySource {
  id: string;
  path: string;
  recursive: boolean;
}

/** The persisted `gallery` settings section (schema 13). */
export interface GallerySettings {
  sources: GallerySource[];
  date_source: GalleryDateSource;
}

/** One picture in a page. `item` is the Explorer's own item shape. */
export interface GalleryItem {
  item: ExplorerItem;
  /** Volume/file id, or `path:<normalized path>` when no stable id exists. */
  identity: string;
  /** ISO UTC from Step 07b when reading it was allowed. */
  taken_utc: string | null;
  /** `YYYY-MM` (UTC) or `undated`; the UI formats the local month. */
  group_key: string;
  source_ids: string[];
}

export interface GalleryPage {
  generation: string;
  items: GalleryItem[];
  next_cursor: string | null;
  complete: boolean;
  partial: boolean;
  skipped_count: number;
  limit_reason: GalleryLimitReason | null;
}

export interface GalleryStartRequest {
  /** Filled from the shared job id before the command runs. */
  request_id?: string;
  sources: GallerySource[];
  date_source: GalleryDateSource;
  show_hidden: boolean;
  show_system: boolean;
}

export function defaultGallerySettings(): GallerySettings {
  return { sources: [], date_source: "taken" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A drive root (`C:\`) or a UNC path (`\\server\share`). */
const ABSOLUTE_GALLERY_PATH = /^(?:[A-Za-z]:\\|\\\\)/;

/** Same comparison key as Rust `gallery_path_key`. */
export function galleryPathKey(path: string): string {
  let key = displayPath(path).replace(/\//g, "\\");
  while (key.length > 3 && key.endsWith("\\")) key = key.slice(0, -1);
  return key.toLowerCase();
}

/** An absolute Windows path without `..` parts. */
export function isAbsoluteGalleryPath(path: string): boolean {
  if (!ABSOLUTE_GALLERY_PATH.test(path.replace(/\//g, "\\")) || /[\x00-\x1f]/.test(path) || path.startsWith("\\\\.\\")) return false;
  return !path.split(/[\\/]/).some(part => part === ".." || part === ".");
}

const GALLERY_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same UUID rule as Rust `Uuid::parse_str`. */
export function isGallerySourceId(value: unknown): value is string {
  return typeof value === "string" && GALLERY_UUID_RE.test(value);
}

let fallbackId = 0;

/** A source id the Rust validator accepts (a UUID). */
export function newGallerySourceId(): string {
  const cryptoApi = globalThis.crypto as (Crypto & { randomUUID?: () => string }) | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  fallbackId += 1;
  return `00000000-0000-4000-8000-${fallbackId.toString(16).padStart(12, "0")}`;
}

/** Repairs a saved section field by field: at most 32 valid, unique roots. */
export function normalizeGallerySettings(value: unknown): GallerySettings {
  const input = isRecord(value) ? value : {};
  const sources: GallerySource[] = [];
  const seenPaths = new Set<string>();
  const seenIds = new Set<string>();
  if (Array.isArray(input.sources)) {
    for (const entry of input.sources) {
      if (sources.length >= MAX_GALLERY_SOURCES) break;
      if (!isRecord(entry) || typeof entry.path !== "string") continue;
      const path = entry.path.trim();
      if (!isAbsoluteGalleryPath(path) || path.length > MAX_GALLERY_SOURCE_PATH_UTF16) continue;
      const key = galleryPathKey(path);
      if (seenPaths.has(key)) continue;
      seenPaths.add(key);
      let id = isGallerySourceId(entry.id) ? entry.id : newGallerySourceId();
      while (seenIds.has(id)) id = newGallerySourceId();
      seenIds.add(id);
      sources.push({
        id,
        path,
        recursive: typeof entry.recursive === "boolean" ? entry.recursive : true,
      });
    }
  }
  return {
    sources,
    date_source: input.date_source === "modified" ? "modified" : "taken",
  };
}

/** `null` when valid, else the Rust error code the UI translates. */
export function validateGallerySettings(settings: GallerySettings): string | null {
  if (settings.sources.length > MAX_GALLERY_SOURCES) return "gallery.too_many";
  const seen = new Set<string>();
  const ids = new Set<string>();
  for (const source of settings.sources) {
    if (ids.has(source.id.toLowerCase())) return "gallery.bad_request";
    ids.add(source.id.toLowerCase());
    if (
      !isGallerySourceId(source.id) ||
      !isAbsoluteGalleryPath(source.path) ||
      source.path.length > MAX_GALLERY_SOURCE_PATH_UTF16
    ) {
      return "gallery.bad_request";
    }
    const key = galleryPathKey(source.path);
    if (seen.has(key)) return "gallery.bad_request";
    seen.add(key);
  }
  if (settings.date_source !== "taken" && settings.date_source !== "modified") {
    return "gallery.bad_request";
  }
  return null;
}

/** Starts a scan. The job's result is the first page; the scan continues. */
export async function startGallery(request: GalleryStartRequest): Promise<JobHandle<GalleryPage>> {
  return runJob<GalleryPage>("gallery", async (requestId) => {
    await invoke("gallery_start", { request: { ...request, request_id: requestId } });
  });
}

/** One page of a started scan; a foreign/expired cursor rejects with
 * `gallery.changed`. */
export async function galleryPage(
  generation: string,
  cursor?: string | null,
): Promise<GalleryPage> {
  return (await invoke("gallery_page", { generation, cursor: cursor ?? null })) as GalleryPage;
}

/** Closes a scan; idempotent. */
export async function closeGallery(generation: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("gallery_close", { generation });
}

/** Stops discovery while a retained Gallery view is inactive. */
export async function setGalleryActive(generation: string, active: boolean): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("gallery_active", { generation, active });
}

/** Windows' folder picker. The title is the translated `gallery.addFolder`
 * label; it is the only text this command accepts. */
export async function pickGallerySource(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  return (await invoke("gallery_pick_source", {})) as string | null;
}

/** Source changes reported by the backend watchers (250 ms coalesced). */
export async function listenGalleryChanges(
  handler: (generation: string) => void,
): Promise<UnlistenFn> {
  return listen<{ generation: string }>("gallery-changed", (event) =>
    handler(event.payload.generation),
  );
}

/** Sent once when a scan stops (complete, cancelled or partial). */
export interface GalleryScanFinished {
  generation: string;
  complete: boolean;
  partial: boolean;
  skipped_count: number;
  limit_reason: GalleryLimitReason | null;
}

/** Lets the grid regroup the loaded rows and show the partial notice as soon
 * as the scan stops, without fetching every remaining page. */
export async function listenGalleryScanFinished(
  handler: (event: GalleryScanFinished) => void,
): Promise<UnlistenFn> {
  return listen<GalleryScanFinished>("gallery-scan-finished", (event) =>
    handler(event.payload),
  );
}
