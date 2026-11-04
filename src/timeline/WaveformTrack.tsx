import { useEffect, useRef } from "react";

import Skeleton from "../components/Skeleton";
import type { WavePage } from "../media-edit/types";

export interface WaveformTrackProps {
  page: WavePage | null;
  loading?: boolean;
  channel: number;
  width: number;
  height?: number;
  /** Already-translated accessible name. */
  label: string;
  onSeekBucket?: (firstBucket: number) => void;
}

/** Draw one bounded 512-bucket page; never a whole decoded audio array. */
function drawPage(canvas: HTMLCanvasElement, page: WavePage): void {
  const context = canvas.getContext("2d");
  if (!context) return;
  const color =
    getComputedStyle(canvas).getPropertyValue("--adp-accent-explorer").trim() ||
    getComputedStyle(canvas).getPropertyValue("--adp-color-text-primary").trim();
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = color;
  const middle = canvas.height / 2;
  const bucketWidth = canvas.width / Math.max(1, page.buckets.length);
  page.buckets.forEach((peak, index) => {
    const top = middle - Math.max(0, Math.min(1, peak.max)) * middle;
    const bottom = middle - Math.max(-1, Math.min(0, peak.min)) * middle;
    const x = index * bucketWidth;
    context.fillRect(x, top, Math.max(1, bucketWidth - 1), Math.max(1, bottom - top));
  });
}

/**
 * One 15 E4 waveform page (at most 512 buckets). The canvas is the visual
 * form; the range input is its keyboard and screen-reader alternative and
 * moves by whole buckets, never by a hidden full waveform.
 */
export default function WaveformTrack(props: WaveformTrackProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const height = props.height ?? 128;
  const width = Math.max(1, Math.round(props.width));
  useEffect(() => {
    if (props.page && canvasRef.current) drawPage(canvasRef.current, props.page);
  }, [props.page, width, height]);
  if (props.loading) return <Skeleton variant="rows" count={1} />;
  const total = props.page?.total_buckets ?? 0;
  const first = props.page?.first_bucket ?? 0;
  return (
    <div className="adp-timeline-waveform" style={{ height: `${height}px`, width: `${width}px` }}>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        aria-hidden="true"
        className="adp-timeline-waveform-canvas"
      />
      <input
        type="range"
        className="adp-timeline-waveform-range"
        aria-label={props.label}
        min={0}
        max={Math.max(0, total - 1)}
        step={1}
        value={first}
        onChange={(event) => props.onSeekBucket?.(Number(event.currentTarget.value))}
      />
    </div>
  );
}
