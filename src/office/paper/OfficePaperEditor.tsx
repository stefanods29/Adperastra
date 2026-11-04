import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DocumentHandle } from "../../documents/types";
import type { FileTabStatus } from "../../handlers/types";
import type { OfficeController } from "../OfficeController";
import type { OfficeOperation, OfficeSessionState } from "../types";
import { officeBasicPage, type BasicOfficeItem } from "../../services/officeBasic";
import { errorText } from "../../services/errors";
import { saveOfficeCopy } from "../saveOfficeCopy";
import { deckTextOperations } from "../deck/deckTextEdit";
import { paperTargets, type PaperTarget } from "./paperTargets";
import { usePaperLayout } from "./usePaperLayout";
import PaperCanvas from "./PaperCanvas";
import "./officePaper.css";

interface Props {
  document: DocumentHandle;
  controller: OfficeController;
  state: OfficeSessionState;
  active: boolean;
  previewOnly?: boolean;
  onStatus: (status: FileTabStatus) => void;
}

export default function OfficePaperEditor({ document, controller, state, active, onStatus, previewOnly = false }: Props) {
  const { t } = useTranslation();
  const { layout, error: renderError } = usePaperLayout(document, state.revision, active);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [items, setItems] = useState<{ revision: number; section: number; items: BasicOfficeItem[] } | null>(null);
  const [draft, setDraft] = useState<{ target: PaperTarget; text: string; revision: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const section = state.family === "deck" ? page - 1 : 0;
  const enabled = active && !previewOnly && !document.info.read_only && state.mode === "editing";
  const ready = !!layout && layout.revision === state.revision && layout.textComplete
    && items?.revision === state.revision && items.section === section;

  useEffect(() => {
    if (!active || !layout || layout.revision !== state.revision) return;
    let cancelled = false;
    setItems(null);
    void (async () => {
      try {
        const all: BasicOfficeItem[] = [];
        let start = 0;
        for (let batch = 0; batch < 32; batch++) {
          const result = await officeBasicPage(controller.session_id, state.revision, section, start);
          if (cancelled || result.revision !== controller.getState().revision) return;
          all.push(...result.items);
          if (result.next_start === null) break;
          start = result.next_start;
        }
        if (!cancelled) setItems({ revision: state.revision, section, items: all });
      } catch (caught) { if (!cancelled) setError(caught); }
    })();
    return () => { cancelled = true; };
  }, [active, controller, layout, state.revision, section]);

  useEffect(() => { setDraft(null); }, [state.revision]);
  useEffect(() => { if (layout) setPage(value => Math.min(value, layout.pages)); }, [layout]);
  useEffect(() => {
    if (!active) return;
    onStatus({
      items: [t(state.family === "deck" ? "officeDeck.slideStatus" : "officeDoc.pageStatus", {
        page, slide: page, total: layout?.pages ?? 1,
      }), t(`office.${state.mode}`), t(state.dirty ? "office.unsaved" : "office.saved")],
      zoom: { percent: zoom, min: 50, max: 200,
        set: value => setZoom(Math.max(50, Math.min(200, Math.round(value)))), fit: () => setZoom(100) },
    });
  }, [active, onStatus, page, layout?.pages, state.family, state.mode, state.dirty, zoom, t]);
  const targets = useMemo(() => ready && layout && items
    ? paperTargets(layout.textPages, items.items) : [], [ready, layout, items]);

  const apply = async () => {
    if (!draft || !enabled || !ready || draft.revision !== controller.getState().revision) {
      throw new Error("office_edit.changed");
    }
    const target = draft.target.item;
    if (draft.text !== target.text) {
      const anchor = { block_id: target.id, offset_utf16: 0 };
      const span = { anchor, focus: { ...anchor, offset_utf16: target.text.length }, revision: draft.revision };
      const operations: OfficeOperation[] = state.family === "deck"
        ? deckTextOperations(target.section_id, target.id, { span, text: target.text }, draft.text, draft.revision)
          .map(operation => ({ family: "deck", operation }))
        : [{ family: "document", operation: {
          kind: "replace_match", span, expected_text: target.text, replacement: draft.text,
        } }];
      if (operations.length) await controller.transact({
        transaction_id: crypto.randomUUID(), expected_revision: draft.revision,
        operations, selection_after: null, label_key: "office.transaction",
      });
    }
    setDraft(null);
  };
  const run = async (action: () => Promise<unknown>) => {
    if (busy || !active) return;
    setBusy(true); setError(null);
    try { await action(); } catch (caught) { setError(caught); } finally { setBusy(false); }
  };
  const save = () => run(async () => {
    if (previewOnly || document.info.read_only) return;
    if (draft) await apply();
    await saveOfficeCopy(document, t("office.saveCopy"), t("office.basicFile"));
  });
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault(); event.stopImmediatePropagation(); void save();
      } else if (!draft && enabled && ["z", "y"].includes(key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        const redo = key === "y" || event.shiftKey;
        if (redo ? state.can_redo : state.can_undo) void run(() => redo ? controller.redo() : controller.undo());
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, busy, draft, enabled, controller, state.can_redo, state.can_undo, ready]);

  const issue = error ?? renderError;
  return <section className={`adp-paper-editor ${state.family === "deck" ? "adp-paper-editor--slides" : ""}`}
    aria-label={t(state.family === "deck" ? "office.slide" : "office.word")}
    aria-busy={busy || (!renderError && (!layout || layout.revision !== state.revision))}>
    <header className="adp-paper-toolbar">
      <strong>{document.info.name}</strong>
      <button className="adp-btn" disabled={!enabled || busy || !!draft || !state.can_undo}
        onClick={() => void run(() => controller.undo())}>{t("common.undo")}</button>
      <button className="adp-btn" disabled={!enabled || busy || !!draft || !state.can_redo}
        onClick={() => void run(() => controller.redo())}>{t("common.redo")}</button>
      <button className="adp-btn" disabled={!active || previewOnly || busy || !state.capabilities.includes("save_copy")}
        onClick={() => void save()}>{t("office.saveCopy")}</button>
      <span className="adp-paper-spacer" />
      <button className="adp-btn" disabled={zoom <= 50} aria-label={t("office.basicZoomOut")}
        onClick={() => setZoom(n => Math.max(50, n - 25))}>−</button>
      <output aria-label={t("office.basicZoom")}>{zoom}%</output>
      <button className="adp-btn" disabled={zoom >= 200} aria-label={t("office.basicZoomIn")}
        onClick={() => setZoom(n => Math.min(200, n + 25))}>+</button>
    </header>
    {!renderError ? <p className="adp-paper-hint" role="status">
      {t(!layout ? "office.loading"
        : layout.revision !== state.revision ? "office.paperUpdating"
        : ready && targets.length ? "office.paperHint" : "office.paperNoTargets")}
    </p> : null}
    {issue ? <p role="alert">{errorText(t, issue, "office")}</p> : null}
    {layout ? <PaperCanvas layout={layout} slide={state.family === "deck"} page={page}
      onPage={value => { if (!draft && !busy) setPage(value); }} zoom={zoom}
      targets={targets} enabled={enabled && ready && !busy}
      onEdit={target => setDraft({ target, text: target.item.text, revision: state.revision })}
      draft={draft} onText={text => setDraft(previous => previous ? { ...previous, text } : null)}
      onApply={() => void run(apply)} onCancel={() => setDraft(null)} /> : null}
    <footer className="adp-paper-footer">
      <span>{t(state.dirty ? "office.unsaved" : "office.saved")}</span>
      <span>{t("office.pageOf", { page, count: layout?.pages ?? 1 })}</span>
    </footer>
  </section>;
}
