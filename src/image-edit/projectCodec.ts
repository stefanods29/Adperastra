import type { ConversionInput } from "../convert/types";
import type { MetadataCategory } from "../convert/types";
import { readImageMetadata } from "./metadata";
import { getImageTileStore } from "./tiles";
import {
  MAX_PROJECT_ARCHIVE_BYTES,
  MAX_PROJECT_DECODED_TILE_BYTES,
  MAX_PROJECT_EXTENSION_BYTES,
  MAX_PROJECT_EXTENSIONS,
  MAX_PROJECT_EXTENSIONS_BYTES,
  MAX_PROJECT_JSON_BYTES,
  PROJECT_MIME,
  PROJECT_SCHEMA_VERSION,
  isProjectExtensionName,
  projectErrorCode,
  projectIdOf,
  validateProjectManifest,
  type ImageProjectInfo,
  type ImageProjectManifest,
  type ImageProjectOpenResult,
  type ProjectExtension,
  type ProjectMetadataEntry,
  type ProjectTile,
} from "./projectTypes";
import { validateDpi, validateGuides, type Guide } from "./guides";
import { openImageProjectDetailed } from "../services/imageProjects";
import { releaseExportSnapshot, uploadSnapshot } from "../services/exportSnapshots";
import type { ExportSnapshot } from "../services/exportSnapshots";
import { fail, isUuid, sourceSizeOf, type ImageModel, type MaskTileRef, type TileRef } from "./types";

/** Editable project codec (Step 18b T5/E3, `image-project-1`).
 *
 * The archive is a guarded ZIP: `document.json`, `tiles/<uuid>.rgba.zst`,
 * `masks/<uuid>.alpha.zst`, optional `metadata/<category>.bin` and opaque
 * `extensions/<name>.bin`. Tile bytes are zstd frames written without a
 * second ZIP compression layer. The writer here is deterministic and stored
 * (no deflate); the native validator accepts stored entries and deflated
 * JSON/metadata. No file bytes ever travel through invoke JSON: the finished
 * archive goes through the 08a snapshot upload in <=1 MiB chunks.
 */

/* ------------------------------- SHA-256 -------------------------------- */

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** Standard SHA-256 over bytes. Used for tile/metadata/extension descriptors
 * and checked in the tests against known vectors; no WebCrypto dependency so
 * the codec also runs in the test environment. */
export function sha256Hex(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) fail("image_project.bad_request");
  const bitLength = bytes.byteLength * 8;
  const bitLengthHigh = Math.floor(bytes.byteLength / 0x20000000) >>> 0;
  const bitLengthLow = bitLength >>> 0;
  const padded = new Uint8Array(((bytes.byteLength + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.byteLength] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.byteLength - 8, bitLengthHigh);
  view.setUint32(padded.byteLength - 4, bitLengthLow);
  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < padded.byteLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const w15 = words[index - 15];
      const w2 = words[index - 2];
      const s0 = rotr(w15, 7) ^ rotr(w15, 18) ^ (w15 >>> 3);
      const s1 = rotr(w2, 17) ^ rotr(w2, 19) ^ (w2 >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) >>> 0;
    }
    let a = state[0];
    let b = state[1];
    let c = state[2];
    let d = state[3];
    let e = state[4];
    let f = state[5];
    let g = state[6];
    let h = state[7];
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + SHA256_K[index] + words[index]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }
  return [...state].map((value) => value.toString(16).padStart(8, "0")).join("");
}

/* ---------------------------- zstd frame -------------------------------- */

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd];
const ZSTD_BLOCK_BYTES = 128 * 1024;

/** A valid zstd frame with raw or RLE blocks. Storing without a second
 * compression layer is required by D6; the native side may re-encode with its
 * zstd encoder, but every frame written here is accepted by zstd 0.14. */
