import { invoke } from "@tauri-apps/api/core";
import type { ConversionReport } from "../convert/types";
import type { TimelineExportPreview, TimelineExportRequest } from "../timeline/effectTypes";
import { TIMELINE_WARNING_CODES } from "../timeline/effectTypes";
import { buildRenderGraph, type ValidatedRenderGraph } from "../timeline/graph";
import { isAbsoluteWindowsPath } from "../timeline/projectValidation";
import { isFrameRate } from "../timeline/timing";
import { TIMELINE_MAX_CLIPS, TIMELINE_MAX_DURATION_US, type TimelineRenderPlan } from "../timeline/types";
import { releaseCacheLease, type CacheLease } from "./cache";
import type { EngineCapability } from "./engineTypes";
import { capabilityAvailable, capabilityReason } from "./engines";
import { runJob, type JobHandle } from "./jobs";
import { isTauriRuntime } from "./settings";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METADATA = ["exif", "gps", "camera", "date", "icc", "xmp", "iptc", "author", "comments", "attachments",
  "forms", "annotations", "scripts", "timestamps"];
const ENCODER_CAPABILITY = "media.encode";
const STABLE_EXPORT_CODE = /^timeline_export\.[a-z][a-z_]*$/;
/** One primary plus the optional SRT sidecar per exported item, bounded. */
const MAX_REPORT_OUTPUTS = TIMELINE_MAX_CLIPS * 2;
const safe = (v: number) => Number.isSafeInteger(v) && v >= 0;
const bad = (): never => { throw new Error("timeline_export.bad_request"); };
function unique(values: unknown, allowed: readonly string[]): boolean {
  return Array.isArray(values) && values.length <= 64 && new Set(values).size === values.length && values.every((v) => typeof v === "string" && allowed.includes(v));
}

/**
 * Graph inputs a caller must supply. A request alone cannot become a validated
 * graph: the builder also needs the frozen plan it was produced from and the
 * capabilities the native side actually verified. Omitting the context is a
 * safe refusal, never an unvalidated dispatch.
 */
export interface TimelineExportContext {
  plan: Readonly<TimelineRenderPlan>;
  capabilities: readonly EngineCapability[];
}

/** UI validation is only preflight. The native command independently
 * authorizes the immutable snapshot, sources, codecs and publication sink.
 */
