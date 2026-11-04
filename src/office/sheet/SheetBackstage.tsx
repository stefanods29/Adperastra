import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createOfficeBlankDraft } from "../../services/officeDrafts";
import type { JobHandle } from "../../services/jobs";

type BlankDraft = Awaited<Awaited<ReturnType<typeof createOfficeBlankDraft>>["completion"]>;

/** Host adopts exactly these shared references on successful open. */
export function startSheetWorkbook(onOpenDraft: (draft: BlankDraft) => Promise<void>, onError: (error: unknown) => void) {
  let cancelled = false;
  let handle: JobHandle<BlankDraft> | null = null;
  const completion = (async () => {
    try {
      handle = await createOfficeBlankDraft("sheet");
      if (cancelled) {
        // Still await completion if the cancel request itself fails: the job
        // may have committed a blank draft whose caller references need release.
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
  return { completion, cancel: async () => {
    cancelled = true;
    try { await handle?.cancel(); } catch (error) { onError(error); }
  } };
}

export default function SheetBackstage({ canCreate, onOpenDraft, onClose, onError }: {
  canCreate: boolean; onOpenDraft: (draft: BlankDraft) => Promise<void>; onClose: () => void; onError: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const request = useRef<ReturnType<typeof startSheetWorkbook> | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; void request.current?.cancel(); }; }, []);
  return <div className="adp-sheet-backstage">
    <button type="button" disabled={!canCreate || pending} onClick={() => {
      setPending(true);
      const job = startSheetWorkbook(async (draft) => { await onOpenDraft(draft); onClose(); }, onError);
      request.current = job;
      void job.completion.finally(() => { if (request.current === job) { request.current = null; if (mounted.current) setPending(false); } });
    }}>{t("officeSheet.new")}</button>
    {pending && <button type="button" onClick={() => { void request.current?.cancel(); }}>{t("office.cancel")}</button>}
  </div>;
}
