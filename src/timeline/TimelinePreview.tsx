import { useEffect, useRef, useState } from "react";

import { fileGrant, fileRevoke, fileUrl } from "../services/files";
import type { TimelineProject } from "./types";
import { clipEndUs, clipSourceTime } from "./timing";

export interface TimelinePreviewProps {
  project: Readonly<TimelineProject>;
  playhead_us: number;
  active: boolean;
  /** Translated words shown when no picture is available. */
  emptyLabel: string;
  /** Accessible name of the preview surface. */
  label: string;
  /** An optional leased proxy URL; the original is used when absent. */
  proxy_url?: string;
}

interface VisibleClip {
  sourcePath: string;
  sourceTimeUs: number;
}

function topVisibleClip(project: Readonly<TimelineProject>, playheadUs: number): VisibleClip | null {
  const tracks = [...project.tracks].sort((left, right) => right.index - left.index);
  for (const track of tracks) {
    if (track.kind !== "video" || !track.visible) continue;
    for (const clip of track.clips) {
      if (clip.start_us <= playheadUs && playheadUs < clipEndUs(clip)) {
        const source = project.sources.find((item) => item.id === clip.source_id);
        if (!source) return null;
        return { sourcePath: source.path, sourceTimeUs: clipSourceTime(clip, playheadUs) };
      }
    }
  }
  return null;
}

function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

/**
 * The 19a preview surface. It seeks one existing HTML video element to the
 * source time of the top visible track and draws that frame to an app-owned
 * canvas. Seeking uses a generation so a slower older seek never replaces the
 * newest scrub position; nothing autoplays and no frame is fabricated.
 */
export default function TimelinePreview(props: TimelinePreviewProps) {
  const { project, playhead_us: playheadUs, active, emptyLabel, label, proxy_url: proxyUrl } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const generation = useRef(0);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const visible = topVisibleClip(project, playheadUs);

  useEffect(() => {
    let cancelled = false;
    let granted: string | null = null;
    setReady(false);
    setToken(null);
    // A leased proxy already has a URL; only the original needs a new grant.
    if (!active || !visible || proxyUrl) return;
    void fileGrant(visible.sourcePath)
      .then((value) => {
        if (cancelled) {
          void fileRevoke(value);
          return;
        }
        granted = value;
        setToken(value);
      })
      .catch(() => {
        if (!cancelled) setToken(null);
      });
    return () => {
      cancelled = true;
      if (granted) void fileRevoke(granted);
    };
  }, [active, visible?.sourcePath, proxyUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !visible || (!token && !proxyUrl)) return;
    const current = generation.current + 1;
    generation.current = current;
    const target = Math.max(0, visible.sourceTimeUs / 1_000_000);
    const seek = () => {
      if (generation.current !== current) return;
      if (Number.isFinite(video.duration) && video.duration > 0) {
        video.currentTime = Math.min(target, Math.max(0, video.duration - 0.001));
      }
    };
    if (video.readyState >= 1) seek();
    else video.addEventListener("loadedmetadata", seek, { once: true });
    return () => video.removeEventListener("loadedmetadata", seek);
  }, [visible?.sourceTimeUs, token, proxyUrl]);

  const draw = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const surface = getComputedStyle(canvas)
      .getPropertyValue("--adp-color-surface-canvas-media")
      .trim();
    if (surface) context.fillStyle = surface;
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (video.videoWidth === 0 || video.videoHeight === 0) return;
    const scale = Math.min(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    const left = Math.round((canvas.width - width) / 2);
    const top = Math.round((canvas.height - height) / 2);
    context.drawImage(video, left, top, width, height);
    setReady(true);
  };

  const canvasWidth = Math.max(1, Math.min(project.width, 1280));
  const canvasHeight = Math.max(1, Math.round((canvasWidth * project.height) / project.width));

  return (
    <div className="adp-timeline-preview-surface">
      <canvas
        ref={canvasRef}
        width={canvasWidth}
        height={canvasHeight}
        className="adp-timeline-preview-canvas"
        role="img"
        aria-label={label}
      />
      {!ready ? <p className="adp-timeline-preview-empty">{emptyLabel}</p> : null}
      {visible && (token || proxyUrl) ? (
        <video
          ref={videoRef}
          className="adp-timeline-preview-video"
          src={proxyUrl ?? fileUrl(token as string, baseName(visible.sourcePath))}
          muted
          playsInline
          preload="auto"
          onSeeked={draw}
          onLoadedData={draw}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}
