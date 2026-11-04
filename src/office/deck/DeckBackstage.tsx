import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { DocumentHandle } from "../../documents/types";
import type { OfficeSessionState } from "../types";
import { canOfficeCommand } from "../officeCompatibility";
import { defaultDeckViewport, type DeckEditorViewState } from "./deckUiTypes";

export type DeckBackstageSection = "file" | "export" | "print" | "properties" | "compatibility";

export interface DeckBackstageProps {
  section: DeckBackstageSection;
  onSection: (section: DeckBackstageSection) => void;
  onClose: () => void;
  document: DocumentHandle;
  state: OfficeSessionState;
  view: DeckEditorViewState;
  canSave: boolean;
  canExportPdf: boolean;
  canExportImages: boolean;
  canPrint: boolean;
  onSave: () => void;
  onSaveCopy: () => void;
  onExportPdf: () => void;
  onExportImages: () => void;
  onPrint: () => void;
  onOpenHelp: (slug: string) => void;
}

/** File backstage (Step 22a T3). 240 px navigation plus a content column of
 * at least 320 px, clamped to the viewport minus 32 px. It only calls the
 * safe save/export/capability services; nothing here replaces an existing
 * file and Share never reaches the network. */
export default function DeckBackstage({
  section,
  onSection,
  onClose,
  document,
  state,
  view,
  canSave,
  canExportPdf,
  canExportImages,
  canPrint,
  onSave,
  onSaveCopy,
  onExportPdf,
  onExportImages,
  onPrint,
  onOpenHelp,
}: DeckBackstageProps) {
  const { t } = useTranslation();
  const firstItem = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    firstItem.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const sections: { id: DeckBackstageSection; labelKey: string }[] = [
    { id: "file", labelKey: "officeDeck.backstage.file" },
    { id: "export", labelKey: "officeDeck.backstage.export" },
    { id: "print", labelKey: "officeDeck.backstage.print" },
    { id: "properties", labelKey: "officeDeck.properties" },
    { id: "compatibility", labelKey: "office.compatibility" },
  ];

  return (
    <div className="adp-deck-backstage" role="dialog" aria-modal="true" aria-label={t("officeDeck.backstage.title")}>
      <nav className="adp-deck-backstage-nav" aria-label={t("officeDeck.backstage.title")}>
        {sections.map((entry) => (
          <button
            key={entry.id}
            ref={entry.id === sections[0].id ? firstItem : undefined}
            type="button"
            className={"adp-deck-backstage-navitem" + (entry.id === section ? " adp-deck-backstage-navitem--active" : "")}
            aria-current={entry.id === section ? "page" : undefined}
            onClick={() => onSection(entry.id)}
          >
            {t(entry.labelKey)}
          </button>
        ))}
        <button type="button" className="adp-deck-backstage-navitem" onClick={onClose}>
          {t("officeDeck.backstage.back")}
        </button>
      </nav>
      <section className="adp-deck-backstage-body" aria-label={t(sections.find((entry) => entry.id === section)?.labelKey ?? "officeDeck.backstage.title")}>
        {section === "file" ? (
          <div className="adp-deck-backstage-actions">
            <button type="button" className="adp-btn adp-btn--primary" onClick={onSave} disabled={!canSave}>{t("common.save")}</button>
            <button type="button" className="adp-btn" onClick={onSaveCopy}
              disabled={!canOfficeCommand(state, "save_copy", false).enabled}>{t("office.saveCopy")}</button>
            <button type="button" className="adp-btn" onClick={onExportPdf} disabled={!canExportPdf}>{t("office.exportPdf")}</button>
            <button type="button" className="adp-btn" onClick={onPrint} disabled={!canPrint}>{t("officeDeck.print")}</button>
            <button type="button" className="adp-btn" onClick={onClose}>{t("officeDeck.backstage.close")}</button>
            <button type="button" className="adp-btn adp-btn--subtle" onClick={() => onOpenHelp("editing-presentations")}>
              {t("help.title")}
            </button>
          </div>
        ) : null}
        {section === "export" ? (
          <div className="adp-deck-backstage-actions">
            <p>{t("officeDeck.exportExplanation")}</p>
            <button type="button" className="adp-btn" onClick={onExportPdf} disabled={!canExportPdf}>{t("officeDeck.exportPdfAction")}</button>
            <button type="button" className="adp-btn" onClick={onExportImages} disabled={!canExportImages}>{t("officeDeck.exportImagesAction")}</button>
          </div>
        ) : null}
        {section === "print" ? (
          <div className="adp-deck-backstage-actions">
            <p>{t("officeDeck.printExplanation")}</p>
            <button type="button" className="adp-btn" onClick={onPrint} disabled={!canPrint}>{t("officeDeck.printAction")}</button>
          </div>
        ) : null}
        {section === "properties" ? (
          <dl className="adp-deck-properties">
            <dt>{t("officeDeck.propertiesInfo.name")}</dt><dd>{document.info.name}</dd>
            <dt>{t("officeDeck.propertiesInfo.format")}</dt><dd>{state.format}</dd>
            <dt>{t("officeDeck.propertiesInfo.size")}</dt><dd>{document.info.size}</dd>
            <dt>{t("officeDeck.propertiesInfo.slides")}</dt><dd>{state.slide_count}</dd>
            <dt>{t("officeDeck.propertiesInfo.mode")}</dt><dd>{t(`office.${state.mode}`)}</dd>
            <dt>{t("officeDeck.propertiesInfo.zoom")}</dt><dd>{view.viewport.zoom_percent}%</dd>
          </dl>
        ) : null}
        {section === "compatibility" ? (
          <div className="adp-deck-compatibility">
            <p>{state.compatibility.can_preserve_unknown ? t("officeDeck.compatibilityInfo.preserved") : t("officeDeck.compatibilityInfo.notPreserved")}</p>
            {state.compatibility.blocks_save ? <p role="alert">{t("officeDeck.compatibilityInfo.blocksSave")}</p> : null}
            <ul>
              {state.compatibility.entries.map((entry) => (
                <li key={`${entry.feature_id}-${entry.state}`}>
                  <span>{entry.feature_id}</span>
                  <span>{t(`officeDeck.compatibilityInfo.state.${entry.state}`)}</span>
                  <span>{entry.count}</span>
                </li>
              ))}
            </ul>
            <p>{t("officeDeck.compatibilityInfo.localOnly")}</p>
          </div>
        ) : null}
      </section>
    </div>
  );
}

/** Default canvas state used when a backstage dialog opens without a view. */
export const DECK_BACKSTAGE_DEFAULT_VIEW: DeckEditorViewState = {
  slide_id: null,
  selection: null,
  viewport: defaultDeckViewport(),
  active_ribbon_tab: "deck.file",
  notes_open: true,
  slides_open: true,
  comments_open: false,
  snap: false,
};
