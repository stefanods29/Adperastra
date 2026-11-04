import { invoke } from "@tauri-apps/api/core";
import type { CacheLease } from "./cache";
import { isTauriRuntime } from "./settings";
import { runJob, type JobHandle } from "./jobs";
import type {
  ConversionPreviewRequest,
  ConversionReport,
  ConversionRequest,
  ConversionWarningCode,
  MetadataCategory,
} from "../convert/types";

/** Typed wrappers for the Step 08a conversion jobs (E2). No component calls
 * `invoke` directly; bytes never travel through these calls. */

/** Mirrors native `ConversionPreview`; `image` is a leased memory result. */
export interface ConversionPreview {
  image: CacheLease;
  input_revision: number;
  width: number;
  height: number;
  estimated_bytes?: number;
  estimated_ms?: number;
  warnings: ConversionWarningCode[];
  metadata_lost: MetadataCategory[];
}

/** Start a conversion. The job's result is the first report page; later
 * pages come from `conversionPage(cursor)`. */
export async function startConversion(
  request: ConversionRequest,
  onProgress?: (progress: import("./fileops").OpProgress) => void,
): Promise<JobHandle<ConversionReport>> {
  return runJob<ConversionReport>(
    "convert",
    async (requestId) => {
      await invoke("convert_start", { requestId, request });
    },
    onProgress,
  );
}

/** Preview with the same options as the real conversion. */
export async function previewConversion(
  request: ConversionPreviewRequest,
): Promise<JobHandle<ConversionPreview>> {
  return runJob<ConversionPreview>("cvprev", async (requestId) => {
    await invoke("convert_preview_start", { requestId, request });
  });
}

/** The next page of a finished report. */
export async function conversionPage(cursor: string): Promise<ConversionReport> {
  if (!isTauriRuntime()) throw new Error("convert.io");
  return (await invoke("convert_report_page", { cursor })) as ConversionReport;
}

/** Collect every page of a report, in order, at most 40 requests. */
export async function collectReportPages(first: ConversionReport): Promise<ConversionReport[]> {
  const pages = [first];
  let page = first;
  while (page.next_cursor) {
    if (pages.length >= 40) throw new Error("convert.io");
    page = await conversionPage(page.next_cursor);
    pages.push(page);
  }
  return pages;
}

/** Collect every output row of a report (bounded by the 10,000 input cap).
 * Used for the one grouped Undo entry; the caller refreshes only these
 * actual created paths. */
export async function collectConversionOutputs(
  first: ConversionReport,
): Promise<{ outputs: ConversionReport["outputs"]; createdPaths: string[]; cancelled: boolean }> {
  const outputs = [...first.outputs];
  const createdPaths = [...first.created_paths];
  let page = first;
  let pages = 1;
  while (page.next_cursor) {
    if (pages >= 40) throw new Error("convert.io");
    pages += 1;
    page = await conversionPage(page.next_cursor);
    outputs.push(...page.outputs);
    createdPaths.push(...page.created_paths);
  }
  return { outputs, createdPaths, cancelled: first.cancelled };
}
