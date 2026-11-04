import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DeckTemplateInspection } from "../../../services/officeDeck";
import { errorText } from "../../../services/errors";
import {
  importTemplateStyle,
  type StyleFontMapping,
} from "./styleImport";
import {
  INTER_BOLD_ASSET_ID,
  INTER_REGULAR_ASSET_ID,
} from "./styleFonts";
import type { DeckStyle } from "./styleTypes";
import { MAX_DECK_STYLE_NAME } from "./styleTypes";

/** Import from template: only normalized colors, licensed fonts and layouts
 * are imported. Template text, notes, images and active content are never
 * shown or stored. */

export interface StyleImportDialogProps {
  inspection: DeckTemplateInspection;
  onClose: () => void;
  onImported: (style: DeckStyle) => void;
  onOpenHelp: (slug: string) => void;
}

function templateFamilies(inspection: DeckTemplateInspection, themeId: string): string[] {
  const theme = inspection.themes.find((item) => item.id === themeId) ?? inspection.themes[0];
  if (!theme) return [];
  const needsMapping = (font: DeckTemplateInspection["themes"][number]["heading_font"]) =>
    font.family !== "Inter" || font.source !== "bundled" || !font.embeddable;
  return [...new Set([theme.heading_font, theme.body_font].filter(needsMapping).map((font) => font.family))];
}

export function StyleImportDialog({
  inspection,
  onClose,
  onImported,
  onOpenHelp,
}: StyleImportDialogProps) {
  const { t } = useTranslation();
  const [themeId, setThemeId] = useState(inspection.themes[0]?.id ?? "");
  const [name, setName] = useState(t("deckStyle.custom"));
  const [acknowledged, setAcknowledged] = useState(false);
  const [mappings, setMappings] = useState<Record<string, "inter-regular" | "inter-bold">>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const families = useMemo(() => templateFamilies(inspection, themeId), [inspection, themeId]);
  const theme = inspection.themes.find((item) => item.id === themeId);
  const nameValid = [...name].length >= 1 && [...name].length <= MAX_DECK_STYLE_NAME && name.trim() === name;
  const mapsComplete = families.every((family) => mappings[family]);
  const canImport = Boolean(theme) && nameValid && acknowledged && mapsComplete && !busy;

  const chooseMapping = (family: string, target: "inter-regular" | "inter-bold") => {
    setMappings((current) => ({ ...current, [family]: target }));
  };

  const runImport = async () => {
    if (!theme || !canImport) return;
    setBusy(true);
    setError(null);
    try {
      const fontMap: StyleFontMapping[] = families.map((family) => ({
        from_family: family,
        to_asset_id: mappings[family] ?? INTER_REGULAR_ASSET_ID,
      }));
      const style = await importTemplateStyle(inspection.inspection_id, theme.id, name, fontMap);
      onImported(style);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="adp-deck-style-import" role="dialog" aria-modal="true" aria-labelledby="deck-style-import-title">
      <header className="adp-deck-style-import-header">
        <h2 id="deck-style-import-title">{t("deckStyle.import")}</h2>
        <button
          type="button"
          className="adp-deck-style-import-help"
          aria-label={t("help.title")}
          onClick={() => onOpenHelp("deck-importing-styles")}
        >
          ?
        </button>
      </header>

      <label className="adp-deck-style-import-field">
        <span>{t("deckStyle.name")}</span>
        <input
          type="text"
          maxLength={MAX_DECK_STYLE_NAME}
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={!nameValid}
        />
      </label>

      <fieldset className="adp-deck-style-import-themes">
        <legend>{t("officeDeck.theme")}</legend>
        {inspection.themes.map((candidate) => (
          <label key={candidate.id}>
            <input
              type="radio"
              name="deck-style-template-theme"
              value={candidate.id}
              checked={candidate.id === themeId}
              onChange={() => setThemeId(candidate.id)}
            />
            <span
              className="adp-deck-style-import-swatch"
              aria-hidden="true"
              style={{ background: `#${candidate.colors.background.r.toString(16).padStart(2, "0")}${candidate.colors.background.g
                .toString(16)
                .padStart(2, "0")}${candidate.colors.background.b.toString(16).padStart(2, "0")}` }}
            />
            <span>{candidate.layouts.length}</span>
          </label>
        ))}
      </fieldset>

      {families.length > 0 ? (
        <fieldset className="adp-deck-style-import-fonts">
          <legend>{t("deckStyle.fontMap", { from: families[0], to: "Inter" })}</legend>
          {families.map((family) => (
            <label key={family}>
              <span>{t("deckStyle.fontMap", { from: family, to: "Inter" })}</span>
              <select
                value={mappings[family] ?? INTER_REGULAR_ASSET_ID}
                onChange={(event) =>
                  chooseMapping(family, event.target.value === INTER_BOLD_ASSET_ID ? INTER_BOLD_ASSET_ID : INTER_REGULAR_ASSET_ID)
                }
              >
                <option value={INTER_REGULAR_ASSET_ID}>Inter Regular</option>
                <option value={INTER_BOLD_ASSET_ID}>Inter Bold</option>
              </select>
            </label>
          ))}
        </fieldset>
      ) : null}

      <label className="adp-deck-style-import-omit">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        <span>{t("deckStyle.omitted")}</span>
      </label>

      {inspection.warnings.length > 0 ? (
        <ul className="adp-deck-style-import-warnings">
          {inspection.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="adp-deck-style-import-error" role="alert">
          {errorText(t, error, "deck_style")}
        </p>
      ) : null}

      <footer className="adp-deck-style-import-actions">
        <button type="button" onClick={onClose} disabled={busy}>
          {t("common.cancel")}
        </button>
        <button type="button" className="adp-deck-style-import-confirm" onClick={runImport} disabled={!canImport}>
          {t("deckStyle.import")}
        </button>
      </footer>
    </div>
  );
}
