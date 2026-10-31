/** Searching a whole file through range reads (Step 06f D12): chunks of
 * 1 MiB with the needle's length minus one byte of overlap, so a match that
 * crosses two chunks is still found. Wraps around once. */

import { searchBytes } from "./search";

/** Bytes one read asks for. */
export const CHUNK_BYTES = 1024 * 1024;

export interface FindInFileOptions {
  size: number;
  needle: Uint8Array;
  /** The byte to start at (inclusive). */
  from: number;
  backwards: boolean;
  /** A to Z ignore case. */
  fold: boolean;
  read: (start: number, end: number) => Promise<Uint8Array>;
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
}

function aborted(): Error {
  return new DOMException("Aborted", "AbortError");
}

/** The absolute offset of the needle, or null. Rejects with an AbortError
 * when the signal stops the work. */
export async function findInFile(options: FindInFileOptions): Promise<number | null> {
  const { size, needle, from, backwards, fold, read, signal, onProgress } = options;
  if (needle.length === 0 || size === 0) return null;
  if (signal?.aborted) throw aborted();
  const overlap = needle.length - 1;
  const report = (scanned: number) => {
    if (onProgress) onProgress(Math.min(100, Math.floor((scanned / Math.max(1, size)) * 100)));
  };

  if (!backwards) {
    let start = Math.max(0, Math.min(from, size));
    while (start < size) {
      if (signal?.aborted) throw aborted();
      const end = Math.min(size, start + CHUNK_BYTES + overlap);
      const buffer = await read(start, end);
      if (signal?.aborted) throw aborted();
      const found = searchBytes(buffer, needle, 0, false, fold);
      if (found >= 0) return start + found;
      report(end);
      start += CHUNK_BYTES;
    }
    // Once around: from the beginning up to where the search started.
    const wrapEnd = Math.min(size, Math.max(0, from) + overlap);
    if (wrapEnd > 0) {
      if (signal?.aborted) throw aborted();
      const buffer = await read(0, wrapEnd);
      if (signal?.aborted) throw aborted();
      const found = searchBytes(buffer, needle, 0, false, fold);
      if (found >= 0) return found;
    }
    return null;
  }

  // Backwards: the chunk that holds `from`, then earlier chunks, then the end.
  const firstChunk = Math.max(
    0,
    Math.floor(Math.max(0, Math.min(from, size - 1)) / CHUNK_BYTES),
  );
  const scanChunk = async (chunk: number, limit: number | null): Promise<number | null> => {
    const start = chunk * CHUNK_BYTES;
    const end = Math.min(size, start + CHUNK_BYTES + overlap);
    if (signal?.aborted) throw aborted();
    const buffer = await read(start, end);
    if (signal?.aborted) throw aborted();
    let fromIndex = Math.min(CHUNK_BYTES - 1, buffer.length - 1);
    if (limit !== null) fromIndex = Math.min(fromIndex, limit - start);
    if (fromIndex < 0) return null;
    const found = searchBytes(buffer, needle, fromIndex, true, fold);
    if (found < 0) return null;
    report(size - start);
    return start + found;
  };
  for (let chunk = firstChunk; chunk >= 0; chunk -= 1) {
    const found = await scanChunk(chunk, chunk === firstChunk ? from : null);
    if (found !== null) return found;
  }
  const lastChunk = Math.max(0, Math.ceil(size / CHUNK_BYTES) - 1);
  for (let chunk = lastChunk; chunk > firstChunk; chunk -= 1) {
    const found = await scanChunk(chunk, null);
    if (found !== null) return found;
  }
  return null;
}
