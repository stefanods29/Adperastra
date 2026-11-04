import { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { TimeUs } from "../services/engineTypes";

/**
 * Virtualized transcript list (D7/D12).
 *
 * Logical rows keep the full count while only a small window is in the DOM.
 * Times use the existing player TimeUs conversion (never floating seconds);
 * choosing a row asks the player to seek and never starts playback.
 */

export interface TranscriptRow {
  index: number;
  start_us: TimeUs;
  end_us: TimeUs;
  text: string;
}

export interface AiTranscriptViewProps {
  rows: readonly TranscriptRow[];
  currentIndex: number | null;
  onSeek: (startUs: TimeUs) => void;
  /** 10f large-target preference: 44 px rows instead of 28 px. */
  largeTarget?: boolean;
}

export const TRANSCRIPT_ROW_HEIGHT = 28;
export const TRANSCRIPT_ROW_HEIGHT_LARGE = 44;
export const TRANSCRIPT_DOM_ROWS = 200;

export function formatTimeUs(us: TimeUs): string {
  if (!Number.isSafeInteger(us) || us < 0) throw new Error("speech.invalid");
  const totalMs = Math.floor(us / 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** The visible window for a scroll offset; pure so it can be tested. */
export function visibleRange(scrollTop: number, height: number, count: number, rowHeight = TRANSCRIPT_ROW_HEIGHT): { first: number; last: number } {
  if (!Number.isFinite(scrollTop) || scrollTop < 0) return { first: 0, last: 0 };
  const first = Math.max(0, Math.floor(scrollTop / rowHeight));
  const visible = Math.max(1, Math.ceil(height / rowHeight));
  const last = Math.min(count, first + visible + 4);
  return { first: Math.min(first, Math.max(0, count - 1)), last };
}

export function AiTranscriptView({ rows, currentIndex, onSeek, largeTarget = false }: AiTranscriptViewProps) {
  const { t } = useTranslation();
  const scroller = useRef<HTMLDivElement | null>(null);
  const rowHeight = largeTarget ? TRANSCRIPT_ROW_HEIGHT_LARGE : TRANSCRIPT_ROW_HEIGHT;
  const range = useMemo(() => {
    const height = scroller.current?.clientHeight ?? 0;
    return visibleRange(scroller.current?.scrollTop ?? 0, height, rows.length, rowHeight);
  }, [rows.length, rowHeight]);

  return (
    <div
      ref={scroller}
      className="adp-ai-transcript"
      role="list"
      aria-label={t("speech.transcript")}
      aria-rowcount={rows.length}
      style={{ maxHeight: TRANSCRIPT_DOM_ROWS * rowHeight }}
    >
      {rows.slice(range.first, range.last).map((row) => {
        const current = currentIndex === row.index;
        return (
          <div
            key={row.index}
            role="listitem"
            className={`adp-ai-transcript-row${current ? " is-current" : ""}`}
            style={{ height: rowHeight }}
            aria-current={current ? "true" : undefined}
          >
            <button
              type="button"
              className="adp-ai-transcript-time"
              onClick={() => onSeek(row.start_us)}
              aria-label={`${formatTimeUs(row.start_us)}`}
            >
              {formatTimeUs(row.start_us)}
            </button>
            <span className="adp-ai-transcript-text">{row.text}</span>
            {current ? <span aria-hidden="true">▶</span> : null}
          </div>
        );
      })}
    </div>
  );
}
