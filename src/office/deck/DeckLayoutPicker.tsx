import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Dialog from "../../components/Dialog";
import type { DeckLayout, DeckTheme } from "../types";

export interface DeckLayoutPickerProps {
  theme: DeckTheme | null;
  slideIds: readonly string[];
  disabled: boolean;
  onApply: (layoutId: string) => void;
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
}

/** Layout picker (Step 22a T5). Choosing a layout is a preview until
 * Confirm; apply_layout keeps every object (preserve_content true) and the
 * engine reports unmatched objects instead of dropping them. */
export default function DeckLayoutPicker({
  theme,
  slideIds,
  disabled,
  onApply,
  onClose,
  onOpenHelp,
}: DeckLayoutPickerProps) {
  const { t } = useTranslation();
  const layouts = theme?.layouts ?? [];
  return (
    <Dialog title={t("officeDeck.layout")} onClose={onClose} className="adp-deck-layout-dialog">
      <p className="adp-deck-hint">{t("officeDeck.layoutHint")}</p>
      <div className="adp-deck-layout-grid" role="listbox" aria-label={t("officeDeck.layout")}>
        {layouts.map((layout) => (
          <button
            key={layout.id}
            type="button"
            role="option"
            aria-selected={false}
            className="adp-deck-layout-card"
            disabled={disabled}
            onClick={() => onApply(layout.id)}
          >
            <span
              className="adp-deck-layout-preview"
              style={{ aspectRatio: `${theme?.slide_width_pt ?? 720} / ${theme?.slide_height_pt ?? 405}` }}
              aria-hidden="true"
            >
              {layout.placeholders.map((placeholder) => (
                <span
                  key={placeholder.id}
                  className="adp-deck-layout-placeholder"
                  style={{
                    left: `${(placeholder.rect.x_pt / (theme?.slide_width_pt ?? 720)) * 100}%`,
                    top: `${(placeholder.rect.y_pt / (theme?.slide_height_pt ?? 405)) * 100}%`,
                    width: `${(placeholder.rect.width_pt / (theme?.slide_width_pt ?? 720)) * 100}%`,
                    height: `${(placeholder.rect.height_pt / (theme?.slide_height_pt ?? 405)) * 100}%`,
                  }}
                />
              ))}
            </span>
            <span>{layout.name}</span>
          </button>
        ))}
      </div>
      <footer className="adp-deck-dialog-footer">
        <button type="button" className="adp-btn adp-btn--subtle" onClick={() => onOpenHelp("deck-layouts-and-themes")}>
          {t("help.title")}
        </button>
        <span className="adp-deck-header-spacer" />
        <span className="adp-deck-hint">
          {t("officeDeck.layoutSelection", { count: slideIds.length })}
        </span>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
      </footer>
    </Dialog>
  );
}

/** A layout's placeholders as readable text, used by the master editor. */
export function layoutSummary(layout: DeckLayout): string {
  return layout.placeholders.map((placeholder) => placeholder.role).join(", ");
}
