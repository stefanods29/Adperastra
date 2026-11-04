import type { ConversionInput } from "../convert/types";
import type { MetadataCategory } from "../convert/types";
import type { DocumentControllerBinding, DocumentControllerContext } from "../documents/controller";
import type { DocumentHandle } from "../documents/types";
import { releaseExportSnapshot, type ExportSnapshot } from "../services/exportSnapshots";
import { openImageProjectDetailed, resolveImageProjectPayloads } from "../services/imageProjects";
import {
  acquireImageEditorForModel,
  clearImageProjectSettings,
  imageControllerBinding,
  setImageProjectSettings,
} from "./ImageDocument";
import { MAX_LAYERS, validateLayerModel } from "./layerTypes";
import { disposeImageMetadata, publishImageMetadata } from "./metadata";
import {
  forgetProjectExtensions,
  registerImageProjectImporter,
  registerProjectExtensionPayloadLoader,
  rememberProjectExtensions,
  sha256Hex,
} from "./projectCodec";
import {
  MAX_PROJECT_DECODED_TILE_BYTES,
  MAX_PROJECT_EXTENSION_BYTES,
  MAX_PROJECT_EXTENSIONS,
  MAX_PROJECT_EXTENSIONS_BYTES,
  MAX_PROJECT_METADATA_BYTES,
  MAX_PROJECT_METADATA_ENTRIES,
  PROJECT_METADATA_CATEGORIES,
  PROJECT_MIME,
  projectErrorCode,
  validateExtension,
  validateMetadataEntry,
  validateProjectManifest,
  type ImageProjectManifest,
  type ImageProjectOpenResult,
} from "./projectTypes";
import { disposeImageTileStore, getImageTileStore, publishTileAt } from "./tiles";
import {
  fail,
  isUuid,
  newUuid,
  MAX_IMAGE_EDGE,
  MAX_IMAGE_PIXELS,
  type ImageController,
  type ImageLayer,
  type ImageMask,
  type ImageModel,
  type MaskTileRef,
  type MetadataBlobRef,
  type TileRef,
} from "./types";

/** Trusted `.adimage` importer (Step 18b E3, `image-project-1`).
 *
 * `decodeImageProject` already runs the native guarded reader, which owns
 * ZIP parsing, entry allowlists, hashes, exact zstd lengths and the tile
 * budget. This module is the one trusted function that turns that validated
 * result plus native payloads into the live `ImageModel`: it re-checks every
 * descriptor, publishes the decoded tiles into the document tile store and
 * rewrites the manifest references to the store identities. Nothing here
 * parses archive bytes in the WebView: the payload source comes from the
 * native project provider's bounded page channel.
 *
 * `installImageProjectImporter` registers both the importer and the payload
 * source, so `assembleImageProjectModel` is reachable without any test-only
 * fallback. A required unknown extension never reaches it. */

/** Stable feature codes are short lower-case machine strings. */
const FEATURE_CODE = /^[a-z][a-z0-9_.-]{0,63}$/;
const MAX_UNSUPPORTED_FEATURES = 128;

/** Payloads a native provider must supply for one already-validated archive.
 * Tile bytes are the decoded raw payloads the guard verified (row-major RGBA8
 * for `rgba`, alpha8 for `alpha`), never the compressed archive entries. */
export interface ImageProjectPayloads {
  manifest: ImageProjectManifest;
  tiles: ReadonlyMap<string, Uint8Array>;
  /** Required for every `metadata_entries` declaration. */
  metadata?: ReadonlyMap<MetadataCategory, Uint8Array>;
  /** Required for every optional extension declaration; re-saved byte for
   * byte. A required unknown extension never reaches the importer. */
  extensions?: ReadonlyMap<string, Uint8Array>;
  /** The 08a capture of the project document itself. */
  source_snapshot: ExportSnapshot;
}

export type ImageProjectPayloadSource = (
  input: ConversionInput,
  info: ImageProjectOpenResult,
  sourceSnapshot?: ExportSnapshot,
) => Promise<ImageProjectPayloads | null>;

let payloadSource: ImageProjectPayloadSource | null = null;

/** Trusted static registration for the native project provider. Returns a
 * function that removes exactly this source. */
