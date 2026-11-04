import { useTranslation } from "react-i18next";

import { TIMELINE_THUMBNAIL_HEIGHT, TIMELINE_THUMBNAIL_MAX, TIMELINE_THUMBNAIL_WIDTH } from "../services/timeline";

export interface TimelineThumbnailImage {
  at_us: number;
  /** A `fileUrl()` value for one leased cache picture. */
  url: string;
}

export interface ThumbnailStripProps {
  frames: readonly TimelineThumbnailImage[];
  width?: number;
  height?: number;
}

/** A window is never larger than 256 pictures, 160x90 each (D6). */
export function boundedThumbnails(
  frames: readonly TimelineThumbnailImage[],
): TimelineThumbnailImage[] {
  return frames.slice(0, TIMELINE_THUMBNAIL_MAX);
}

/**
 * A presentational strip of already-leased pictures. It never requests a
 * source by itself and never shows raw pixels from JSON; each URL comes from
 * the cache lease owned by the editor.
 */
export default function ThumbnailStrip(props: ThumbnailStripProps) {
  const { t } = useTranslation();
  const frames = boundedThumbnails(props.frames);
  const width = props.width ?? TIMELINE_THUMBNAIL_WIDTH;
  const height = props.height ?? TIMELINE_THUMBNAIL_HEIGHT;
  if (frames.length === 0) return null;
  return (
    <ul className="adp-timeline-thumbnails" aria-label={t("timeline.thumbnails")}>
      {frames.map((frame) => (
        <li key={`${frame.at_us}-${frame.url}`} className="adp-timeline-thumbnail">
          <img
            src={frame.url}
            width={width}
            height={height}
            alt=""
            aria-hidden="true"
            loading="lazy"
            decoding="async"
          />
        </li>
      ))}
    </ul>
  );
}
