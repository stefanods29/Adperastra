/** Document blocks for conversion (Step 08b E7).
 *
 * The trusted helper parses Markdown/HTML; this service only starts the
 * native job and reads bounded pages. No file bytes, raw markup or HTML
 * string crosses this module: blocks are plain data in the E6 shape.
 *
 * The native command names are `doc_blocks_start` and `doc_blocks_page`.
 * `doc_blocks_start` uses the shared Jobs transport and returns the first
 * bounded page; later pages continue with the opaque UUID cursor. */

import { invoke } from "@tauri-apps/api/core";
import type { ConversionInput } from "../convert/types";
import type { HtmlBlockPage } from "../convert/documentTypes";
import type { OpProgress } from "./fileops";
import { runJob, type JobHandle } from "./jobs";

/** Most blocks a page may carry, mirrored from E6. */
export const DOCUMENT_BLOCKS_PAGE_SIZE = 256;

/** Start reading one authorized document. The job's result is the first page. */
export async function readDocumentBlocks(
  input: ConversionInput,
  onProgress?: (progress: OpProgress) => void,
): Promise<JobHandle<HtmlBlockPage>> {
  return runJob<HtmlBlockPage>(
    "docblocks",
    (requestId) => invoke("doc_blocks_start", { requestId, input }),
    onProgress,
  );
}

/** Read the page after `cursor`; the cursor is native-issued and bounded. */
export async function readDocumentBlockPage(cursor: string): Promise<HtmlBlockPage> {
  return (await invoke("doc_blocks_page", { cursor })) as HtmlBlockPage;
}

/** Read every page of a small document (the caller still bounds the total). */
export async function readAllDocumentBlocks(input: ConversionInput): Promise<HtmlBlockPage> {
  const job = await readDocumentBlocks(input);
  const first = await job.completion;
  if (first.complete || !first.next_cursor) return first;
  const blocks = [...first.blocks];
  let cursor: string | null = first.next_cursor ?? null;
  let pages = 1;
  // 256 blocks per page and a caller-side cap of 4,096 pages keep this
  // bounded even for a malformed helper reply.
  while (cursor && pages < 4_096) {
    const page = await readDocumentBlockPage(cursor);
    blocks.push(...page.blocks);
    pages += 1;
    cursor = page.complete ? null : page.next_cursor ?? null;
  }
  return { blocks, next_cursor: null, complete: cursor === null };
}
