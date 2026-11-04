import { invoke } from "@tauri-apps/api/core";
import type { ConversionInput, MetadataCategory } from "../convert/types";
import type { DocumentHandle } from "../documents/types";
import { captureEncodedSnapshot, type EncodeOptions } from "../image-edit/encode";
import {
  MAX_PROJECT_ARCHIVE_BYTES,
  MAX_PROJECT_EXTENSION_BYTES,
  MAX_PROJECT_EXTENSIONS_BYTES,
  MAX_PROJECT_PAYLOAD_BYTES,
  MAX_PROJECT_PAYLOAD_PAGE_BYTES,
  PROJECT_METADATA_CATEGORIES,
  PROJECT_MIME,
  projectErrorCode,
  validateProjectManifest,
  type ImageProjectInfo,
  type ImageProjectManifest,
  type ImageProjectOpenResult,
  type ProjectPayloadEntry,
} from "../image-edit/projectTypes";
import type { ImageModel } from "../image-edit/types";
import type { ExportSnapshot } from "./exportSnapshots";
import { runJob, type JobHandle } from "./jobs";

/** Editable image projects (Step 18b E2, `image-project-1`).
 *
 * The native provider validates and parses the guarded archive. The open job
 * returns descriptors only; `image_project_payload_start` returns the
 * validated manifest plus an opaque session handle, and raw page reads carry
 * the decoded tile/mask/original, metadata and optional-extension bytes under
 * a 1 MiB per-page cap. No path or raw ZIP crosses this service. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The additive payload-open result; mirrors the native result. */
export interface ImageProjectPayloadOpenResult extends ImageProjectInfo {
  manifest: ImageProjectManifest;
  entries: ProjectPayloadEntry[];
  handle: string;
  total_bytes: number;
  page_bytes: number;
  /** Present when the input was an 08a snapshot; the source stamp is removed. */
  source_snapshot?: ExportSnapshot;
}

/** The exact payload set `assembleImageProjectModel` consumes. */
export interface NativeImageProjectPayloads {
  manifest: ImageProjectManifest;
  tiles: ReadonlyMap<string, Uint8Array>;
  metadata: ReadonlyMap<MetadataCategory, Uint8Array>;
  extensions: ReadonlyMap<string, Uint8Array>;
  source_snapshot: ExportSnapshot;
}

