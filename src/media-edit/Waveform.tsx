import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { waveformPage } from "../services/mediaEdit";
import type { MediaSource, TimeUs, WavePage } from "./types";
import { WAVEFORM_BUCKETS_PER_PAGE, isMediaSafeInteger } from "./types";
import { formatTimeUs } from "./timing";

/**
 * App-owned waveform canvas (`D4`/`E4`).
 *
 * Pages are at most 512 buckets and only requested while the tab is active.
 * The canvas is decoration; the range input below it is the keyboard and
 * screen-reader control, so a missing representation never blocks seeking.
 */

export interface WaveformProps {
  source: MediaSource;
  durationUs: TimeUs;
  positionUs: TimeUs;
  active: boolean;
  onSeek: (positionUs: TimeUs) => void;
  /** Injected by tests; production uses the native page service. */
  loadPage?: (source: MediaSource, channel: number, firstBucket: number) => Promise<WavePage>;
}

const CANVAS_HEIGHT = 128;
const MAX_DRAWN_BUCKETS = WAVEFORM_BUCKETS_PER_PAGE * 4;

export default function Waveform({
  source,
  durationUs,
  positionUs,
  active,
  onSeek,
  loadPage = waveformPage,
}: WaveformProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [buckets, setBuckets] = useState<WavePage["buckets"]>([]);
  const [total, setTotal] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setFailed(false);
    setBuckets([]);
    setTotal(0);
    const load = async () => {
      const loaded: WavePage["buckets"] = [];
      let first = 0;
      let totalBuckets = 0;
      for (let pageNumber = 0; pageNumber < 4; pageNumber += 1) {
        const page = await loadPage(source, 0, first);
        if (cancelled) return;
        totalBuckets = page.total_buckets;
        loaded.push(...page.buckets);
        first += page.buckets.length;
        if (page.buckets.length === 0 || first >= page.total_buckets || loaded.length >= MAX_DRAWN_BUCKETS) break;
      }
      if (cancelled) return;
      setBuckets(loaded);
      setTotal(totalBuckets);
    };
    void load().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [active, loadPage, source]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const width = canvas.clientWidth > 0 ? canvas.clientWidth : 640;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * ratio));
    canvas.height = Math.floor(CANVAS_HEIGHT * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, CANVAS_HEIGHT);
    const color = window.getComputedStyle(canvas).color;
    context.fillStyle = color || "currentColor";
    if (buckets.length === 0) return;
    const middle = CANVAS_HEIGHT / 2;
    const step = width / buckets.length;
    for (let index = 0; index < buckets.length; index += 1) {
      const peak = buckets[index];
      const top = middle - Math.max(0, Math.min(1, peak.max)) * (middle - 4);
      const bottom = middle - Math.max(0, Math.min(1, peak.min)) * (middle - 4);
      context.fillRect(index * step, top, Math.max(1, step * 0.8), Math.max(1, bottom - top));
    }
  }, [buckets, total]);

  const max = isMediaSafeInteger(durationUs) && durationUs > 0 ? durationUs : 1;
  return (
    <div className="adp-media-waveform" role="group" aria-label={t("mediaEdit.waveform")}>
      <canvas ref={canvasRef} height={CANVAS_HEIGHT} aria-hidden="true" />
      <input
        type="range"
        min={0}
        max={max}
        step={1000}
        value={Math.min(max, Math.max(0, positionUs))}
        aria-label={t("mediaEdit.waveform")}
        aria-valuetext={formatTimeUs(positionUs)}
        onChange={(event) => onSeek(Number(event.target.value))}
        disabled={!active}
      />
      {failed ? (
        <p className="adp-media-waveform-note" role="status">
          {t("errors.media_edit.failed")}
        </p>
      ) : (
        <p className="adp-media-waveform-note" role="status">
          {t("mediaEdit.waveform")}: {buckets.length}/{total}
        </p>
      )}
    </div>
  );
}