export function registerImageProjectPayloadSource(
  source: ImageProjectPayloadSource | null,
): () => void {
  if (source !== null && typeof source !== "function") fail("image_project.bad_request");
  payloadSource = source;
  return () => {
    if (payloadSource === source) payloadSource = null;
  };
}

export function hasImageProjectPayloadSource(): boolean {
  return payloadSource !== null;
}

function corrupt(): never {
  return fail("image_project.corrupt");
}

function validateDescriptor<T>(validate: (value: T) => void, value: T): void {
  try {
    validate(value);
  } catch {
    // A malformed native descriptor is a corrupt open result, never a caller
    // request error: the caller cannot produce extension or metadata fields.
    corrupt();
  }
}

const PROJECT_METADATA_CATEGORY_SET: ReadonlySet<string> = new Set(PROJECT_METADATA_CATEGORIES);

/** Strict defense-in-depth check of the native open result. The native
 * validator already refused a bad archive; this guarantees the additive
 * descriptor fields (which are not part of `ImageProjectInfo`) agree with the
 * project limits before any payload is looked at. */
export function validateImageProjectOpenResult(info: ImageProjectOpenResult): void {
  if (!info || typeof info !== "object") corrupt();
  if (!isUuid(info.project_id)) corrupt();
  if (!Number.isInteger(info.width) || !Number.isInteger(info.height) || info.width < 1 || info.height < 1) {
    corrupt();
  }
  if (
    info.width > MAX_IMAGE_EDGE ||
    info.height > MAX_IMAGE_EDGE ||
    info.width * info.height > MAX_IMAGE_PIXELS
  ) {
    fail("image_project.too_large");
  }
  if (!Number.isInteger(info.layer_count) || info.layer_count < 1 || info.layer_count > MAX_LAYERS) {
    corrupt();
  }
  if (typeof info.editable !== "boolean") corrupt();
  if (!Array.isArray(info.unsupported_features) || info.unsupported_features.length > MAX_UNSUPPORTED_FEATURES) {
    corrupt();
  }
  for (const code of info.unsupported_features) {
    if (typeof code !== "string" || !FEATURE_CODE.test(code)) corrupt();
  }

  const extensions = info.extensions ?? [];
  if (!Array.isArray(extensions)) corrupt();
  if (extensions.length > MAX_PROJECT_EXTENSIONS) fail("image_project.too_large");
  const extensionNames = new Set<string>();
  const extensionPaths = new Set<string>();
  for (const extension of extensions) {
    validateDescriptor(validateExtension, extension);
    if (extensionNames.has(extension.name) || extensionPaths.has(extension.path)) corrupt();
    extensionNames.add(extension.name);
    extensionPaths.add(extension.path);
  }

  const metadataEntries = info.metadata_entries ?? [];
  if (!Array.isArray(metadataEntries)) corrupt();
  if (metadataEntries.length > MAX_PROJECT_METADATA_ENTRIES) {
    fail("image_project.too_large");
  }
  const metadataPaths = new Set<string>();
  const metadataCategories = new Set<string>();
  let metadataBytes = 0;
  for (const entry of metadataEntries) {
    validateDescriptor(validateMetadataEntry, entry);
    if (
      metadataPaths.has(entry.path) ||
      metadataCategories.has(entry.category) ||
      !PROJECT_METADATA_CATEGORY_SET.has(entry.category)
    ) {
      corrupt();
    }
    metadataPaths.add(entry.path);
    metadataCategories.add(entry.category);
    metadataBytes += entry.byte_len;
    if (metadataBytes > MAX_PROJECT_METADATA_BYTES) fail("image_project.too_large");
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function crossCheckManifest(manifest: ImageProjectManifest, info: ImageProjectOpenResult): void {
  if (manifest.project_id !== info.project_id) corrupt();
  if (manifest.width !== info.width || manifest.height !== info.height) corrupt();
  if (manifest.layers.length !== info.layer_count) corrupt();
  const editable = info.editable;
  if (!editable) {
    fail(
      info.unsupported_features.includes("required_extension")
        ? "image_project.unknown_required"
        : "image_project.unsupported_schema",
    );
  }
}

/** Every manifest tile is reachable through a layer, a mask or the original
 * set; that is where the tile position comes from. A stored tile without a
 * position cannot be published at the right place and is refused. */
function tilePositions(manifest: ImageProjectManifest): Map<string, { tile_x: number; tile_y: number }> {
  const positions = new Map<string, { tile_x: number; tile_y: number }>();
  const remember = (id: string, tileX: number, tileY: number) => {
    const known = positions.get(id);
    if (known && (known.tile_x !== tileX || known.tile_y !== tileY)) corrupt();
    positions.set(id, { tile_x: tileX, tile_y: tileY });
  };
  for (const layer of manifest.layers) {
    if (layer.kind !== "raster") continue;
    for (const tile of layer.tiles) remember(tile.id, tile.tile_x, tile.tile_y);
  }
  for (const mask of manifest.masks) {
    for (const tile of mask.tiles) remember(tile.id, tile.tile_x, tile.tile_y);
  }
  return positions;
}

function validateExtensions(
  manifest: ImageProjectManifest,
  payloads: ReadonlyMap<string, Uint8Array> | undefined,
): void {
  if (manifest.extensions.length === 0) {
    if (payloads && payloads.size > 0) corrupt();
    return;
  }
  const declared = new Set(manifest.extensions.map((extension) => extension.name));
  // A required extension is unknown to this app, so the project is read-only.
  if (manifest.extensions.some((extension) => extension.required)) fail("image_project.unknown_required");
  if (!payloads) {
    // Never open an archive whose optional bytes this build cannot load: the
    // next save would silently drop them. Refuse instead of degrading.
    fail("image_project.unsupported_schema");
  }
  let total = 0;
  for (const [name, bytes] of payloads) {
    if (!declared.has(name)) corrupt();
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_PROJECT_EXTENSION_BYTES) {
      fail("image_project.too_large");
    }
    total += bytes.byteLength;
    if (total > MAX_PROJECT_EXTENSIONS_BYTES) fail("image_project.too_large");
  }
  for (const extension of manifest.extensions) {
    const bytes = payloads.get(extension.name);
    if (!bytes || sha256Hex(bytes) !== extension.sha256) corrupt();
  }
}

/** Builds the live model from validated payloads. Every tile is published at
 * its manifest position; layer, mask and original references are rewritten to
 * the store identities. All failures happen before the model is returned. */
export async function assembleImageProjectModel(
  payloads: ImageProjectPayloads,
  info: ImageProjectOpenResult,
): Promise<ImageModel> {
  if (!payloads || typeof payloads !== "object") corrupt();
  if (!payloads.tiles || typeof payloads.tiles.get !== "function") corrupt();
  try {
    validateProjectManifest(payloads.manifest);
  } catch (error) {
    throw new Error(projectErrorCode(error));
  }
  crossCheckManifest(payloads.manifest, info);
  const manifest = payloads.manifest;

  const snapshot = payloads.source_snapshot;
  if (
    !snapshot ||
    typeof snapshot.snapshot_id !== "string" ||
    snapshot.snapshot_id.length === 0 ||
    snapshot.mime !== PROJECT_MIME ||
    !Number.isSafeInteger(snapshot.byte_len) ||
    snapshot.byte_len < 1
  ) {
    fail("image_project.changed");
  }

  validateExtensions(manifest, payloads.extensions);
  const positions = tilePositions(manifest);
  const store = getImageTileStore(info.project_id);
  const rgbaTiles = new Map<string, TileRef>();
  const alphaTiles = new Map<string, MaskTileRef>();
  let decodedBytes = 0;
  try {
    for (const tile of manifest.tiles) {
      const bytes = payloads.tiles.get(tile.id);
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== tile.raw_bytes) corrupt();
      decodedBytes += tile.raw_bytes;
      if (decodedBytes > MAX_PROJECT_DECODED_TILE_BYTES) fail("image_project.too_large");
      const position = positions.get(tile.id);
      if (!position) corrupt();
      if (tile.kind === "rgba") {
        const ref = await publishTileAt(store, position.tile_x, position.tile_y, tile.width, tile.height, bytes);
        if (ref.width !== tile.width || ref.height !== tile.height || ref.byte_len !== tile.raw_bytes) {
          fail("image_project.changed");
        }
        rgbaTiles.set(tile.id, ref);
      } else {
        const ref = await store.publishMask(tile.width, tile.height, bytes);
        if (ref.width !== tile.width || ref.height !== tile.height) fail("image_project.changed");
        alphaTiles.set(tile.id, { ...ref, tile_x: position.tile_x, tile_y: position.tile_y });
      }
    }
  } catch (error) {
    // Only tiles this assembly published are live in the store at this point.
    store.releaseUnreferenced([]);
    throw error;
  }

  const maskIds = new Map<string, string>();
  const masks: ImageMask[] = manifest.masks.map((mask) => {
    const id = newUuid();
    maskIds.set(mask.id, id);
    return {
      id,
      width: mask.width,
      height: mask.height,
      inverted: mask.inverted,
      tiles: mask.tiles.map((tile) => {
        const published = alphaTiles.get(tile.id);
        if (!published || published.width !== tile.width || published.height !== tile.height) corrupt();
        if (published.tile_x !== tile.tile_x || published.tile_y !== tile.tile_y) corrupt();
        return published;
      }),
    };
  });

  const layers: ImageLayer[] = manifest.layers.map((layer) => {
    let maskId: string | null = null;
    if (layer.mask_id !== null) {
      const mapped = maskIds.get(layer.mask_id);
      if (!mapped) corrupt();
      maskId = mapped;
    }
    if (layer.kind !== "raster") {
      return { ...cloneJson(layer), mask_id: maskId };
    }
    const tiles: TileRef[] = layer.tiles.map((tile) => {
      const published = rgbaTiles.get(tile.id);
      if (!published || published.width !== tile.width || published.height !== tile.height) corrupt();
      if (published.tile_x !== tile.tile_x || published.tile_y !== tile.tile_y) corrupt();
      return published;
    });
    return { ...cloneJson(layer), tiles, mask_id: maskId };
  });

  const originalTiles: TileRef[] = manifest.original_tile_ids.map((id) => {
    const published = rgbaTiles.get(id);
    if (!published) corrupt();
    return published;
  });

  const metadata: MetadataBlobRef[] = [];
  for (const entry of manifest.metadata_entries) {
    const bytes = payloads.metadata?.get(entry.category);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== entry.byte_len || sha256Hex(bytes) !== entry.sha256) {
      corrupt();
    }
    try {
      const ref = await publishImageMetadata(info.project_id, entry.category, bytes);
      if (ref.byte_len !== entry.byte_len || ref.sha256 !== entry.sha256) fail("image_project.changed");
      metadata.push(ref);
    } catch (error) {
      throw new Error(projectErrorCode(error));
    }
  }

  {
    let width = 0;
    let height = 0;
    for (const tile of originalTiles) {
      width = Math.max(width, tile.tile_x + tile.width);
      height = Math.max(height, tile.tile_y + tile.height);
    }
    if (width !== manifest.width || height !== manifest.height) corrupt();
  }
  const model: ImageModel = {
    schema_version: 1,
    document_id: info.project_id,
    content_id: newUuid(),
    width: manifest.width,
    height: manifest.height,
    source_snapshot: snapshot,
    original_tiles: originalTiles,
    layers,
    masks,
    geometry: cloneJson(manifest.geometry),
    adjustments: cloneJson(manifest.adjustments),
    overlays: cloneJson(manifest.overlays),
    metadata,
  };
  try {
    validateLayerModel(model);
  } catch (error) {
    throw new Error(projectErrorCode(error));
  }
  return model;
}

