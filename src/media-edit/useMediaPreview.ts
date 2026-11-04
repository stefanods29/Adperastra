import { useCallback, useEffect, useRef, useState } from "react";
import { releaseCacheLease, type CacheLease } from "../services/cache";
import { fileUrl } from "../services/files";
import type { JobHandle } from "../services/jobs";
import { mediaProxyKey, startMediaProxy } from "../services/mediaEdit";
import type { MediaPreviewQuality, MediaRecipe, MediaSource, TimeUs } from "./types";
import { isMediaSafeInteger, mediaEditFail } from "./types";
import {
  mediaRecipeDurationUs,
  nextSegmentStartAfter,
  outputToSource,
  sourceToOutput,
} from "./timing";

/**
 * Preview state for the recipe editor (`D5`).
 *
 * The player always reads the immutable source. Output time is derived from
 * the recipe; a removed range is skipped rather than played. An inactive tab
 * pauses and refuses new preview work; returning to it never starts audible
 * playback by itself.
 */

export type PreviewQuality = Exclude<MediaPreviewQuality, "source"> | "source";

/** The edge a proxy may use; `0` means the original source. */
export function previewEdge(quality: PreviewQuality): 0 | 512 | 960 {
  if (quality === "source") return 0;
  if (quality === "512") return 512;
  return 960;
}

export class MediaPreviewGate {
  private generation = 0;
  private active = true;
  private paused = false;

  setActive(active: boolean): void {
    this.active = active;
    this.paused = !active;
    this.generation += 1;
  }

  /** Starts a request; `null` means the tab is inactive. */
  begin(): number | null {
    if (!this.active) return null;
    this.generation += 1;
    return this.generation;
  }

  accept(generation: number | null): boolean {
    return generation !== null && this.active && generation === this.generation;
  }

  invalidate(): void {
    this.generation += 1;
  }

  get isActive(): boolean {
    return this.active;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get currentGeneration(): number {
    return this.generation;
  }
}

/** A bounded map of proxy identities; a changed stamp is a new key. */
export class PreviewCache<T> {
  private readonly values = new Map<string, T>();

  constructor(private readonly limit = 4) {}

  get(key: string): T | null {
    return this.values.get(key) ?? null;
  }

  put(key: string, value: T): void {
    this.values.delete(key);
    this.values.set(key, value);
    while (this.values.size > this.limit) {
      const oldest = this.values.keys().next();
      if (oldest.done) break;
      this.values.delete(oldest.value);
    }
  }

  clear(): void {
    this.values.clear();
  }

  get size(): number {
    return this.values.size;
  }
}

export interface UseMediaProxyOptions {
  source: MediaSource | null;
  quality: MediaPreviewQuality;
  /** Inactive tabs never request preview work (`D5`). */
  active: boolean;
}

/**
 * An optional 512/960-edge proxy for the editor player (`D5`). A missing
 * pack, a stale source or a cancelled job simply leaves the original source
 * in place: the proxy never blocks playback and no sample is invented.
 */
export function useMediaProxy({ source, quality, active }: UseMediaProxyOptions): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const key = source && quality !== "source" ? mediaProxyKey(source, quality) : null;