export function writeZstdFrame(raw: Uint8Array): Uint8Array {
  if (!(raw instanceof Uint8Array)) fail("image_project.bad_request");
  if (raw.byteLength > 0xffffffff) fail("image_project.too_large");
  const blocks: Uint8Array[] = [];
  if (raw.byteLength === 0) {
    blocks.push(new Uint8Array([1, 0, 0]));
  } else {
    for (let offset = 0; offset < raw.byteLength; offset += ZSTD_BLOCK_BYTES) {
      const end = Math.min(raw.byteLength, offset + ZSTD_BLOCK_BYTES);
      const length = end - offset;
      const last = end >= raw.byteLength ? 1 : 0;
      const block = raw.subarray(offset, end);
      let uniform = true;
      for (let index = 1; index < block.length; index += 1) {
        if (block[index] !== block[0]) {
          uniform = false;
          break;
        }
      }
      const header = last | (uniform ? 1 << 1 : 0) | (length << 3);
      if (uniform) {
        blocks.push(new Uint8Array([header & 0xff, (header >>> 8) & 0xff, (header >>> 16) & 0xff, block[0]]));
      } else {
        const chunk = new Uint8Array(3 + length);
        chunk[0] = header & 0xff;
        chunk[1] = (header >>> 8) & 0xff;
        chunk[2] = (header >>> 16) & 0xff;
        chunk.set(block, 3);
        blocks.push(chunk);
      }
    }
  }
  let total = 9;
  for (const block of blocks) total += block.byteLength;
  const output = new Uint8Array(total);
  output.set(ZSTD_MAGIC, 0);
  output[4] = 0xa0; // single segment, 4-byte content size
  new DataView(output.buffer).setUint32(5, raw.byteLength, true);
  let offset = 9;
  for (const block of blocks) {
    output.set(block, offset);
    offset += block.byteLength;
  }
  return output;
}

/* -------------------------------- ZIP ----------------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

export interface ProjectArchiveEntry {
  name: string;
  bytes: Uint8Array;
}

/** Deterministic stored ZIP. The native guarded reader verifies the central
 * directory and every entry; there are no directory entries, symlinks or
 * extra fields. Sizes are computed first, then written into one buffer so a
 * large project never becomes a JavaScript number array. */
export function writeStoredZip(entries: readonly ProjectArchiveEntry[]): Uint8Array {
  if (!Array.isArray(entries) || entries.length === 0) fail("image_project.bad_request");
  if (entries.length > 0xffff) fail("image_project.too_large");
  const names = new Set<string>();
  const encoder = new TextEncoder();
  const encoded: Uint8Array[] = [];
  let localSize = 0;
  let centralSize = 0;
  for (const entry of entries) {
    if (typeof entry.name !== "string" || entry.name.length === 0 || names.has(entry.name)) {
      fail("image_project.bad_request");
    }
    names.add(entry.name);
    if (!(entry.bytes instanceof Uint8Array)) fail("image_project.bad_request");
    if (!/^[\x20-\x7e]+$/.test(entry.name)) fail("image_project.bad_request");
    const name = encoder.encode(entry.name);
    encoded.push(name);
    localSize += 30 + name.byteLength + entry.bytes.byteLength;
    centralSize += 46 + name.byteLength;
    if (localSize + centralSize + 22 > MAX_PROJECT_ARCHIVE_BYTES) fail("image_project.too_large");
  }
  const total = localSize + centralSize + 22;
  const output = new Uint8Array(total);
  const view = new DataView(output.buffer);
  let offset = 0;
  const offsets: number[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const name = encoded[index];
    const checksum = crc32(entry.bytes);
    offsets.push(offset);
    view.setUint32(offset, 0x04034b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 0x0800, true);
    view.setUint16(offset + 8, 0, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, 0x21, true); // 1980-01-01
    view.setUint32(offset + 14, checksum, true);
    view.setUint32(offset + 18, entry.bytes.byteLength, true);
    view.setUint32(offset + 22, entry.bytes.byteLength, true);
    view.setUint16(offset + 26, name.byteLength, true);
    view.setUint16(offset + 28, 0, true);
    output.set(name, offset + 30);
    output.set(entry.bytes, offset + 30 + name.byteLength);
    offset += 30 + name.byteLength + entry.bytes.byteLength;
  }
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const name = encoded[index];
    const checksum = crc32(entry.bytes);
    view.setUint32(offset, 0x02014b50, true);
    view.setUint16(offset + 4, 20, true);
    view.setUint16(offset + 6, 20, true);
    view.setUint16(offset + 8, 0x0800, true);
    view.setUint16(offset + 10, 0, true);
    view.setUint16(offset + 12, 0, true);
    view.setUint16(offset + 14, 0x21, true);
    view.setUint32(offset + 16, checksum, true);
    view.setUint32(offset + 20, entry.bytes.byteLength, true);
    view.setUint32(offset + 24, entry.bytes.byteLength, true);
    view.setUint16(offset + 28, name.byteLength, true);
    view.setUint16(offset + 30, 0, true);
    view.setUint16(offset + 32, 0, true);
    view.setUint16(offset + 34, 0, true);
    view.setUint16(offset + 36, 0, true);
    view.setUint32(offset + 38, 0, true);
    view.setUint32(offset + 42, offsets[index], true);
    output.set(name, offset + 46);
    offset += 46 + name.byteLength;
  }
  view.setUint32(offset, 0x06054b50, true);
  view.setUint16(offset + 4, 0, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, entries.length, true);
  view.setUint16(offset + 10, entries.length, true);
  view.setUint32(offset + 12, centralSize, true);
  view.setUint32(offset + 16, localSize, true);
  view.setUint16(offset + 20, 0, true);
  return output;
}

