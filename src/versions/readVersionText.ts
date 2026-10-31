import { decodeText, detectEncoding } from "../handlers/text/encoding";
import { fileGrant, fileRevoke, fileUrl } from "../services/files";

/** The version window never reads more than 1 MiB for a text preview. */
export const VERSION_TEXT_PREVIEW_MAX = 1_048_576;

/** Range and stream limits also protect against a file growing after listing. */
export async function readVersionText(path: string, name: string, signal?: AbortSignal): Promise<string> {
  const token = await fileGrant(path);
  try {
    const response = await fetch(fileUrl(token, name), {
      signal,
      headers: { Range: `bytes=0-${VERSION_TEXT_PREVIEW_MAX}` },
    });
    if (!response.ok) throw new Error("versions.other");
    let bytes: Uint8Array;
    if (response.body) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          length += next.value.byteLength;
          if (length > VERSION_TEXT_PREVIEW_MAX) {
            await reader.cancel();
            throw new Error("versions.preview_too_large");
          }
          chunks.push(next.value);
        }
      } finally {
        reader.releaseLock();
      }
      bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
    } else {
      bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > VERSION_TEXT_PREVIEW_MAX) throw new Error("versions.preview_too_large");
    }
    return decodeText(bytes, detectEncoding(bytes).encoding);
  } finally {
    await fileRevoke(token);
  }
}
