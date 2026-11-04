import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DocumentOperation } from "../types";

type DocumentStyle = Extract<DocumentOperation, { kind: "upsert_style" }>["style"];

export function DocumentStyleGallery({ styles, selectedId, blockIds, disabled, onApply }: {
  styles: readonly DocumentStyle[]; selectedId: string | null; blockIds: readonly string[];
  disabled: boolean; onApply: (operation: DocumentOperation) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return <section aria-label={t("officeDoc.style")} className="adp-office-document-styles">
    {styles.map((style) => <button type="button" key={style.id} aria-pressed={style.id === selectedId}
      className="adp-office-document-style" disabled={disabled || busy || blockIds.length === 0 || blockIds.length > 1000}
      onClick={() => {
        setBusy(true); setError(false);
        void onApply({ kind: "apply_style", block_ids: [...blockIds], style_id: style.id })
          .catch(() => setError(true)).finally(() => setBusy(false));
      }}>{style.name}</button>)}
    {error ? <p role="alert">{t("errors.office_edit.failed")}</p> : null}
  </section>;
}