/* ---------------------------- payload collection ------------------------ */

export interface ProjectPayloads {
  tiles: Map<string, Uint8Array>;
  metadata: Map<MetadataCategory, Uint8Array>;
  extensions: Map<string, { required: boolean; bytes: Uint8Array }>;
}

interface TileDescriptorDraft {
  id: string;
  kind: "rgba" | "alpha";
  width: number;
  height: number;
  raw_bytes: number;
}

function describeTile(ref: TileRef | MaskTileRef, kind: "rgba" | "alpha"): TileDescriptorDraft {
  const raw = kind === "rgba" ? ref.width * ref.height * 4 : ref.width * ref.height;
  return { id: ref.id, kind, width: ref.width, height: ref.height, raw_bytes: raw };
}

/** Reads exactly the immutable tile identities of the model; no current
 * revision or source path is consulted. */
export async function collectProjectPayloads(model: Readonly<ImageModel>): Promise<ProjectPayloads> {
  if (!model || !isUuid(model.document_id)) fail("image_project.bad_request");
  const store = getImageTileStore(model.document_id);
  const descriptors = new Map<string, TileDescriptorDraft>();
  const tiles = new Map<string, Uint8Array>();
  const add = async (ref: TileRef | MaskTileRef, kind: "rgba" | "alpha") => {
    const next = describeTile(ref, kind);
    const known = descriptors.get(ref.id);
    if (known && (known.kind !== next.kind || known.width !== next.width || known.height !== next.height)) {
      fail("image_project.bad_request");
    }
    if (known) return;
    const bytes = await store.read(ref.id);
    if (bytes.byteLength !== next.raw_bytes) fail("image_project.bad_request");
    descriptors.set(ref.id, next);
    tiles.set(ref.id, bytes);
  };
  for (const tile of model.original_tiles) await add(tile, "rgba");
  for (const layer of model.layers) {
    if (layer.kind === "raster") for (const tile of layer.tiles) await add(tile, "rgba");
  }
  for (const mask of model.masks) for (const tile of mask.tiles) await add(tile, "alpha");
  if (tiles.size === 0) fail("image_project.bad_request");
  let decoded = 0;
  for (const descriptor of descriptors.values()) decoded += descriptor.raw_bytes;
  if (decoded > MAX_PROJECT_DECODED_TILE_BYTES) fail("image_project.too_large");
  const metadata = new Map<MetadataCategory, Uint8Array>();
  for (const blob of model.metadata) {
    if (metadata.has(blob.category)) {
      // The entry name is metadata/<category>.bin; a second blob of the same
      // category has no distinct name in the guarded allowlist.
      fail("image_project.bad_request");
    }
    const bytes = await readImageMetadata(model.document_id, blob.id);
    if (bytes.byteLength !== blob.byte_len) fail("image_project.bad_request");
    metadata.set(blob.category, bytes);
  }
  return { tiles, metadata, extensions: new Map() };
}

/* ---------------------------- extension memory -------------------------- */