  useEffect(() => {
    setUrl(null);
    const proxyQuality = quality === "source" ? null : quality;
    if (!source || proxyQuality === null || !active) return;
    const proxySource = source;
    let cancelled = false;
    let job: JobHandle<CacheLease> | null = null;
    let leaseId: string | null = null;
    startMediaProxy(proxySource, proxyQuality)
      .then((started) => {
        if (cancelled) {
          void started.cancel();
          return null;
        }
        job = started;
        return started.completion;
      })
      .then((lease) => {
        if (!lease) return;
        if (cancelled) {
          void releaseCacheLease(lease.lease_id).catch(() => undefined);
          return;
        }
        leaseId = lease.lease_id;
        setUrl(fileUrl(lease.token, lease.name));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      void job?.cancel();
      if (leaseId) void releaseCacheLease(leaseId).catch(() => undefined);
    };
    // A changed source stamp is a different proxy identity (`key`).
  }, [active, key]);
  return url;
}

export interface UseMediaPreviewOptions {
  recipe: MediaRecipe;
  active: boolean;
  media: HTMLMediaElement | null;
}

export interface MediaPreviewState {
  positionUs: TimeUs;
  durationUs: TimeUs;
  playing: boolean;
  seekOutput: (outputUs: TimeUs) => void;
  toggle: () => void;
  pause: () => void;
}

/** The source span that contains the player's current source time. */
function segmentAtSource(
  recipe: MediaRecipe,
  sourceUs: TimeUs,
): { segmentId: string; sourceUs: TimeUs } | null {
  for (const segment of recipe.segments) {
    if (sourceUs >= segment.start_us && sourceUs < segment.end_us) {
      return { segmentId: segment.id, sourceUs };
    }
  }
  return null;
}

export function useMediaPreview({ recipe, active, media }: UseMediaPreviewOptions): MediaPreviewState {
  const gate = useRef(new MediaPreviewGate()).current;
  const [positionUs, setPositionUs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const durationUs = mediaRecipeDurationUs(recipe);

  useEffect(() => {
    gate.setActive(active);
    if (!active) {
      media?.pause();
      setPlaying(false);
    }
    // Returning to the tab must never start audible playback (D5).
  }, [active, gate, media]);

  useEffect(() => {
    if (!media) return;
    const activeSegment = segmentAtSource(recipe, Math.round(media.currentTime * 1_000_000));
    const speed = activeSegment
      ? recipe.segments.find((segment) => segment.id === activeSegment.segmentId)?.speed ?? 1
      : 1;
    media.playbackRate = Math.min(4, Math.max(0.25, speed));
    // Chromium exposes pitch preservation; follow the recipe so preview and
    // export make the same speed/pitch decision.
    (media as HTMLMediaElement & { preservesPitch?: boolean }).preservesPitch = recipe.keep_pitch;
    media.volume = Math.min(1, recipe.volume);
    media.muted = recipe.mute || recipe.volume === 0;
  }, [media, recipe]);

  useEffect(() => {
    if (!media) return;
    const onTime = () => {
      if (!gate.isActive) return;
      const sourceUs = Math.round(media.currentTime * 1_000_000);
      const inside = segmentAtSource(recipe, sourceUs);
      if (inside) {
        const segment = recipe.segments.find((segment) => segment.id === inside.segmentId);
        if (segment) media.playbackRate = Math.min(4, Math.max(0.25, segment.speed));
        setPositionUs(sourceToOutput(recipe, inside.segmentId, inside.sourceUs));
        return;
      }
      const next = nextSegmentStartAfter(recipe, sourceUs);
      if (next) {
        // Jump over a removed range without leaving the source.
        media.currentTime = next.source_us / 1_000_000;
        setPositionUs(next.output_us);
      } else {
        media.pause();
        setPositionUs(durationUs);
      }
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    media.addEventListener("timeupdate", onTime);
    media.addEventListener("play", onPlay);
    media.addEventListener("pause", onPause);
    return () => {
      media.removeEventListener("timeupdate", onTime);
      media.removeEventListener("play", onPlay);
      media.removeEventListener("pause", onPause);
    };
  }, [durationUs, gate, media, recipe]);

  const seekOutput = useCallback(
    (outputUs: TimeUs) => {
      if (!isMediaSafeInteger(outputUs)) mediaEditFail("media_edit.bad_request");
      if (!media || !gate.isActive) return;
      const mapped = outputToSource(recipe, outputUs);
      gate.begin();
      media.currentTime = mapped.source_us / 1_000_000;
      setPositionUs(outputUs);
    },
    [gate, media, recipe],
  );

  const toggle = useCallback(() => {
    if (!media || !gate.isActive) return;
    if (media.paused) {
      void media.play().catch(() => undefined);
    } else {
      media.pause();
    }
  }, [gate, media]);

  const pause = useCallback(() => {
    media?.pause();
  }, [media]);

  return { positionUs, durationUs, playing, seekOutput, toggle, pause };
}
