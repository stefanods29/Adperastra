import type { ConversionReport } from "../convert/types";
import { resolveConverter } from "../convert/registry";
import type { JobHandle } from "../services/jobs";
import { captureExtraction } from "../services/aiExtraction";
import type { ExtractionPublish } from "../services/aiExtractionTypes";
import { validateExtractionPublish } from "../services/aiExtractionValidation";
import { startConversion } from "../services/convert";
import { releaseExportSnapshot, type ExportSnapshot } from "../services/exportSnapshots";
import {
  buildConversionRequest,
  extractionConverterId,
} from "../convert/extractionConverters";

/** Publication of one reviewed extraction (Step 17d T5, export E3).
 *
 * The corrected model is captured once as an immutable 08a snapshot; the
 * chosen static converter consumes exactly that snapshot. The parent (08a)
 * owns staging, flush, no-replace collision handling and history. Nothing is
 * written here, and the capture lease is released when the job ends.
 */

/** The UTC date stamped once on confirmation, `YYYY-MM-DD`. */
export function utcDate(now: Date = new Date()): string {
  return `${now.getUTCFullYear().toString().padStart(4, "0")}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

export interface PublishOptions {
  /** Captured once; tests pass a fixed date. */
  capturedUtc?: string;
}

/** Only actually published outputs; never an assumed item path. */
export function outputPaths(report: ConversionReport): string[] {
  return report.outputs.map((output) => output.path);
}

/** Capture once, convert the capture, release it after the job. */
export async function publishExtraction(
  request: ExtractionPublish,
  options: PublishOptions = {},
): Promise<JobHandle<ConversionReport>> {
  const typed = validateExtractionPublish(request);
  if (!resolveConverter(extractionConverterId(typed.format))) {
    throw new Error("ai_extract.unsupported");
  }
  const capture = await captureExtraction(typed);
  let snapshot: ExportSnapshot;
  try {
    snapshot = await capture.completion;
  } catch (reason) {
    throw reason;
  }
  const conversionRequest = buildConversionRequest(
    typed,
    snapshot,
    options.capturedUtc ?? utcDate(),
  );
  let conversion: JobHandle<ConversionReport>;
  try {
    conversion = await startConversion(conversionRequest);
  } catch (reason) {
    await releaseExportSnapshot(snapshot.snapshot_id).catch(() => undefined);
    throw reason;
  }
  const release = () => {
    void releaseExportSnapshot(snapshot.snapshot_id).catch(() => undefined);
  };
  conversion.completion.then(release, release);
  return conversion;
}

/** The exact request a preview or a test can inspect before publication. */
export function conversionRequestFor(
  request: ExtractionPublish,
  snapshot: ExportSnapshot,
  capturedUtc: string,
) {
  return buildConversionRequest(validateExtractionPublish(request), snapshot, capturedUtc);
}