export function validateTimelineExportRequest(request: TimelineExportRequest): TimelineExportRequest {
  if (!request || typeof request !== "object" || !request.project_snapshot) bad();
  const r = structuredClone(request);
  const s = r.project_snapshot;
  if (!UUID.test(s.snapshot_id) || !UUID.test(s.content_id) || typeof s.document_id !== "string" ||
      !s.document_id || s.document_id.length > 128 || !safe(s.revision) || !safe(s.byte_len) ||
      s.byte_len === 0 || s.byte_len > 16 * 1024 * 1024 || !safe(s.expires_unix) ||
      s.mime !== "application/vnd.adperastra.timeline+json") bad();
  if (s.storage_policy === "sensitive") throw new Error("timeline_export.unsupported");
  if (s.storage_policy !== "ordinary" || !isAbsoluteWindowsPath(r.dest_dir)) bad();
  if (typeof r.file_name !== "string" || !r.file_name || r.file_name.length > 255 ||
      /[<>:"/\\|?*\u0000-\u001f]/.test(r.file_name) || /[. ]$/.test(r.file_name) ||
      /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(r.file_name)) bad();
  if (!["webm", "mkv", "mp4", "flac", "wav", "mp3"].includes(r.container) ||
      !r.file_name.toLowerCase().endsWith(`.${r.container}`) ||
      !["auto", "vp9", "av1", "h264_os", "hevc_os", "copy"].includes(r.video_codec) ||
      !["auto", "opus", "vorbis", "flac", "pcm", "mp3", "aac_os", "copy"].includes(r.audio_codec) ||
      !safe(r.width) || !safe(r.height) || r.width < 1 || r.height < 1 || r.width > 8192 || r.height > 8192 ||
      !isFrameRate(r.frame_rate) || r.metadata_keep !== true || !["off", "burn", "sidecar"].includes(r.subtitle_mode)) bad();
  if (r.bitrate_kbps !== undefined && (!safe(r.bitrate_kbps) || r.bitrate_kbps < 8 || r.bitrate_kbps > 1_000_000)) bad();
  const composition = r.composition;
  if (!composition || composition.placement !== "absolute_start_us" ||
      composition.stacking !== "track_index" || composition.fit !== "fit_pad" ||
      !Array.isArray(composition.background) || composition.background.length !== 4 ||
      composition.background.some((value) => !safe(value) || value > 255)) bad();
  if (!unique(r.accepted_losses, METADATA)) bad();
  if (!unique(r.accepted_warning_codes, TIMELINE_WARNING_CODES)) throw new Error("convert.warning_required");
  if (new TextEncoder().encode(JSON.stringify(r)).byteLength > 1024 * 1024) throw new Error("timeline_export.too_large");
  return r;
}

/** One native error code, or `timeline_export.failed` for anything unknown. */
function stableError(error: unknown): Error {
  const code = typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "";
  if (code === "convert.warning_required" || STABLE_EXPORT_CODE.test(code)) return new Error(code);
  return new Error("timeline_export.failed");
}

function validLease(value: unknown): value is CacheLease {
  if (!value || typeof value !== "object") return false;
  const lease = value as Partial<CacheLease>;
  return typeof lease.lease_id === "string" && UUID.test(lease.lease_id) &&
    typeof lease.token === "string" && /^[0-9a-f]{32}$/.test(lease.token) &&
    typeof lease.name === "string" && lease.name.length > 0 && lease.name.length <= 255 &&
    typeof lease.mime === "string" && lease.mime.length > 0 && lease.mime.length <= 128 &&
    typeof lease.byte_len === "number" && safe(lease.byte_len) &&
    (lease.width === undefined ||
      (typeof lease.width === "number" && safe(lease.width) && lease.width > 0 && lease.width <= 8192)) &&
    (lease.height === undefined ||
      (typeof lease.height === "number" && safe(lease.height) && lease.height > 0 && lease.height <= 8192)) &&
    lease.sensitive !== true;
}

async function releasePreviewLeases(value: unknown): Promise<void> {
  if (!value || typeof value !== "object") return;
  const preview = value as { frame?: { lease_id?: unknown }; sample?: { lease_id?: unknown } | null };
  const ids = [preview.frame?.lease_id, preview.sample?.lease_id].filter(
    (id): id is string => typeof id === "string" && UUID.test(id),
  );
  await Promise.allSettled([...new Set(ids)].map(releaseCacheLease));
}

function validReport(value: unknown): value is ConversionReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<ConversionReport>;
  const counts = [report.input_total, report.done_count, report.failed_count,
    report.skipped_count, report.cancelled_count, report.outputs_created];
  const next = (report as { next_cursor?: unknown }).next_cursor;
  const history = (report as { history_id?: unknown }).history_id;
  const validOptional = (item: unknown) => item === undefined || item === null ||
    (typeof item === "string" && item.length > 0 && item.length <= 128);
  return typeof report.report_id === "string" && report.report_id.length > 0 && report.report_id.length <= 128 &&
    Array.isArray(report.items) && report.items.length <= TIMELINE_MAX_CLIPS &&
    Array.isArray(report.outputs) && report.outputs.length <= MAX_REPORT_OUTPUTS &&
    report.outputs.every((output) => !!output && typeof output.path === "string" &&
      isAbsoluteWindowsPath(output.path) && typeof output.byte_len === "number" && safe(output.byte_len)) &&
    Array.isArray(report.created_paths) && report.created_paths.length <= MAX_REPORT_OUTPUTS &&
    report.created_paths.every((path) => typeof path === "string" && isAbsoluteWindowsPath(path)) &&
    validOptional(next) && validOptional(history) &&
    counts.every((count) => typeof count === "number" && safe(count)) &&
    typeof report.cancelled === "boolean" && typeof report.job_finished === "boolean" &&
    typeof report.complete === "boolean";
}