interface PreservedExtension {
  name: string;
  required: boolean;
  bytes?: Uint8Array;
}

const preservedExtensions = new Map<string, PreservedExtension[]>();

/** Remembers unknown extension descriptors from an opened project. If bytes
 * are unavailable, saving refuses instead of silently dropping them. */
export function rememberProjectExtensions(
  projectId: string,
  extensions: readonly ProjectExtension[],
  payloads?: ReadonlyMap<string, Uint8Array>,
): void {
  if (!isUuid(projectId)) fail("image_project.bad_request");
  if (extensions.length === 0) {
    preservedExtensions.delete(projectId);
    return;
  }
  if (extensions.length > MAX_PROJECT_EXTENSIONS) fail("image_project.too_large");
  let total = 0;
  const stored: PreservedExtension[] = [];
  const seen = new Set<string>();
  for (const extension of extensions) {
    if (!isProjectExtensionName(extension.name) || typeof extension.required !== "boolean") {
      fail("image_project.bad_request");
    }
    if (seen.has(extension.name)) fail("image_project.bad_request");
    seen.add(extension.name);
    const bytes = payloads?.get(extension.name);
    if (bytes) {
      if (bytes.byteLength > MAX_PROJECT_EXTENSION_BYTES) fail("image_project.too_large");
      total += bytes.byteLength;
      if (total > MAX_PROJECT_EXTENSIONS_BYTES) fail("image_project.too_large");
      stored.push({ name: extension.name, required: extension.required, bytes: new Uint8Array(bytes) });
    } else {
      stored.push({ name: extension.name, required: extension.required });
    }
  }
  preservedExtensions.set(projectId, stored);
}

export function forgetProjectExtensions(projectId: string): void {
  preservedExtensions.delete(projectId);
}

/* ------------------------------ manifest -------------------------------- */

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Builds the manifest and deterministic archive from the immutable model.
 * The returned snapshot identity is not part of the manifest. */