/** E3 importer body: validates the native result, then requires a trusted
 * payload source. No source means no model: refuse, never flatten. */
export async function importImageProject(
  input: ConversionInput,
  info: ImageProjectOpenResult,
  sourceSnapshot?: ExportSnapshot,
): Promise<ImageModel> {
  validateImageProjectOpenResult(info);
  if (!info.editable) {
    fail(
      info.unsupported_features.includes("required_extension")
        ? "image_project.unknown_required"
        : "image_project.unsupported_schema",
    );
  }
  if (!input || (input.kind !== "file" && input.kind !== "snapshot")) fail("image_project.bad_request");
  const source = payloadSource;
  if (!source) fail("image_project.failed");
  const payloads = await source(input, info, sourceSnapshot);
  if (!payloads) fail("image_project.failed");
  return assembleImageProjectModel(payloads, info);
}

let installed = false;

/** Registers the one trusted importer and the optional-extension loader.
 * Idempotent; the returned function removes this module's registrations. */
export function installImageProjectImporter(): () => void {
  if (installed) return () => undefined;
  installed = true;
  const removeImporter = registerImageProjectImporter(importImageProject);
  const removePayloadSource = registerImageProjectPayloadSource(resolveImageProjectPayloads);
  registerProjectExtensionPayloadLoader(async (input, info, sourceSnapshot) => {
    validateImageProjectOpenResult(info);
    const source = payloadSource;
    if (!source) fail("image_project.failed");
    const payloads = await source(input, info, sourceSnapshot);
    if (!payloads || !payloads.extensions) fail("image_project.unsupported_schema");
    return payloads.extensions;
  });
  return () => {
    installed = false;
    removeImporter();
    removePayloadSource();
    registerProjectExtensionPayloadLoader(null);
  };
}

