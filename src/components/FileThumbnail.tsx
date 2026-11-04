import type { ReactNode } from "react";
import { useThumbnail } from "../services/useThumbnail";
import { isThumbnailFile, type ThumbnailEdge } from "../services/thumbnails";

export interface FileThumbnailProps {
  path: string;
  edge: ThumbnailEdge;
  active: boolean;
  /** A refreshed listing entry invalidates the lookup, including subsecond edits. */
  sourceRevision?: object;
  /** The existing file tile the grid already draws. */
  fallback: ReactNode;
  className?: string;
}

/** A local picture in an existing grid cell. It only replaces the tile's
 * content: the row keeps its key, size, selection, focus and badges. The
 * image is inert and hidden from assistive tech because the row already
 * names the file. */
export default function FileThumbnail({
  path,
  edge,
  active,
  sourceRevision,
  fallback,
  className,
}: FileThumbnailProps) {
  const thumbnail = useThumbnail(path, edge, active, sourceRevision);
  if (thumbnail.url === null || !isThumbnailFile(path)) {
    return <>{fallback}</>;
  }
  const classes = ["adp-file-thumbnail", className].filter(Boolean).join(" ");
  return (
    <img
      className={classes}
      src={thumbnail.url}
      alt=""
      aria-hidden="true"
      draggable={false}
      data-thumbnail-state={thumbnail.state}
    />
  );
}
