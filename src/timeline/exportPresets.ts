import type { TimelineRenderPlan } from "./types";
import type { TimelineExportRequest } from "./effectTypes";
import { defaultTimelineComposition } from "./effectTypes";

export type TimelinePresetId = "web" | "phone" | "high" | "audioOnly";
export type TimelinePresetOptions = Pick<TimelineExportRequest,
  "container" | "video_codec" | "audio_codec" | "width" | "height" | "frame_rate" | "metadata_keep" | "subtitle_mode" | "composition">;

/** Fixed D7 option values only. This does not assert encoder availability or
 * that the current native layer implements fit/pad. Export stays unavailable
 * until the capability inventory and native graph/export exist; never turn
 * media.encode into a codec claim.
 */
export function timelinePresetOptions(id: TimelinePresetId, plan: Readonly<TimelineRenderPlan>): TimelinePresetOptions {
  const shared = {
    frame_rate: { ...plan.frame_rate },
    metadata_keep: true as const,
    subtitle_mode: "off" as const,
    composition: defaultTimelineComposition(),
  };
  switch (id) {
    case "web": return { ...shared, width: 1920, height: 1080, container: "webm", video_codec: "vp9", audio_codec: "opus" };
    case "phone": return { ...shared, width: 1080, height: 1920, container: "webm", video_codec: "vp9", audio_codec: "opus" };
    case "high": return { ...shared, width: plan.width, height: plan.height, container: "mkv", video_codec: "vp9", audio_codec: "flac" };
    // The encode node must have video_input=null for audio-only output. The
    // codec field remains a typed value; it cannot mean implicit stream copy.
    case "audioOnly": return { ...shared, width: plan.width, height: plan.height, container: "flac", video_codec: "vp9", audio_codec: "flac" };
    default: throw new Error("timeline_export.bad_request");
  }
}
