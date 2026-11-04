import { useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Dialog from "../../components/Dialog";
import { errorText } from "../../services/errors";
import type { OfficeController } from "../OfficeController";
import {
  exportDeckPdf, exportDeckSlideImages, type DeckExportPublisher, type DeckExportResult,
} from "./deckExport";

export interface DeckExportDialogProps {
  controller: OfficeController;
  publisher: DeckExportPublisher;
  initialFormat: "pdf" | "images";
  slideCount: number;
  selectedSlideIndexes: readonly number[];
  canExportPdf: boolean;
  canExportImages: boolean;
  onClose: () => void;
  onOpenHelp: (slug: string) => void;
}

/** Export dialog (Step 22a T8). PDF is one bounded export; slide images are
 * separate bounded exports with a report of the paths that actually exist.
 * A failed or cancelled output is listed, never shown as a created file. */
export default function DeckExportDialog({
  controller,
  publisher,
  initialFormat,
  slideCount,
  selectedSlideIndexes,
  canExportPdf,
  canExportImages,
  onClose,
  onOpenHelp,
}: DeckExportDialogProps) {
  const { t } = useTranslation();
  const [format, setFormat] = useState(initialFormat);
  const [scope, setScope] = useState<"all" | "selected">(selectedSlideIndexes.length > 0 ? "selected" : "all");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DeckExportResult | null>(null);
  const [error, setError] = useState<unknown>(null);

  const allowed = format === "pdf" ? canExportPdf : canExportImages;
  const run = async () => {
    if (!allowed) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const indexes = scope === "selected" && selectedSlideIndexes.length > 0
        ? selectedSlideIndexes
        : Array.from({ length: Math.max(1, Math.min(100, slideCount)) }, (_, index) => index);
      const next = format === "pdf"
        ? await exportDeckPdf(controller, publisher, [{ first: 1, last: Math.max(1, Math.min(100, slideCount)) }])
        : await exportDeckSlideImages(controller, publisher, indexes);
      setResult(next);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={t("officeDeck.exportTitle")} onClose={onClose} className="adp-deck-export-dialog">
      {error ? <p className="adp-deck-error" role="alert">{errorText(t, error, "office_edit")}</p> : null}
      <label className="adp-deck-field">
        <span>{t("officeDeck.exportFormat")}</span>
        <select value={format} onChange={(event) => setFormat(event.target.value === "images" ? "images" : "pdf")}>
          <option value="pdf" disabled={!canExportPdf}>PDF</option>
          <option value="images" disabled={!canExportImages}>PNG</option>
        </select>
      </label>
      <fieldset className="adp-deck-field">
        <legend>{t("officeDeck.exportScope")}</legend>
        <label className="adp-deck-check">
          <input type="radio" checked={scope === "all"} onChange={() => setScope("all")} />
          <span>{t("officeDeck.exportAll")}</span>
        </label>
        <label className="adp-deck-check">
          <input type="radio" checked={scope === "selected"} disabled={selectedSlideIndexes.length === 0}
            onChange={() => setScope("selected")} />
          <span>{t("officeDeck.exportSelected", { count: selectedSlideIndexes.length })}</span>
        </label>
      </fieldset>
      <p className="adp-deck-hint">{t("officeDeck.exportGroupedUndo")}</p>
      {result ? (
        <section className="adp-deck-export-result" aria-live="polite">
          <h3>{t("officeDeck.exportResult")}</h3>
          {result.cancelled ? <p>{t("officeDeck.exportCancelled")}</p> : null}
          <ul>
            {result.artifacts.map((artifact) => (
              <li key={artifact.snapshot_id}>
                <span>{artifact.slide_index === null ? "PDF" : `${artifact.slide_index + 1}`}</span>
                <span>{artifact.path}</span>
              </li>
            ))}
          </ul>
          {result.failures.length > 0 ? (
            <div role="alert">
              <p>{t("officeDeck.exportFailures")}</p>
              <ul>
                {result.failures.map((failure) => (
                  <li key={`${failure.slide_index}-${failure.error_code}`}>
                    {failure.slide_index === null ? "PDF" : failure.slide_index + 1}: {failure.error_code}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
      <footer className="adp-deck-dialog-footer">
        <button type="button" className="adp-btn adp-btn--subtle" onClick={() => onOpenHelp("editing-presentations")}>
          {t("help.title")}
        </button>
        <span className="adp-deck-header-spacer" />
        <Button onClick={onClose}>{t("common.close")}</Button>
        <Button variant="primary" disabled={busy || !allowed} onClick={() => { void run(); }}>
          {busy ? t("officeDeck.exporting") : t("officeDeck.exportAction")}
        </Button>
      </footer>
    </Dialog>
  );
}
