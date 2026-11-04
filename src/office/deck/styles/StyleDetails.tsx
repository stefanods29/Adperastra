import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { OfficeColor } from "../../types";
import type { DeckStyle } from "./styleTypes";

/** Style details: palette, fonts, layouts, density and display-only guidance. */

export interface StyleDetailsProps {
  style: DeckStyle;
  eligible: boolean;
  ineligibleReason: string | null;
  canRemove: boolean;
  canExport: boolean;
  onApply: () => void;
  onClose: () => void;
  onRemove: () => void;
  onExport: () => void;
}

function cssColor(color: OfficeColor): string {
  const value = color as unknown as { r: number; g: number; b: number };
  return `rgb(${value.r} ${value.g} ${value.b})`;
}

function styleName(style: DeckStyle, translate: (key: string) => string): string {
  return style.name_key ? translate(style.name_key) : (style.name ?? "");
}

export function StyleDetails({
  style,
  eligible,
  ineligibleReason,
  canRemove,
  canExport,
  onApply,
  onClose,
  onRemove,
  onExport,
}: StyleDetailsProps) {
  const { t } = useTranslation();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const name = styleName(style, t);
  const roles = ["background", "text", "muted", "accent", "accent2", "surface"] as const;

  return (
    <section className="adp-deck-style-details" aria-label={t("deckStyle.details")}>
      <header className="adp-deck-style-details-header">
        <h3>{name}</h3>
        <button type="button" onClick={onClose} aria-label={t("common.close")}>
          ×
        </button>
      </header>
      {style.description_key ? <p>{t(style.description_key)}</p> : null}

      <div className="adp-deck-style-details-swatches" aria-hidden="true">
        {roles.map((role) => (
          <span key={role} style={{ backgroundColor: cssColor(style.theme.colors[role]) }} />
        ))}
      </div>

      <dl className="adp-deck-style-details-facts">
        <dt>{t("deckStyle.details")}</dt>
        <dd>
          {style.theme.heading_font.family} / {style.theme.body_font.family}
        </dd>
        <dt>{t("deckStyle.guidance", {
          bullets: style.guidance.max_bullets,
          words: style.guidance.max_words_per_bullet,
        })}</dt>
        <dd>{t(`deckStyle.${style.density}`)}</dd>
        {style.guidance.advice_key ? <dd>{t(style.guidance.advice_key)}</dd> : null}
      </dl>

      <ul className="adp-deck-style-details-layouts">
        {style.theme.layouts.map((layout) => (
          <li key={layout.id}>{layout.name.startsWith("deckStyle.layout.") ? t(layout.name) : layout.name}</li>
        ))}
      </ul>

      {!eligible && ineligibleReason ? (
        <p className="adp-deck-style-details-warning">{t(ineligibleReason)}</p>
      ) : null}

      {confirmRemove ? (
        <div className="adp-deck-style-details-confirm" role="alertdialog" aria-labelledby="deck-style-remove-confirm">
          <p id="deck-style-remove-confirm">{t("deckStyle.removeConfirm")}</p>
          <button type="button" onClick={onRemove}>
            {t("deckStyle.remove")}
          </button>
          <button type="button" onClick={() => setConfirmRemove(false)}>
            {t("common.cancel")}
          </button>
        </div>
      ) : null}

      <footer className="adp-deck-style-details-actions">
        <button type="button" onClick={onApply} disabled={!eligible}>
          {t("deckStyle.apply")}
        </button>
        <button type="button" onClick={onExport} disabled={style.builtin || !canExport}>
          {t("deckStyle.export")}
        </button>
        {canRemove ? (
          <button type="button" onClick={() => setConfirmRemove(true)}>
            {t("deckStyle.remove")}
          </button>
        ) : null}
      </footer>
    </section>
  );
}
