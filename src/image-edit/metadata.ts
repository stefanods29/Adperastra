import type { MetadataCategory } from "../convert/types";
import { fail, MAX_METADATA_BYTES, MAX_METADATA_ENTRIES, newUuid, type MetadataBlobRef } from "./types";

/** E8: image-local immutable metadata blobs. Nothing here is ever written to
 * disk by the UI; a sensitive document's bytes stay in memory. The 16 MiB
 * per-document budget and the entry count are checked before copying. */

const SUPPORTED: readonly MetadataCategory[] = [
  "exif",
  "gps",
  "camera",
  "date",
  "icc",
  "xmp",
  "iptc",
  "author",
  "comments",
  "attachments",
  "forms",
  "annotations",
  "scripts",
  "timestamps",
];

interface DocumentMetadata {
  blobs: Map<string, { ref: MetadataBlobRef; bytes: Uint8Array }>;
  total: number;
}

const documents = new Map<string, DocumentMetadata>();

function documentStore(documentId: string, create: boolean): DocumentMetadata | null {
  if (typeof documentId !== "string" || documentId.length === 0) fail("image_edit.bad_request");
  const existing = documents.get(documentId);
  if (existing) return existing;
  if (!create) return null;
  const created: DocumentMetadata = { blobs: new Map(), total: 0 };
  documents.set(documentId, created);
  return created;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("image_edit.failed");
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await subtle.digest("SHA-256", buffer);
  return toHex(digest);
}

export async function publishImageMetadata(
  documentId: string,
  category: MetadataCategory,
  bytes: Uint8Array,
): Promise<MetadataBlobRef> {
  if (!SUPPORTED.includes(category)) fail("image_edit.bad_request");
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) fail("image_edit.bad_request");
  if (bytes.byteLength > MAX_METADATA_BYTES) fail("image_edit.too_large");
  const store = documentStore(documentId, true) as DocumentMetadata;
  if (store.blobs.size >= MAX_METADATA_ENTRIES) fail("image_edit.too_large");
  if (store.total + bytes.byteLength > MAX_METADATA_BYTES) fail("image_edit.too_large");
  const copy = new Uint8Array(bytes);
  const ref: MetadataBlobRef = {
    id: newUuid(),
    category,
    byte_len: copy.byteLength,
    sha256: await sha256(copy),
  };
  // Re-check after the async hash: no other publication may have consumed
  // the remaining budget while this call was waiting.
  if (store.total + copy.byteLength > MAX_METADATA_BYTES) fail("image_edit.too_large");
  store.blobs.set(ref.id, { ref, bytes: copy });
  store.total += copy.byteLength;
  return { ...ref };
}

export async function readImageMetadata(documentId: string, id: string): Promise<Uint8Array> {
  const store = documentStore(documentId, false);
  if (!store) fail("image_edit.bad_request");
  const blob = store.blobs.get(id);
  if (!blob) fail("image_edit.bad_request");
  return new Uint8Array(blob.bytes);
}

export function listImageMetadata(documentId: string): MetadataBlobRef[] {
  const store = documentStore(documentId, false);
  if (!store) return [];
  return [...store.blobs.values()].map((blob) => ({ ...blob.ref }));
}

/** Last controller release; memory is simply dropped. */
export function disposeImageMetadata(documentId: string): void {
  documents.delete(documentId);
}
