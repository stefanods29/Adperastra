import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { clampPanelSize, NOTES_HEIGHT_DEFAULT, NOTES_HEIGHT_MAX, NOTES_HEIGHT_MIN } from "./deckCoordinates";

export interface SlideNotesProps {
  text: string;
  open: boolean;
  readOnly: boolean;
  height?: number;
  onHeight: (height: number) => void;
  onToggle: () => void;
  onCommit: (text: string) => void;
  onOpenHelp: (slug: string) => void;
}

/** Speaker notes under the canvas (Step 22a T2, D2/D9).
 *
 * Notes are private content. They are edited as plain text and never enter
 * the slide image, an `<img alt>`, a log, a session view state or the
 * audience helper frame. Only the presenter view may display them. */
export default function SlideNotes({
  text,
  open,
  readOnly,
  height = NOTES_HEIGHT_DEFAULT,
  onHeight,
  onToggle,
  onCommit,
  onOpenHelp,
}: SlideNotesProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(text);
  const [resizing, setResizing] = useState<number | null>(null);

  useEffect(() => {
    setValue(text);
  }, [text]);

  if (!open) {
    return (
      <button
        type="button"
        className="adp-deck-notes-toggle"
        aria-expanded={false}
        onClick={onToggle}
      >
        {t("officeDeck.notes")}
      </button>
    );
  }

  return (
    <section className="adp-deck-notes" style={{ height }} aria-label={t("officeDeck.notes")}>
      <header className="adp-deck-notes-head">
        <span>{t("officeDeck.notes")}</span>
        <span className="adp-deck-private">{t("officeDeck.notesPrivate")}</span>
        <button
          type="button"
          className="adp-icon-btn"
          aria-label={t("officeDeck.notes")}
          aria-expanded={true}
          onClick={onToggle}
        >
          ×
        </button>
      </header>
      <textarea
        className="adp-deck-notes-text"
        value={readOnly ? text : value}
        readOnly={readOnly}
        placeholder={t("officeDeck.notesPlaceholder")}
        aria-label={t("officeDeck.notes")}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => {
          if (!readOnly && value !== text) onCommit(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setValue(text);
            event.currentTarget.blur();
          }
        }}
      />
      <div
        className="adp-deck-notes-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label={t("officeDeck.notesHeight")}
        tabIndex={0}
        onPointerDown={(event) => {
          setResizing(event.clientY);
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (resizing === null) return;
          onHeight(clampPanelSize(height - (event.clientY - resizing), NOTES_HEIGHT_MIN, NOTES_HEIGHT_MAX, height));
        }}
        onPointerUp={() => setResizing(null)}
      />
      <button
        type="button"
        className="adp-deck-notes-help"
        onClick={() => onOpenHelp("presenting-slides")}
      >
        {t("officeDeck.notesHelp")}
      </button>
    </section>
  );
}