export async function buildProjectArchive(
  model: Readonly<ImageModel>,
  capturedRevision: number,
  guides: readonly Guide[],
  dpi: number,
  payloads: ProjectPayloads,
): Promise<{ bytes: Uint8Array; manifest: ImageProjectManifest }> {
  if (!Number.isSafeInteger(capturedRevision) || capturedRevision < 1) fail("image_project.bad_request");
  validateDpi(dpi);
  const sourceSize = sourceSizeOf(model);
  validateGuides(guides, sourceSize.width, sourceSize.height);
  const descriptors = new Map<string, TileDescriptorDraft>();
  const collectRef = (ref: TileRef | MaskTileRef, kind: "rgba" | "alpha") => {
    const next = describeTile(ref, kind);
    const known = descriptors.get(ref.id);
    if (known && (known.kind !== next.kind || known.width !== next.width || known.height !== next.height)) {
      fail("image_project.bad_request");
    }
    if (!known) descriptors.set(ref.id, next);
  };
  for (const ref of model.original_tiles) collectRef(ref, "rgba");
  for (const layer of model.layers) if (layer.kind === "raster") for (const ref of layer.tiles) collectRef(ref, "rgba");
  for (const mask of model.masks) for (const ref of mask.tiles) collectRef(ref, "alpha");

  const tiles: ProjectTile[] = [];
  const compressedTiles = new Map<string, Uint8Array>();
  for (const [id, descriptor] of descriptors) {
    const raw = payloads.tiles.get(id);
    if (!raw || raw.byteLength !== descriptor.raw_bytes) fail("image_project.bad_request");
    const compressed = writeZstdFrame(raw);
    if (compressed.byteLength > 2 * 256 * 1024 + 64 * 1024) fail("image_project.too_large");
    compressedTiles.set(id, compressed);
    tiles.push({
      id,
      path: descriptor.kind === "rgba" ? `tiles/${id.toLowerCase()}.rgba.zst` : `masks/${id.toLowerCase()}.alpha.zst`,
      kind: descriptor.kind,
      width: descriptor.width,
      height: descriptor.height,
      raw_bytes: descriptor.raw_bytes,
      compressed_bytes: compressed.byteLength,
      sha256: sha256Hex(compressed),
    });
  }
  tiles.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  const metadata_entries: ProjectMetadataEntry[] = [];
  for (const [category, bytes] of payloads.metadata) {
    metadata_entries.push({
      category,
      path: `metadata/${category}.bin`,
      byte_len: bytes.byteLength,
      sha256: sha256Hex(bytes),
    });
  }
  metadata_entries.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  const extensionByName = new Map<string, PreservedExtension>();
  for (const [name, extension] of payloads.extensions) {
    if (!isProjectExtensionName(name)) fail("image_project.bad_request");
    if (typeof extension.required !== "boolean" || !(extension.bytes instanceof Uint8Array)) {
      fail("image_project.bad_request");
    }
    if (extension.bytes.byteLength > MAX_PROJECT_EXTENSION_BYTES) fail("image_project.too_large");
    extensionByName.set(name, {
      name,
      required: extension.required,
      bytes: new Uint8Array(extension.bytes),
    });
  }
  for (const extension of preservedExtensions.get(model.document_id) ?? []) {
    if (!isProjectExtensionName(extension.name) || typeof extension.required !== "boolean") {
      fail("image_project.bad_request");
    }
    if (extensionByName.has(extension.name)) fail("image_project.bad_request");
    if (extension.bytes && extension.bytes.byteLength > MAX_PROJECT_EXTENSION_BYTES) {
      fail("image_project.too_large");
    }
    extensionByName.set(extension.name, {
      name: extension.name,
      required: extension.required,
      ...(extension.bytes ? { bytes: new Uint8Array(extension.bytes) } : {}),
    });
  }
  if (extensionByName.size > MAX_PROJECT_EXTENSIONS) fail("image_project.too_large");
  let extensionBytes = 0;
  const extensions: ProjectExtension[] = [];
  const extensionPayloads: PreservedExtension[] = [];
  for (const extension of extensionByName.values()) {
    if (extension.required) {
      // A required extension is unknown to this app; the project stays read-only.
      fail("image_project.unknown_required");
    }
    if (!extension.bytes) {
      // The native open result carries descriptors only; never drop an
      // unknown optional extension silently.
      fail("image_project.unsupported_schema");
    }
    extensionBytes += extension.bytes.byteLength;
    if (extensionBytes > MAX_PROJECT_EXTENSIONS_BYTES) fail("image_project.too_large");
    extensionPayloads.push(extension);
    extensions.push({
      name: extension.name,
      required: extension.required,
      path: `extensions/${extension.name}.bin`,
      sha256: sha256Hex(extension.bytes),
    });
  }
  extensions.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));

  const manifest: ImageProjectManifest = {
    schema_version: PROJECT_SCHEMA_VERSION,
    project_id: projectIdOf(model),
    width: sourceSize.width,
    height: sourceSize.height,
    dpi,
    layers: cloneJson(model.layers),
    masks: cloneJson(model.masks),
    geometry: cloneJson(model.geometry),
    adjustments: cloneJson(model.adjustments),
    overlays: cloneJson(model.overlays),
    tiles,
    original_tile_ids: [...new Set(model.original_tiles.map((tile) => tile.id))],
    guides: guides.map((guide) => ({ ...guide })),
    metadata_entries,
    extensions,
  };
  validateProjectManifest(manifest);
  const documentJson = new TextEncoder().encode(JSON.stringify(manifest));
  if (documentJson.byteLength > MAX_PROJECT_JSON_BYTES) fail("image_project.too_large");

  const entries: ProjectArchiveEntry[] = [{ name: "document.json", bytes: documentJson }];
  for (const tile of tiles) {
    const compressed = compressedTiles.get(tile.id);
    if (!compressed) fail("image_project.failed");
    if (compressed.byteLength !== tile.compressed_bytes || sha256Hex(compressed) !== tile.sha256) {
      fail("image_project.failed");
    }
    entries.push({ name: tile.path, bytes: compressed });
  }
  for (const [category, bytes] of payloads.metadata) entries.push({ name: `metadata/${category}.bin`, bytes });
  for (const extension of extensionPayloads) {
    if (!extension.bytes) fail("image_project.unsupported_schema");
    entries.push({ name: `extensions/${extension.name}.bin`, bytes: extension.bytes });
  }
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  const bytes = writeStoredZip(entries);
  assertProjectArchiveSize(bytes.byteLength);
  if (entries[0].name !== "document.json") fail("image_project.failed");
  return { bytes, manifest };
}