/**
 * Validate the request, require the verified encoder pack and build the
 * bounded graph. The native commands revalidate both from their wire shape
 * before any job, lease or output exists; this build still refuses after that
 * check because no concrete graph executor or publication path is implemented.
 */
function prepareGraph(
  request: TimelineExportRequest,
  context: TimelineExportContext | undefined,
): ValidatedRenderGraph {
  if (!context) throw new Error("timeline_export.unsupported");
  if (!Array.isArray(context.capabilities)) throw new Error("timeline_export.bad_request");
  // A missing pack is its own typed refusal; an unsafe or sandboxed engine is
  // `unsupported`. Neither may reach the native command as a valid claim.
  if (capabilityReason(context.capabilities, ENCODER_CAPABILITY) === "packs_missing") {
    throw new Error("timeline_export.pack_missing");
  }
  if (!capabilityAvailable(context.capabilities, ENCODER_CAPABILITY)) {
    throw new Error("timeline_export.unsupported");
  }
  if (!isTauriRuntime()) throw new Error("timeline_export.unsupported");
  return buildRenderGraph(context.plan, request, context.capabilities);
}

/**
 * A preview reply must describe the captured revision and carry valid leases.
 * A malformed or mismatched reply releases every returned lease and fails with
 * `timeline_export.failed`; a valid reply transfers both leases to the caller.
 */
export async function previewTimelineExport(
  request: TimelineExportRequest,
  context?: TimelineExportContext,
): Promise<JobHandle<TimelineExportPreview>> {
  const checked = validateTimelineExportRequest(request);
  const graph = prepareGraph(checked, context);
  const job = await runJob<TimelineExportPreview>("tlpreview", async (requestId) => {
    try {
      await invoke("timeline_export_preview_start", { requestId, request: checked, graph });
    } catch (error) {
      throw stableError(error);
    }
  });
  const completion = job.completion.then(
    async (preview) => {
      const snapshot = checked.project_snapshot;
      if (preview && typeof preview === "object" &&
          validLease(preview.frame) &&
          (preview.sample === null || validLease(preview.sample)) &&
          typeof preview.duration_us === "number" && safe(preview.duration_us) &&
          preview.duration_us <= TIMELINE_MAX_DURATION_US &&
          (preview.estimated_bytes === null ||
            (typeof preview.estimated_bytes === "number" && safe(preview.estimated_bytes))) &&
          unique(preview.warnings, TIMELINE_WARNING_CODES) &&
          preview.captured_revision === snapshot.revision &&
          preview.content_id === snapshot.content_id) {
        return preview;
      }
      await releasePreviewLeases(preview);
      throw new Error("timeline_export.failed");
    },
    (error) => {
      throw stableError(error);
    },
  );
  return { ...job, completion };
}

/** No ordinary media-conversion fallback and no project Save/clean notification. */
export async function exportTimeline(
  request: TimelineExportRequest,
  context?: TimelineExportContext,
): Promise<JobHandle<ConversionReport>> {
  const checked = validateTimelineExportRequest(request);
  const graph = prepareGraph(checked, context);
  const job = await runJob<ConversionReport>("tlexport", async (requestId) => {
    try {
      await invoke("timeline_export_start", { requestId, request: checked, graph });
    } catch (error) {
      throw stableError(error);
    }
  });
  const completion = job.completion.then(
    (report) => {
      if (validReport(report)) return report;
      throw new Error("timeline_export.failed");
    },
    (error) => {
      throw stableError(error);
    },
  );
  return { ...job, completion };
}
