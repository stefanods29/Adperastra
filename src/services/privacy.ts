/** Privacy cleaner services (Step 08c E1, privacy-1).
 *
 * Only this module calls the privacy commands. Shared conversion DTOs come
 * from `src/convert/types.ts`; they are never duplicated here.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  ConversionInput,
  ConversionReport,
  FormatId,
  MetadataCategory,
} from "../convert/types";
import type { SourceStamp } from "./cache";
import { runJob, type JobHandle } from "./jobs";

export type MetadataContainer = "exif" | "xmp" | "iptc" | "pdf_info" | "pdf_structure";
export type PrivacyCoverage = "complete" | "partial" | "unknown";
export type PrivacyMode = "keep" | "ask" | "remove";

/** Mirrors Rust `MetadataCount`. */
export interface MetadataCount {
  category: MetadataCategory;
  count: number;
  coverage: PrivacyCoverage;
}

/** Mirrors Rust `PrivacyField`. */
export interface PrivacyField {
  category: MetadataCategory;
  containers: MetadataContainer[];
  related_categories: MetadataCategory[];
  field_id: string;
  label_key: string;
  preview: string;
  count: number;
  content_affecting: boolean;
  coverage: PrivacyCoverage;
}

/** Mirrors Rust `PrivacyInspection`. */
export interface PrivacyInspection {
  inspection_id: string;
  input: ConversionInput;
  source?: SourceStamp;
  fields: PrivacyField[];
  next_cursor?: string;
  complete: boolean;
  signatures_present: boolean;
  effective_categories: MetadataCategory[];
  expires_unix: number;
}

export interface PrivacyInspectionPage {
  items: PrivacyInspection[];
  next_cursor?: string;
  complete: boolean;
}

export interface PrivacyClosure {
  requested_categories: MetadataCategory[];
  effective_categories: MetadataCategory[];
  content_affecting: boolean;
  appearance_affecting: boolean;
  signatures_present: boolean;
}

export interface PrivacyRequest {
  inspection_ids: string[];
  categories: MetadataCategory[];
  dest_dir: string;
  replace?: boolean;
  accepted_content_changes?: boolean;
  accepted_signature_change?: boolean;
  accepted_appearance_changes?: boolean;
  accepted_effective_categories: MetadataCategory[];
  /** Localized suffix resolved from `privacy.cleanedName`. */
  cleaned_suffix?: string;
}

/** Mirrors Rust `PrivacyResult`. */
export interface PrivacyResult {
  report: ConversionReport;
  inspections_before: MetadataCount[];
  inspections_after: MetadataCount[];
}

/** Mirrors Rust `PrivacySettings` (schema 18). */
export interface PrivacySettings {
  mode: PrivacyMode;
  image_mode: PrivacyMode;
  pdf_mode: PrivacyMode;
  image_categories: MetadataCategory[];
  pdf_categories: MetadataCategory[];
  location_warning: boolean;
  sharing_prompt: boolean;
}

export const IMAGE_PRIVACY_CATEGORIES: readonly MetadataCategory[] = [
  "exif",
  "gps",
  "camera",
  "date",
  "icc",
  "xmp",
  "iptc",
  "author",
  "comments",
];

export const PDF_PRIVACY_CATEGORIES: readonly MetadataCategory[] = [
  "author",
  "xmp",
  "attachments",
  "annotations",
  "scripts",
  "forms",
  "comments",
  "timestamps",
];

export function privacyFormatFor(format: FormatId): "image" | "pdf" | null {
  if (format === "pdf") return "pdf";
  if (format === "png" || format === "jpeg" || format === "webp" || format === "tiff") return "image";
  return null;
}

export function supportedPrivacyCategories(
  format: "image" | "pdf",
): readonly MetadataCategory[] {
  return format === "pdf" ? PDF_PRIVACY_CATEGORIES : IMAGE_PRIVACY_CATEGORIES;
}

/** Inspect selected files; an empty category list means "detect only". */
export function inspectPrivacy(
  inputs: readonly ConversionInput[],
  categories: readonly MetadataCategory[] = [],
): Promise<JobHandle<PrivacyInspectionPage>> {
  return runJob<PrivacyInspectionPage>("privacy", async (requestId) => {
    await invoke("privacy_inspect_start", {
      requestId,
      inputs,
      categories: [...categories],
    });
  });
}

export async function privacyInspectionPage(cursor: string): Promise<PrivacyInspectionPage> {
  return (await invoke("privacy_inspection_page", { cursor })) as PrivacyInspectionPage;
}

/** The exact reviewed closure for the current selection. */
export async function effectivePrivacyCategories(
  inspectionIds: readonly string[],
  categories: readonly MetadataCategory[],
): Promise<PrivacyClosure> {
  return (await invoke("privacy_effective_categories", {
    inspectionIds: [...inspectionIds],
    categories: [...categories],
  })) as PrivacyClosure;
}

/** Start a cleaning job; the wrapper never fills acknowledgements. */
export function cleanPrivacy(request: PrivacyRequest): Promise<JobHandle<PrivacyResult>> {
  return runJob<PrivacyResult>("privacy", async (requestId) => {
    await invoke("privacy_clean_start", { requestId, request });
  });
}

/** Idempotent release of one inspection. */
export async function releasePrivacy(inspectionId: string): Promise<void> {
  await invoke("privacy_release", { inspectionId });
}
