import { useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  DECK_AI_LAYOUT_KINDS,
  type DeckAiLayoutKind,
  type DeckAiOutline,
  type DeckAiSlide,
} from "./deckAiTypes";

/** Ordered outline cards with inline editing. Alt+Up/Down moves a slide and
 * announces its new position; Enter never accepts globally. */

export interface DeckAiOutlineEditorProps {
  outline: DeckAiOutline;
  disabled: boolean;
  onChange: (outline: DeckAiOutline) => void;
}

export function DeckAiOutlineEditor({ outline, disabled, onChange }: DeckAiOutlineEditorProps) {
  const { t } = useTranslation();
  const [announcement, setAnnouncement] = useState("");
  const listRef = useRef<HTMLOListElement | null>(null);
  const virtual = useVirtualizer({
    count: outline.slides.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 120,
    overscan: 4,
  });

  const updateSlide = (index: number, patch: Partial<DeckAiSlide>) => {
    const slides = outline.slides.map((slide, at) => (at === index ? { ...slide, ...patch } : slide));
    onChange({ ...outline, slides });
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= outline.slides.length) return;
    const slides = [...outline.slides];
    const [item] = slides.splice(index, 1);
    slides.splice(target, 0, item);
    onChange({ ...outline, slides });
    setAnnouncement(t("deckAi.position", { index: target + 1, total: slides.length }));
  };

  const renderSlide = (index: number, style?: CSSProperties) => {
    const slide = outline.slides[index];
    return (
      <li key={slide.outline_id} className="deck-ai-slide-card" style={style}>
        <button
          type="button"
          className="deck-ai-slide-heading"
          disabled={disabled}
          onClick={() => setAnnouncement(t("deckAi.position", { index: index + 1, total: outline.slides.length }))}
          onKeyDown={(event) => {
            if (event.altKey && event.key === "ArrowUp") {
              event.preventDefault();
              move(index, -1);
            } else if (event.altKey && event.key === "ArrowDown") {
              event.preventDefault();
              move(index, 1);
            }
          }}
        >
          {t("deckAi.position", { index: index + 1, total: outline.slides.length })}
        </button>

        <label>
          <span>{t("deckAi.outline")}</span>
          <select
            value={slide.layout_kind}
            disabled={disabled}
            onChange={(event) => updateSlide(index, { layout_kind: event.target.value as DeckAiLayoutKind })}
          >
            {DECK_AI_LAYOUT_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`deckStyle.layout.${kind}`)}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>{t("deckStyle.name")}</span>
          <input
            type="text"
            maxLength={160}
            value={slide.title}
            disabled={disabled}
            onChange={(event) => updateSlide(index, { title: event.target.value })}
          />
        </label>

        <ul className="deck-ai-bullets">
          {slide.bullets.map((bullet, bulletIndex) => (
            <li key={`${slide.outline_id}-${bulletIndex}`}>
              <input
                type="text"
                maxLength={240}
                value={bullet}
                disabled={disabled}
                aria-label={`${t("deckAi.outline")} ${bulletIndex + 1}`}
                onChange={(event) => {
                  const bullets = [...slide.bullets];
                  bullets[bulletIndex] = event.target.value;
                  updateSlide(index, { bullets });
                }}
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => updateSlide(index, { bullets: slide.bullets.filter((_, at) => at !== bulletIndex) })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        {!disabled ? (
          <button type="button" onClick={() => updateSlide(index, { bullets: [...slide.bullets, ""] })}>
            +
          </button>
        ) : null}

        <details>
          <summary>{t("deckAi.notes")}</summary>
          <textarea
            maxLength={8000}
            value={slide.speaker_notes}
            disabled={disabled}
            onChange={(event) => updateSlide(index, { speaker_notes: event.target.value })}
          />
          <p>{t("deckAi.notesPrivate")}</p>
        </details>

        {slide.images.length > 0 ? (
          <p className="deck-ai-image-note">{t("deckAi.imageSuggestion")}</p>
        ) : null}
      </li>
    );
  };

  const virtualized = outline.slides.length > 12;
  return (
    <div className="deck-ai-outline">
      <ol
        ref={listRef}
        className="deck-ai-outline-list"
        style={virtualized ? { position: "relative", height: virtual.getTotalSize() } : undefined}
      >
        {virtualized
          ? virtual
              .getVirtualItems()
              .map((item) =>
                renderSlide(item.index, {
                  position: "absolute",
                  top: item.start,
                  left: 0,
                  width: "100%",
                }),
              )
          : outline.slides.map((_, index) => renderSlide(index))}
      </ol>
      <p role="status" aria-live="polite" className="deck-ai-announcement">
        {announcement}
      </p>
    </div>
  );
}
