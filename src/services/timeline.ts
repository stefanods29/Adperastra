import { invoke } from "@tauri-apps/api/core";

import type { ConversionInput } from "../convert/types";
import type { MediaSource } from "../media-edit/types";
import type { TimelineProject } from "../timeline/types";
import { validateTimelineProject } from "../timeline/projectValidation";
import { isAbsoluteWindowsPath } from "../timeline/projectValidation";
import type { CacheLease } from "./cache";
import { runJob, type JobHandle } from "./jobs";
import { isTauriRuntime } from "./settings";

/**
 * Timeline service (Step 19a E5, revision `timeline-project-1`).
 *
 * This is the only place the timeline calls Rust. Project JSON and source
 * references travel as bounded typed values; media bytes never travel through
 * `invoke` and the project source path is never sent as a render command.
 * Proxy leases come from the shared 07a cache and are released exactly once.
 */

/** The two proxy edges allowed by D6. */
export type ProxyQuality = 512 | 960;
export const PROXY_QUALITIES: readonly ProxyQuality[] = [512, 960];
/** A timeline proxy is at most 512 MiB inside the shared cache. */
export const TIMELINE_PROXY_MAX_BYTES = 512 * 1024 * 1024;
/** One thumbnail window returns at most 256 pictures, 160x90 each. */
export const TIMELINE_THUMBNAIL_MAX = 256;
export const TIMELINE_THUMBNAIL_WIDTH = 160;
export const TIMELINE_THUMBNAIL_HEIGHT = 90;

/** Open a `.adtimeline` project as a bounded native job. */
export async function openTimeline(input: ConversionInput): Promise<JobHandle<TimelineProject>> {
  if (!isTauriRuntime()) throw new Error("timeline.failed");
  if (
    !input ||
    input.kind !== "file" ||
    !isAbsoluteWindowsPath(input.path) ||
    !/\.adtimeline$/i.test(input.path)
  ) {
    throw new Error("timeline.bad_request");
  }
  const handle = await runJob<TimelineProject>("timelineopen", async (requestId) => {
    await invoke("timeline_open_start", { requestId, input });
  });
  return {
    ...handle,
    completion: handle.completion.then((project) => validateTimelineProject(project)),
  };
}

function validateProxySource(source: MediaSource): void {
  if (typeof source !== "object" || source === null) throw new Error("timeline.bad_request");
  if (source.sensitive) throw new Error("timeline.unsupported");
  if (!isAbsoluteWindowsPath(source.path)) throw new Error("timeline.bad_request");
  if (!Number.isSafeInteger(source.duration_us) || source.duration_us < 0) {
    throw new Error("timeline.bad_request");
  }
  if (source.video_rate === null) throw new Error("timeline.unsupported");
}

/** Request one optional 512/960-edge proxy. The current native command refuses
 * with `timeline.unsupported` until a concrete producer and cache support exist.
 */
export async function requestTimelineProxy(
  source: MediaSource,
  quality: ProxyQuality,
): Promise<JobHandle<CacheLease>> {
  validateProxySource(source);
  if (quality !== 512 && quality !== 960) throw new Error("timeline.bad_request");
  if (!isTauriRuntime()) throw new Error("timeline.failed");
  return runJob<CacheLease>("tlproxy", async (requestId) => {
    await invoke("timeline_proxy_start", { requestId, source, quality });
  });
}

/** Release one proxy lease; idempotent for an unknown lease. */
export async function releaseTimelineProxy(leaseId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("timeline_proxy_release", { leaseId });
}

/** One proxy cache identity: source stamp, stream, engine version and edge. */
export function proxyCacheIdentity(
  source: MediaSource,
  quality: ProxyQuality,
  engineVersion: string,
): string {
  if (typeof engineVersion !== "string" || engineVersion.length === 0 || engineVersion.length > 64) {
    throw new Error("timeline.bad_request");
  }
  return JSON.stringify([
    "timeline-proxy-v1",
    source.stamp.path_key,
    source.stamp.volume_id,
    source.stamp.file_id,
    source.stamp.modified_ticks,
    source.stamp.size_bytes,
    "video",
    engineVersion,
    quality,
  ]);
}

/** A changed stamp invalidates every preview derived from the old source. */
export function proxyCacheStillValid(
  source: MediaSource,
  current: MediaSource["stamp"],
): boolean {
  return (
    source.stamp.path_key === current.path_key &&
    source.stamp.volume_id === current.volume_id &&
    source.stamp.file_id === current.file_id &&
    source.stamp.modified_ticks === current.modified_ticks &&
    source.stamp.size_bytes === current.size_bytes
  );
}

/**
 * Seeks get a generation. A slower earlier decode may never replace the
 * newest requested scrub position (D7).
 */
export class SeekGenerations {
  private current = 0;

  begin(): number {
    this.current += 1;
    return this.current;
  }

  isCurrent(generation: number): boolean {
    return generation === this.current;
  }

  reset(): void {
    this.current += 1;
  }
}

/** Playback pauses when its tab is inactive or the window is hidden (D7). */
export function shouldPausePlayback(active: boolean, documentHidden: boolean): boolean {
  return !active || documentHidden;
}

/** What preview source the editor should use for a setting and capability. */
export function proxyPlan(
  quality: "source" | 512 | 960,
  enabled: boolean,
  capabilityAvailableNow: boolean,
): "proxy" | "original" {
  if (!enabled || quality === "source" || !capabilityAvailableNow) return "original";
  return "proxy";
}

/** The numeric proxy edge for a setting, or null for "source". */
export function proxyQualityValue(quality: "source" | 512 | 960): ProxyQuality | null {
  return quality === "source" ? null : quality;
}
