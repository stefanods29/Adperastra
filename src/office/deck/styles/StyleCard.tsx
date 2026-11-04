import type { CSSProperties, KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import type { OfficeColor } from "../../types";
import type { DeckStyle } from "./styleTypes";

/** One library card. The preview is synthetic (layout labels and palette
 * only); no active document content is copied into the DOM. */

export interface StyleCardProps {
  style: DeckStyle;
  focused: boolean;
  selected: boolean;
  eligible: boolean;
  ineligibleReason: string | null;
  onFocus: () => void;
  onApply: () => void;
  onDetails: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

function cssColor(color: OfficeColor): string {
  const value = color as unknown as { r: number; g: number; b: number };
  return `rgb(${value.r} ${value.g} ${value.b})`;
}

function styleName(style: DeckStyle, translate: (key: string) => string): string {
  if (style.name_key) return translate(style.name_key);
  return style.name ?? "";
}

export function StyleCard({
  style,
  focused,
  selected,
  eligible,
  ineligibleReason,
  onFocus,
  onApply,
  onDetails,
  onKeyDown,
}: StyleCardProps) {
  const { t } = useTranslation();
  const name = styleName(style, t);
  const colors = style.theme.colors;
  const variables = {
    "--adp-style-background": cssColor(colors.background),
    "--adp-style-text": cssColor(colors.text),
    "--adp-style-muted": cssColor(colors.muted),
    "--adp-style-accent": cssColor(colors.accent),
    "--adp-style-accent2": cssColor(colors.accent2),
    "--adp-style-surface": cssColor(colors.surface),
  } as CSSProperties;

  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown(event);
    if (event.defaultPrevented) return;
    if (event.key === "Enter" && eligible) {
      event.preventDefault();
      onApply();
    } else if (event.key === " ") {
      event.preventDefault();
      onDetails();
    }
  };

  return (
    <div
      role="option"
      aria-selected={selected}
      aria-label={`${name}, ${t(`deckStyle.${style.density}`)}`}
      aria-disabled={!eligible}
      tabIndex={focused ? 0 : -1}
      className={`adp-deck-style-card${selected ? " adp-deck-style-card-selected" : ""}${
        eligible ? "" : " adp-deck-style-card-ineligible"
      }`}
      style={variables}
      onFocus={onFocus}
      onKeyDown={keyboard}
      onClick={onFocus}
      onDoubleClick={() => {
        if (eligible) onApply();
      }}
    >
      <div className="adp-deck-style-card-preview" aria-hidden="true">
        <span className="adp-deck-style-card-preview-title" />
        <span className="adp-deck-style-card-preview-body" />
        <span className="adp-deck-style-card-preview-body short" />
        <span className="adp-deck-style-card-preview-accent" />
        <span className="adp-deck-style-card-preview-footer" />
      </div>
      <div className="adp-deck-style-card-meta">
        <span className="adp-deck-style-card-name">{name}</span>
        <span className="adp-deck-style-card-density">
          {t(style.builtin ? "deckStyle.builtin" : "deckStyle.custom")} · {t(`deckStyle.${style.density}`)}
        </span>
      </div>
      {!eligible && ineligibleReason ? (
        <span className="adp-deck-style-card-reason">{t(ineligibleReason)}</span>
      ) : null}
    </div>
  );
}
