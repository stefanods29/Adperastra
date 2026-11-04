import { Unzlib } from "fflate";

/** The decompression budget shared by one book session. `remaining_bytes` is
 * decremented exactly once, after a complete output has passed every cap. */
export interface BookDecodeBudget {
  remaining_bytes: number;
  cancelled: () => boolean;
}

/** The hard per-call output cap (D3, T3). */
export const MAX_SINGLE_OUTPUT_BYTES = 16 * 1024 * 1024;
/** The expansion ratio cap for one compressed input. */
export const MAX_EXPANSION_RATIO = 500;
/** How many compressed bytes one `push` receives. */
export const PUSH_CHUNK_BYTES = 1024;

/** Bounded streaming zlib for MOBI fonts and resources. `unzlibSync` is
 * never used: its output is allocated before any cap can be checked. */
export async function boundedUnzlib(
  input: Uint8Array,
  budget: BookDecodeBudget,
): Promise<Uint8Array> {
  if (!(input instanceof Uint8Array) || input.byteLength === 0) {
    throw new Error("extra_view.corrupt");
  }
  const cap = Math.min(
    MAX_SINGLE_OUTPUT_BYTES,
    MAX_EXPANSION_RATIO * input.byteLength,
    Math.max(0, budget.remaining_bytes),
  );
  if (cap <= 0) throw new Error("extra_view.too_large");
  const chunks: Uint8Array[] = [];
  let emitted = 0;
  let sawFinal = false;
  let failure: Error | null = null;
  const stream = new Unzlib((data, final) => {
    if (failure) return;
    if (budget.cancelled()) {
      failure = new Error("extra_view.changed");
      return;
    }
    if (!(data instanceof Uint8Array)) {
      failure = new Error("extra_view.corrupt");
      return;
    }
    const next = emitted + data.byteLength;
    if (next > cap) {
      failure = new Error("extra_view.too_large");
      return;
    }
    emitted = next;
    chunks.push(data);
    if (final) sawFinal = true;
  });

  for (let offset = 0; offset < input.byteLength; offset += PUSH_CHUNK_BYTES) {
    if (failure) break;
    if (budget.cancelled()) {
      failure = new Error("extra_view.changed");
      break;
    }
    const end = Math.min(input.byteLength, offset + PUSH_CHUNK_BYTES);
    try {
      stream.push(input.subarray(offset, end), end === input.byteLength);
    } catch {
      failure = new Error("extra_view.corrupt");
      break;
    }
  }
  if (failure) {
    chunks.length = 0;
    throw failure;
  }
  if (!sawFinal) {
    chunks.length = 0;
    throw new Error("extra_view.corrupt");
  }
  budget.remaining_bytes -= emitted;
  const output = new Uint8Array(emitted);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