export function assertProjectArchiveSize(byteLength: number): void {
  if (!Number.isSafeInteger(byteLength) || byteLength < 1) fail("image_project.bad_request");
  if (byteLength > MAX_PROJECT_ARCHIVE_BYTES) fail("image_project.too_large");
}

/* ------------------------------- encode --------------------------------- */

function verifySnapshot(snapshot: ExportSnapshot, model: Readonly<ImageModel>, revision: number, byteLength: number): void {
  if (
    snapshot.document_id !== model.document_id ||
    snapshot.content_id !== model.content_id ||
    snapshot.revision !== revision ||
    snapshot.byte_len !== byteLength ||
    snapshot.mime !== PROJECT_MIME
  ) {
    fail("image_project.changed");
  }
}

/** E3: one immutable project capture at `capturedRevision`, uploaded through
 * the 08a snapshot registry. Later edits cannot change the encoded revision. */
export async function encodeImageProject(
  model: Readonly<ImageModel>,
  capturedRevision: number,
  guides: readonly Guide[],
  dpi: number,
): Promise<ExportSnapshot> {
  if (!Number.isSafeInteger(capturedRevision) || capturedRevision < 1) fail("image_project.bad_request");
  validateDpi(dpi);
  if (!model || !isUuid(model.document_id) || !isUuid(model.content_id)) fail("image_project.bad_request");
  try {
    const payloads = await collectProjectPayloads(model);
    const { bytes } = await buildProjectArchive(model, capturedRevision, guides, dpi, payloads);
    const snapshot = await uploadSnapshot(
      {
        document_id: model.document_id,
        revision: capturedRevision,
        content_id: model.content_id,
        mime: PROJECT_MIME,
        byte_len: bytes.byteLength,
      },
      bytes,
    );
    try {
      verifySnapshot(snapshot, model, capturedRevision, bytes.byteLength);
    } catch (error) {
      // The finalized snapshot belongs to another identity; do not keep it.
      await releaseExportSnapshot(snapshot.snapshot_id).catch(() => undefined);
      throw error;
    }
    return snapshot;
  } catch (error) {
    throw new Error(projectErrorCode(error));
  }
}

/* ------------------------------- decode --------------------------------- */

export type ImageProjectImporter = (
  input: ConversionInput,
  info: ImageProjectOpenResult,
  sourceSnapshot?: ExportSnapshot,
) => Promise<ImageModel>;

let importer: ImageProjectImporter | null = null;

/** Trusted static registration: the native project provider installs the one
 * function that turns its opened, validated archive into the live model. */
export function registerImageProjectImporter(next: ImageProjectImporter): () => void {
  if (typeof next !== "function") fail("image_project.bad_request");
  importer = next;
  return () => {
    if (importer === next) importer = null;
  };
}

/** Optional bounded reader for opaque optional-extension payloads. The native
 * guarded archive reader owns the bytes; it registers this once so an opened
 * project can be re-saved byte-for-byte from the same validated page channel.
 * Every returned buffer is copied and checked against the per-extension and
 * total limits. */
export type ProjectExtensionPayloadLoader = (
  input: ConversionInput,
  info: ImageProjectOpenResult,
  sourceSnapshot?: ExportSnapshot,
) => Promise<ReadonlyMap<string, Uint8Array>>;

let extensionPayloadLoader: ProjectExtensionPayloadLoader | null = null;

export function registerProjectExtensionPayloadLoader(
  loader: ProjectExtensionPayloadLoader | null,
): void {
  if (loader !== null && typeof loader !== "function") fail("image_project.bad_request");
  extensionPayloadLoader = loader;
}

