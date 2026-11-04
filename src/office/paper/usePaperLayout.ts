import { useEffect, useState } from "react";
import type { DocumentHandle } from "../../documents/types";
import { releaseExportSnapshot } from "../../services/exportSnapshots";
import { closeOfficeView, officeViewSections, officeViewText, openOfficeView } from "../../services/officeView";
import type { JobHandle } from "../../services/jobs";
import type { PaperTextPage } from "./paperTargets";

export interface PaperLayout {
  sessionId: string;
  sectionId: string;
  pages: number;
  revision: number;
  textPages: PaperTextPage[];
  textComplete: boolean;
}

export function usePaperLayout(document: DocumentHandle, revision: number, active: boolean) {
  const [layout, setLayout] = useState<PaperLayout | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let sessionId: string | undefined;
    let snapshotId: string | undefined;
    const jobs = new Set<JobHandle<unknown>>();
    // Keep the already leased page image visible while the new immutable
    // revision renders. The caller disables its old text targets immediately.
    setError(null);
    const wait = async <T,>(job: JobHandle<T>): Promise<T> => {
      jobs.add(job);
      try {
        if (disposed) void job.cancel();
        return await job.completion;
      } finally { jobs.delete(job); }
    };
    void (async () => {
      try {
        const snapshot = await document.captureSnapshot();
        snapshotId = snapshot.snapshot_id;
        if (disposed) return;
        if (snapshot.revision !== revision) throw new Error("office_edit.changed");
        const opened = await wait(await openOfficeView({
          kind: "snapshot", snapshot_id: snapshot.snapshot_id,
          document_id: snapshot.document_id, revision: snapshot.revision,
        }));
        sessionId = opened.session_id;
        if (disposed) return;
        if (opened.quality !== "accurate") throw new Error("office.pack_missing");
        const sections = await officeViewSections(sessionId);
        if (sections.items.length !== 1 || sections.items[0].kind !== "document") {
          throw new Error("office.changed");
        }
        const section = sections.items[0];
        const textPages: PaperTextPage[] = [];
        let textComplete = section.page_count <= 128;
        if (textComplete) {
          for (let page = 1; page <= section.page_count && !disposed; page++) {
            const text = await wait(await officeViewText(sessionId, section.id, page));
            if (!text.complete || textPages.reduce((n, p) => n + p.runs.length, 0) + text.runs.length > 16_000) {
              textComplete = false;
              break;
            }
            textPages.push({ page, runs: text.runs });
          }
        }
        if (!disposed) setLayout({
          sessionId, sectionId: section.id, pages: section.page_count, revision,
          textPages, textComplete,
        });
      } catch (caught) {
        if (!disposed) setError(caught);
      } finally {
        if (snapshotId) void releaseExportSnapshot(snapshotId).catch(() => undefined);
        if (disposed && sessionId) void closeOfficeView(sessionId).catch(() => undefined);
      }
    })();
    return () => {
      disposed = true;
      for (const job of jobs) void job.cancel().catch(() => undefined);
      if (sessionId) void closeOfficeView(sessionId).catch(() => undefined);
    };
  }, [document, revision, active]);
  return { layout, error };
}
