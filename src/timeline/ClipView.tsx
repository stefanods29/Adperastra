import { Check } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";

import type { TimelineClip, TrackKind } from "./types";

export interface ClipViewProps {
  clip: TimelineClip;
  selected: boolean;
  left_px: number;
  width_px: number;
  track_kind: TrackKind;
  /** Already-translated accessible name. */
  label: string;
  thumbnail_url?: string;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>, clip: TimelineClip) => void;
  onSelect?: (clip: TimelineClip) => void;
}

/**
 * One clip on a track. Selection is shown by the accent border, a check mark
 * and `aria-selected`, never by color alone. The clip is a positioned block,
 * not a DOM subtree per frame.
 */
export default function ClipView(props: ClipViewProps) {
  const { clip, selected, left_px: left, width_px: width, track_kind: kind } = props;
  const safeWidth = Math.max(2, Math.round(width));
  return (
    <div
      role="option"
      aria-selected={selected}
      aria-label={props.label}
      tabIndex={selected ? 0 : -1}
      className={`adp-timeline-clip adp-timeline-clip-${kind}${selected ? " is-selected" : ""}`}
      data-clip-id={clip.id}
      data-selected={selected ? "true" : "false"}
      style={{ left: `${Math.max(0, Math.round(left))}px`, width: `${safeWidth}px` }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        props.onSelect?.(clip);
        props.onPointerDown?.(event, clip);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onSelect?.(clip);
        }
      }}
      title={props.label}
    >
      {props.thumbnail_url ? (
        <img className="adp-timeline-clip-thumb" src={props.thumbnail_url} alt="" aria-hidden="true" />
      ) : null}
      <span className="adp-timeline-clip-name">{props.label}</span>
      {selected ? <Check className="adp-timeline-clip-check" size={14} aria-hidden="true" /> : null}
    </div>
  );
}
