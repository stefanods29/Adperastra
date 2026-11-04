import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { JobHandle } from "../../services/jobs";
import { createOfficeBlankDraft, type OfficeBlankDraftHandle } from "../../services/officeDrafts";

type BlankDocument = OfficeBlankDraftHandle;

/** The native blank-document job: the host adopts exactly the returned shared
 * handle/controller. Cancel before adoption releases only the unacquired
 * draft; an edited draft stays owned by the normal unsaved-close policy. */
export function startBlankDocument(
  onOpenDraft: (draft: BlankDocument) => Promise<void>,
  onError: (error: unknown) => void,
) {
  let cancelled = false;
  let handle: JobHandle<BlankDocument> | null = null;
  const completion = (async () => {
    try {
      handle = await createOfficeBlankDraft("document");
      if (cancelled) {
        try { await handle.cancel(); } catch { /* completion remains authoritative */ }
      }
      const draft = await handle.completion;
      if (cancelled) {
        try { await draft.controller.close(); } finally { draft.document.release(); }
        return;
      }
      try { await onOpenDraft(draft); }
      catch (error) {
        try { await draft.controller.close(); } finally { draft.document.release(); }
        throw error;
      }
    } catch (error) { if (!cancelled) onError(error); }
  })();
  return {
    completion,
    cancel: async () => {
      cancelled = true;
      try { await handle?.cancel(); } catch (error) { onError(error); }
    },
  };
}

/** File pane for the document editor. It owns no path: New returns the native
 * shared draft, and every other action is delegated to the application host. */
export default function DocumentBackstage({ canCreate, onOpenDraft, onOpen, onSaveCopy, onExportPdf, onProperties, onClose, onError }: {
  canCreate: boolean;
  onOpenDraft: (draft: BlankDocument) => Promise<void>;
  onOpen: () => void;
  onSaveCopy: () => void;
  onExportPdf: () => void;
  onProperties: () => void;
  onClose: () => void;
  onError: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const request = useRef<ReturnType<typeof startBlankDocument> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; void request.current?.cancel(); };
  }, []);
  return <div className="adp-office-document-backstage">
    <button type="button" disabled={!canCreate || pending} onClick={() => {
      setPending(true);
      const job = startBlankDocument(async (draft) => { await onOpenDraft(draft); }, onError);
      request.current = job;
      void job.completion.finally(() => {
        if (request.current === job) { request.current = null; if (mounted.current) setPending(false); }
      });
    }}>{t("officeDoc.new")}</button>
    {pending ? <button type="button" onClick={() => { void request.current?.cancel(); }}>{t("office.cancel")}</button> : null}
    <button type="button" onClick={onOpen}>{t("officeDoc.open")}</button>
    <button type="button" onClick={onSaveCopy}>{t("officeDoc.saveCopy")}</button>
    <button type="button" onClick={onExportPdf}>{t("officeDoc.exportPdf")}</button>
    <button type="button" onClick={onProperties}>{t("officeDoc.properties")}</button>
    <button type="button" onClick={onClose}>{t("officeDoc.close")}</button>
  </div>;
}