async function loadExtensionPayloads(
  input: ConversionInput,
  info: ImageProjectOpenResult,
  sourceSnapshot?: ExportSnapshot,
): Promise<ReadonlyMap<string, Uint8Array> | undefined> {
  const extensions = info.extensions ?? [];
  if (extensions.length === 0 || extensionPayloadLoader === null) return undefined;
  const payloads = await extensionPayloadLoader(input, info, sourceSnapshot);
  if (!payloads || typeof payloads !== "object") fail("image_project.corrupt");
  const declared = new Set(extensions.map((extension) => extension.name));
  let total = 0;
  for (const [name, bytes] of payloads) {
    if (!declared.has(name)) fail("image_project.corrupt");
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_PROJECT_EXTENSION_BYTES) {
      fail("image_project.too_large");
    }
    total += bytes.byteLength;
    if (total > MAX_PROJECT_EXTENSIONS_BYTES) fail("image_project.too_large");
  }
  return payloads;
}

function validateLoadedModel(model: ImageModel, info: ImageProjectOpenResult): void {
  if (!model || model.schema_version !== 1) fail("image_project.corrupt");
  if (model.document_id !== info.project_id) fail("image_project.changed");
  if (!isUuid(model.content_id)) fail("image_project.corrupt");
  if (model.width !== info.width || model.height !== info.height) fail("image_project.corrupt");
  if (model.layers.length !== info.layer_count) fail("image_project.corrupt");
}

/** E3 decode: the native open job validates the guarded archive; the trusted
 * importer supplies the live model whose tiles it published. The optional
 * source snapshot is required for a file input and ignored for a snapshot
 * input, whose exact 08a descriptor comes back from the native payload job. */
export async function decodeImageProject(
  input: ConversionInput,
  sourceSnapshot?: ExportSnapshot,
): Promise<ImageModel> {
  if (!input || (input.kind !== "file" && input.kind !== "snapshot")) fail("image_project.bad_request");
  const job = await openImageProjectDetailed(input);
  let info: ImageProjectOpenResult;
  try {
    info = await job.completion;
  } catch (error) {
    throw new Error(projectErrorCode(error));
  }
  if (!info.editable) {
    throw new Error(
      info.unsupported_features.includes("required_extension")
        ? "image_project.unknown_required"
        : "image_project.unsupported_schema",
    );
  }
  const load = importer;
  if (!load) fail("image_project.failed");
  let model: ImageModel;
  try {
    model = await load(input, info, sourceSnapshot);
  } catch (error) {
    throw new Error(projectErrorCode(error));
  }
  validateLoadedModel(model, info);
  let extensionPayloads: ReadonlyMap<string, Uint8Array> | undefined;
  try {
    extensionPayloads = await loadExtensionPayloads(input, info, sourceSnapshot);
  } catch (error) {
    throw new Error(projectErrorCode(error));
  }
  rememberProjectExtensions(info.project_id, info.extensions ?? [], extensionPayloads);
  return model;
}

/** Info-only helper for the handler and the project tab. */
export async function describeImageProject(input: ConversionInput): Promise<ImageProjectInfo> {
  const job = await openImageProjectDetailed(input);
  return job.completion;
}

/* --------------------------- flattened exports -------------------------- */

export interface FlattenedExportPlan {
  mime: "image/png" | "image/jpeg" | "image/webp";
  flatten_layers: true;
  include_guides: false;
}

/** Guides and layer editability never reach a flattened export. */
export function flattenedProjectExportPlan(mime: FlattenedExportPlan["mime"] = "image/png"): FlattenedExportPlan {
  if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/webp") fail("image_project.bad_request");
  return { mime, flatten_layers: true, include_guides: false };
}

/** Downloads the exact project bytes for the upload path in tests and for
 * diagnostics; never used by a UI command. */
export async function encodeProjectBytes(
  model: Readonly<ImageModel>,
  capturedRevision: number,
  guides: readonly Guide[],
  dpi: number,
): Promise<Uint8Array> {
  const payloads = await collectProjectPayloads(model);
  const { bytes } = await buildProjectArchive(model, capturedRevision, guides, dpi, payloads);
  return bytes;
}

/** Kept for callers that build a snapshot manually; the normal path is
 * `encodeImageProject`. */
export async function releaseEncodedProject(snapshotId: string): Promise<void> {
  await releaseExportSnapshot(snapshotId);
}

/** Not used by the writer, but exported so a future reader can assert the
 * same limits before allocating. */
export function projectJsonLimit(): number {
  return MAX_PROJECT_JSON_BYTES;
}