function releaseOpenProject(documentId: string): void {
  disposeImageTileStore(documentId);
  disposeImageMetadata(documentId);
  forgetProjectExtensions(documentId);
  clearImageProjectSettings(documentId);
}

/** 09a controller factory body for the `image-project` handler.
 *
 * The archive is opened exactly like `decodeImageProject`, but the assembled
 * model is bound to the opened document id instead of the project id stored in
 * the archive. The one image controller, tile and metadata stores and the 08a
 * capture then share one identity, so the editor and Save copy can use the
 * shared document state. The captured source snapshot is kept unchanged; only
 * the model identity is rebound. */
export async function openImageProjectDocument(
  context: DocumentControllerContext,
  document: DocumentHandle,
): Promise<DocumentControllerBinding> {
  if (document.info.mime !== PROJECT_MIME || document.info.ext.toLowerCase() !== "adimage") {
    fail("image_project.bad_request");
  }
  const documentId = document.info.document_id;
  if (!isUuid(context.document_id) || !isUuid(documentId) || context.document_id !== documentId) {
    fail("image_project.bad_request");
  }
  installImageProjectImporter();
  // The project archive becomes an exact 08a capture first: a sensitive
  // document stays memory-only, and the native open and payload jobs both
  // resolve the same immutable identity instead of a path.
  let snapshot: ExportSnapshot;
  try {
    snapshot = await document.captureSnapshot();
  } catch (error) {
    throw new Error(projectErrorCode(error));
  }
  if (snapshot.document_id !== documentId) {
    await releaseExportSnapshot(snapshot.snapshot_id).catch(() => undefined);
    fail("image_project.changed");
  }
  const input: ConversionInput = {
    kind: "snapshot",
    snapshot_id: snapshot.snapshot_id,
    document_id: snapshot.document_id,
    revision: snapshot.revision,
  };
  let controller: ImageController | null = null;
  try {
    const job = await openImageProjectDetailed(input);
    const info = await job.completion;
    validateImageProjectOpenResult(info);
    if (!info.editable) {
      fail(
        info.unsupported_features.includes("required_extension")
          ? "image_project.unknown_required"
          : "image_project.unsupported_schema",
      );
    }
    const payloads = await resolveImageProjectPayloads(input, info, snapshot);
    const boundInfo: ImageProjectOpenResult = { ...info, project_id: documentId };
    const manifest: ImageProjectManifest = { ...payloads.manifest, project_id: documentId };
    const model = await assembleImageProjectModel({ ...payloads, manifest }, boundInfo);
    if (
      model.document_id !== documentId ||
      model.source_snapshot.document_id !== documentId ||
      model.width !== info.width ||
      model.height !== info.height ||
      model.layers.length !== info.layer_count
    ) {
      fail("image_project.changed");
    }
    rememberProjectExtensions(documentId, info.extensions ?? [], payloads.extensions);
    setImageProjectSettings(documentId, {
      guides: payloads.manifest.guides,
      dpi: payloads.manifest.dpi,
    });
    const acquired = await acquireImageEditorForModel(document, model);
    controller = acquired;
    return imageControllerBinding(context, acquired);
  } catch (error) {
    if (controller) controller.release();
    else releaseOpenProject(documentId);
    await releaseExportSnapshot(snapshot.snapshot_id).catch(() => undefined);
    throw new Error(projectErrorCode(error));
  }
}
