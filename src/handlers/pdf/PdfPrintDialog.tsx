import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/Button";
import Dialog from "../../components/Dialog";
import TextInput from "../../components/TextInput";
import { errorText } from "../../services/errors";
import type { JobHandle } from "../../services/jobs";
import { PDF_MAX_PRINT_PAGES, pdfPrintRangeError, printPdf, type PdfSession } from "../../services/pdf";

/** Print a range of pages (Step 07d T6, D8).
 *
 * Nothing is printed before the user presses Print. The range is checked in
 * the dialog and again in Rust; a document that does not allow printing has
 * no usable Print button. The system's own print window chooses the printer
 * and asks for confirmation. */

export interface PdfPrintDialogProps {
  session: PdfSession;
  /** The page the user is on; the range starts there. */
  page: number;
  onClose: () => void;
  /** The print request started; the dialog stays open until it ends. */
  onStarted?: () => void;
  onFinished?: () => void;
}

export default function PdfPrintDialog({ session, page, onClose, onStarted, onFinished }: PdfPrintDialogProps) {
  const { t } = useTranslation();
  const count = session.page_count;
  const canPrint = session.permissions.can_print;
  const [first, setFirst] = useState(String(Math.min(page, count)));
  const [last, setLast] = useState(String(Math.min(page, count)));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const job = useRef<JobHandle<void> | null>(null);
  const closed = useRef(false);

  useEffect(
    () => () => {
      closed.current = true;
      void job.current?.cancel();
    },
    [],
  );

  const start = async () => {
    const from = Number(first);
    const to = Number(last);
    const problem = pdfPrintRangeError(from, to, count, canPrint);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    onStarted?.();
    try {
      const started = await printPdf(session.session_id, from, to);
      job.current = started;
      if (closed.current) {
        void started.cancel();
        return;
      }
      await started.completion;
      if (closed.current) return;
      onFinished?.();
      onClose();
    } catch (failure) {
      if (closed.current) return;
      setError(failure);
      setBusy(false);
    } finally {
      job.current = null;
    }
  };

  const close = () => {
    closed.current = true;
    void job.current?.cancel();
    onClose();
  };

  return (
    <Dialog title={t("pdf.printRange")} onClose={close} className="adp-pdf-print">
      <p className="adp-pdf-print-note">
        {t("pdf.page", { page, count })}
      </p>
      <div className="adp-pdf-print-range">
        <label className="adp-pdf-print-field">
          <span>{t("pdf.printFirst")}</span>
          <TextInput
            value={first}
            onChange={setFirst}
            ariaLabel={t("pdf.printFirst")}
            type="number"
            disabled={busy || !canPrint}
          />
        </label>
        <label className="adp-pdf-print-field">
          <span>{t("pdf.printLast")}</span>
          <TextInput
            value={last}
            onChange={setLast}
            ariaLabel={t("pdf.printLast")}
            type="number"
            disabled={busy || !canPrint}
          />
        </label>
        <span className="adp-pdf-print-limit">{t("pdf.printLimit", { count: PDF_MAX_PRINT_PAGES })}</span>
      </div>
      {!canPrint ? (
        <p className="adp-pdf-print-error" role="alert">
          {t("errors.pdf.permissions")}
        </p>
      ) : null}
      {error !== null ? (
        <p className="adp-pdf-print-error" role="alert">
          {errorText(t, error, "pdf")}
        </p>
      ) : null}
      {busy ? (
        <p className="adp-pdf-print-status" role="status">
          {t("pdf.printing")}
        </p>
      ) : null}
      <div className="adp-dialog-actions">
        <Button onClick={close}>{t("common.cancel")}</Button>
        <Button variant="primary" onClick={() => void start()} disabled={busy || !canPrint}>
          {t("pdf.print")}
        </Button>
      </div>
    </Dialog>
  );
}