function corrupt(): never {
  throw new Error("image_project.corrupt");
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function validateInput(input: ConversionInput): void {
  if (!input || typeof input !== "object") throw new Error("image_project.bad_request");
  if (input.kind === "file") {
    const path = input.path;
    if (typeof path !== "string" || path.length === 0 || path.length > 32768 || path.includes("\0")) {
      throw new Error("image_project.bad_request");
    }
    if (!/^[A-Za-z]:[\\/]/.test(path) && !path.startsWith("\\\\")) throw new Error("image_project.bad_request");
    if (path.split(/[\\/]/).some((part) => part === "..")) throw new Error("image_project.bad_request");
    return;
  }
  if (input.kind === "snapshot") {
    if (!isUuid(input.snapshot_id) || !isUuid(input.document_id)) throw new Error("image_project.bad_request");
    if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw new Error("image_project.bad_request");
    return;
  }
  throw new Error("image_project.bad_request");
}

/** E2: opens a project through the native guarded reader. The result has the
 * canonical `ImageProjectInfo` fields; the additive descriptors (extensions,
 * metadata) are available through `openImageProjectDetailed`. */
export async function openImageProject(input: ConversionInput): Promise<JobHandle<ImageProjectInfo>> {
  return openImageProjectDetailed(input);
}

export async function openImageProjectDetailed(
  input: ConversionInput,
): Promise<JobHandle<ImageProjectOpenResult>> {
  validateInput(input);
  try {
    return await runJob<ImageProjectOpenResult>("imgopen", (requestId) =>
      invoke("image_project_open_start", { requestId, input }),
    );
  } catch (error) {
    throw new Error(projectErrorCode(error));
  }
}

/** Defense-in-depth check of the native payload layout before a single page is
 * requested. The manifest is revalidated here; every channel entry must match
 * a tile, metadata category or extension exactly once and in order. */
function validatePayloadResult(
  result: ImageProjectPayloadOpenResult,
  info: ImageProjectOpenResult,
): void {
  if (!result || typeof result !== "object") corrupt();
  if (!isUuid(result.handle)) corrupt();
  if (!Number.isSafeInteger(result.total_bytes) || result.total_bytes < 1) corrupt();
  if (result.total_bytes > MAX_PROJECT_PAYLOAD_BYTES) throw new Error("image_project.too_large");
  if (!Number.isSafeInteger(result.page_bytes) || result.page_bytes < 1) corrupt();
  if (result.page_bytes > MAX_PROJECT_PAYLOAD_PAGE_BYTES) throw new Error("image_project.too_large");
  if (result.editable !== true) {
    throw new Error(
      Array.isArray(result.unsupported_features) &&
        result.unsupported_features.includes("required_extension")
        ? "image_project.unknown_required"
        : "image_project.unsupported_schema",
    );
  }
  if (!result.manifest || typeof result.manifest !== "object") corrupt();
  try {
    validateProjectManifest(result.manifest);
  } catch (error) {
    throw new Error(projectErrorCode(error));
  }
  const manifest = result.manifest;
  if (
    result.project_id !== info.project_id ||
    result.width !== info.width ||
    result.height !== info.height ||
    result.layer_count !== info.layer_count ||
    manifest.project_id !== result.project_id ||
    manifest.width !== result.width ||
    manifest.height !== result.height ||
    manifest.layers.length !== result.layer_count
  ) {
    throw new Error("image_project.changed");
  }
  const infoExtensions = info.extensions ?? [];
  if (infoExtensions.length !== manifest.extensions.length) throw new Error("image_project.changed");
  for (let at = 0; at < infoExtensions.length; at += 1) {
    const left = infoExtensions[at];
    const right = manifest.extensions[at];
    if (
      !left ||
      !right ||
      left.name !== right.name ||
      left.required !== right.required ||
      left.path !== right.path ||
      left.sha256 !== right.sha256
    ) {
      throw new Error("image_project.changed");
    }
  }
  const infoMetadata = info.metadata_entries ?? [];
  if (infoMetadata.length !== manifest.metadata_entries.length) {
    throw new Error("image_project.changed");
  }
  for (let at = 0; at < infoMetadata.length; at += 1) {
    const left = infoMetadata[at];
    const right = manifest.metadata_entries[at];
    if (
      !left ||
      !right ||
      left.category !== right.category ||
      left.path !== right.path ||
      left.byte_len !== right.byte_len ||
      left.sha256 !== right.sha256
    ) {
      throw new Error("image_project.changed");
    }
  }
  if (!Array.isArray(result.entries)) corrupt();
  const expected =
    manifest.tiles.length + manifest.metadata_entries.length + manifest.extensions.length;
  if (result.entries.length !== expected) corrupt();
  let index = 0;
  let total = 0;
  for (const tile of manifest.tiles) {
    const entry = result.entries[index];
    if (!entry || entry.kind !== tile.kind || entry.name !== tile.id) corrupt();
    if (entry.byte_len !== tile.raw_bytes) corrupt();
    total += entry.byte_len;
    index += 1;
  }
  for (const metadata of manifest.metadata_entries) {
    const entry = result.entries[index];
    if (!entry || entry.kind !== "metadata" || entry.name !== metadata.category) corrupt();
    if (entry.byte_len !== metadata.byte_len) corrupt();
    total += entry.byte_len;
    index += 1;
  }
  let extensionBytes = 0;
  for (const extension of manifest.extensions) {
    const entry = result.entries[index];
    if (!entry || entry.kind !== "extension" || entry.name !== extension.name) corrupt();
    if (!Number.isSafeInteger(entry.byte_len) || entry.byte_len < 0) corrupt();
    if (entry.byte_len > MAX_PROJECT_EXTENSION_BYTES) throw new Error("image_project.too_large");
    extensionBytes += entry.byte_len;
    if (extensionBytes > MAX_PROJECT_EXTENSIONS_BYTES) throw new Error("image_project.too_large");
    total += entry.byte_len;
    index += 1;
  }
  if (index !== result.entries.length || total !== result.total_bytes) corrupt();
}

/** The model needs a real 08a capture identity. A native snapshot result is
 * used only for the exact input ids; a file caller must pass the capture it
 * already made. The source stamp is stripped because it contains a path. */
function validateSourceSnapshot(
  input: ConversionInput,
  result: ImageProjectPayloadOpenResult,
  sourceSnapshot: ExportSnapshot | undefined,
): ExportSnapshot {
  const snapshot = input.kind === "snapshot" ? result.source_snapshot : sourceSnapshot;
  if (!snapshot || typeof snapshot !== "object") throw new Error("image_project.changed");
  if (!isUuid(snapshot.snapshot_id) || !isUuid(snapshot.document_id) || !isUuid(snapshot.content_id)) {
    throw new Error("image_project.changed");
  }
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1) {
    throw new Error("image_project.changed");
  }
  if (
    !Number.isSafeInteger(snapshot.byte_len) ||
    snapshot.byte_len < 1 ||
    snapshot.byte_len > MAX_PROJECT_ARCHIVE_BYTES
  ) {
    throw new Error("image_project.changed");
  }
  if (snapshot.mime !== PROJECT_MIME) throw new Error("image_project.changed");
  if (snapshot.storage_policy !== "ordinary" && snapshot.storage_policy !== "sensitive") {
    throw new Error("image_project.changed");
  }
  if (input.kind === "snapshot") {
    if (
      snapshot.snapshot_id !== input.snapshot_id ||
      snapshot.document_id !== input.document_id ||
      snapshot.revision !== input.revision
    ) {
      throw new Error("image_project.changed");
    }
  }
  const redacted = { ...snapshot };
  delete redacted.source;
  return redacted;
}

/** Pulls every page through the raw channel. Each reply is at most the
 * announced page size; a short page is only legal as the final page. */
