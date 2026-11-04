import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Dialog from "../../components/Dialog";
import type { DeckTheme, OfficeColor } from "../types";
import { colorFromHex, colorHex } from "./DeckTextControls";
import { validateDeckTheme } from "./deckThemes";

export interface DeckMasterEditorProps {
  mode: "theme" | "master";
  theme: DeckTheme;
  slideIds: readonly string[] | null;
  disabled: boolean;
  onApply: (theme: DeckTheme) => void;
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
}

const COLOR_KEYS = ["background", "text", "muted", "accent", "accent2", "surface"] as const;

/** Theme and slide-master editor (Step 22a T5). Nothing is written until
 * Apply; the palette/theme picker only edits a local copy. Manual formatting
 * and objects without a matching placeholder are never removed by a theme. */
export default function DeckMasterEditor({
  mode,
  theme,
  slideIds,
  disabled,
  onApply,
  onClose,
  onOpenHelp,
}: DeckMasterEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<DeckTheme>(theme);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(theme);
  }, [theme]);

  const updateColor = (key: (typeof COLOR_KEYS)[number], value: string) => {
    const color = colorFromHex(value);
    setDraft((current) => ({ ...current, colors: { ...current.colors, [key]: color } }));
  };

  const apply = () => {
    const next = { ...draft, name: draft.name.trim() };
    if (!validateDeckTheme(next)) {
      setError(t("errors.deck.invalid_theme"));
      return;
    }
    setError(null);
    onApply(next);
  };

  return (
    <Dialog title={mode === "master" ? t("officeDeck.master") : t("officeDeck.theme")} onClose={onClose} className="adp-deck-master-dialog">
      <p className="adp-deck-hint">{t("officeDeck.themeHint")}</p>
      <label className="adp-deck-field">
        <span>{t("officeDeck.themeName")}</span>
        <input value={draft.name} maxLength={60}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      </label>
      <div className="adp-deck-color-grid">
        {COLOR_KEYS.map((key) => (
          <label key={key} className="adp-deck-field">
            <span>{t(`officeDeck.color.${key}`)}</span>
            <input
              type="color"
              value={colorHex(draft.colors[key] as OfficeColor)}
              onChange={(event) => updateColor(key, event.target.value)}
            />
          </label>
        ))}
      </div>
      <div className="adp-deck-grid-fields">
        <label className="adp-deck-field">
          <span>{t("officeDeck.headingFont")}</span>
          <input value={draft.heading_font.family} maxLength={128}
            onChange={(event) => setDraft({ ...draft, heading_font: { ...draft.heading_font, family: event.target.value } })} />
        </label>
        <label className="adp-deck-field">
          <span>{t("officeDeck.bodyFont")}</span>
          <input value={draft.body_font.family} maxLength={128}
            onChange={(event) => setDraft({ ...draft, body_font: { ...draft.body_font, family: event.target.value } })} />
        </label>
      </div>
      <label className="adp-deck-field">
        <span>{t("officeDeck.densityLabel")}</span>
        <select value={draft.density}
          onChange={(event) => setDraft({ ...draft, density: event.target.value === "compact" ? "compact" : "comfortable" })}>
          <option value="comfortable">{t("officeDeck.density.comfortable")}</option>
          <option value="compact">{t("officeDeck.density.compact")}</option>
        </select>
      </label>
      <p className="adp-deck-hint">
        {slideIds === null ? t("officeDeck.themeAllSlides") : t("officeDeck.themeSelectedSlides", { count: slideIds.length })}
      </p>
      {error ? <p className="adp-deck-error" role="alert">{error}</p> : null}
      <footer className="adp-deck-dialog-footer">
        <button type="button" className="adp-btn adp-btn--subtle" onClick={() => onOpenHelp("deck-layouts-and-themes")}>
          {t("help.title")}
        </button>
        <span className="adp-deck-header-spacer" />
        <Button onClick={onClose}>{t("common.cancel")}</Button>
        <Button variant="primary" disabled={disabled} onClick={apply}>{t("officeDeck.applyTheme")}</Button>
      </footer>
    </Dialog>
  );
}