async function readPayloadBytes(result: ImageProjectPayloadOpenResult): Promise<Uint8Array> {
  const total = result.total_bytes;
  const pageBytes = result.page_bytes;
  const maxPages = Math.ceil(total / pageBytes) + 1;
  const all = new Uint8Array(total);
  let offset = 0;
  let pages = 0;
  while (offset < total) {
    if (pages >= maxPages) throw new Error("image_project.changed");
    pages += 1;
    const response = await invoke<ArrayBuffer>("image_project_payload_page", {
      handle: result.handle,
      offset,
      maxBytes: pageBytes,
    }).catch((error: unknown) => {
      throw new Error(projectErrorCode(error));
    });
    const bytes = new Uint8Array(response);
    if (bytes.byteLength === 0 || bytes.byteLength > pageBytes || offset + bytes.byteLength > total) {
      throw new Error("image_project.changed");
    }
    if (bytes.byteLength < pageBytes && offset + bytes.byteLength < total) {
      throw new Error("image_project.changed");
    }
    all.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return all;
}

/** Splits the linear channel back into the manifest's exact payload names.
 * Original RGBA bytes are the `original_tile_ids` entries of the tile map. */
function splitPayloads(
  result: ImageProjectPayloadOpenResult,
  bytes: Uint8Array,
): Pick<NativeImageProjectPayloads, "manifest" | "tiles" | "metadata" | "extensions"> {
  const manifest = result.manifest;
  const tiles = new Map<string, Uint8Array>();
  const metadata = new Map<MetadataCategory, Uint8Array>();
  const extensions = new Map<string, Uint8Array>();
  let cursor = 0;
  for (const entry of result.entries) {
    const end = cursor + entry.byte_len;
    if (end > bytes.byteLength) corrupt();
    const slice = bytes.subarray(cursor, end);
    switch (entry.kind) {
      case "rgba":
      case "alpha":
        if (!isUuid(entry.name) || tiles.has(entry.name)) corrupt();
        tiles.set(entry.name, slice);
        break;
      case "metadata": {
        const category = entry.name as MetadataCategory;
        if (!PROJECT_METADATA_CATEGORIES.includes(category) || metadata.has(category)) corrupt();
        metadata.set(category, slice);
        break;
      }
      case "extension":
        if (extensions.has(entry.name)) corrupt();
        extensions.set(entry.name, slice);
        break;
      default:
        corrupt();
    }
    cursor = end;
  }
  if (
    cursor !== bytes.byteLength ||
    tiles.size !== manifest.tiles.length ||
    metadata.size !== manifest.metadata_entries.length ||
    extensions.size !== manifest.extensions.length
  ) {
    corrupt();
  }
  return { manifest, tiles, metadata, extensions };
}

/** The registered payload source for the trusted project importer. Every
 * failure releases the native session; the returned byte arrays are owned by
 * the WebView and the native buffers are zeroized. */
export async function resolveImageProjectPayloads(
  input: ConversionInput,
  info: ImageProjectOpenResult,
  sourceSnapshot?: ExportSnapshot,
): Promise<NativeImageProjectPayloads> {
  validateInput(input);
  let started: ImageProjectPayloadOpenResult | null = null;
  try {
    const job = await runJob<ImageProjectPayloadOpenResult>("imgpage", (requestId) =>
      invoke("image_project_payload_start", { requestId, input }),
    );
    started = await job.completion;
    validatePayloadResult(started, info);
    const source = validateSourceSnapshot(input, started, sourceSnapshot);
    const bytes = await readPayloadBytes(started);
    return { ...splitPayloads(started, bytes), source_snapshot: source };
  } catch (error) {
    throw new Error(projectErrorCode(error));
  } finally {
    if (started) {
      try {
        await invoke("image_project_payload_release", { handle: started.handle });
      } catch {
        // The session may already have expired or been released.
      }
    }
  }
}

/** E2: starts the native project capture job for an immutable identity.
 * `encodeImageProject` uses the 08a upload directly; this wrapper exists for
 * native provider paths that encode from a project-owned source. */
export async function captureImageProject(
  documentId: string,
  revision: number,
  contentId: string,
): Promise<JobHandle<ExportSnapshot>> {
  if (!isUuid(documentId) || !isUuid(contentId)) throw new Error("image_project.bad_request");
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("image_project.bad_request");
  try {
    return await runJob<ExportSnapshot>("imgcap", (requestId) =>
      invoke("image_project_capture_start", { requestId, documentId, revision, contentId }),
    );
  } catch (error) {
    throw new Error(projectErrorCode(error));
  }
}

/** A flattened export is always an ordinary image snapshot, never a project
 * archive. Guides and layer editability are not passed to the encoder. */
export async function exportFlattenedProject(
  document: DocumentHandle,
  model: Readonly<ImageModel>,
  capturedRevision: number,
  contentId: string,
  options: EncodeOptions,
): Promise<ExportSnapshot> {
  if (options.mime === (PROJECT_MIME as unknown as EncodeOptions["mime"])) {
    throw new Error("image_project.bad_request");
  }
  return captureEncodedSnapshot(document, model, capturedRevision, contentId, options);
}
