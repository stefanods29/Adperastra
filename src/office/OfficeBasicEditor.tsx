import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DocumentHandle } from "../documents/types";
import { errorText } from "../services/errors";
import { officeBasicPage, type BasicOfficeItem, type BasicOfficePage } from "../services/officeBasic";
import type { OfficeController } from "./OfficeController";
import type { CellInput, OfficeOperation, OfficeSessionState } from "./types";
import { deckTextOperations } from "./deck/deckTextEdit";
import { saveOfficeCopy } from "./saveOfficeCopy";
import "./officeBasic.css";

type ValueKind = "text" | "number" | "boolean" | "blank";
interface Props { document: DocumentHandle; controller: OfficeController; state: OfficeSessionState; active: boolean; previewOnly?: boolean }

function operation(item: BasicOfficeItem, value: string, kind: ValueKind, state: OfficeSessionState): OfficeOperation[] {
  const anchor = { block_id: item.id, offset_utf16: 0 };
  const span = { anchor, focus: { ...anchor, offset_utf16: item.text.length }, revision: state.revision };
  if (state.family === "document") return [{ family: "document", operation: { kind: "replace_match", span, expected_text: item.text, replacement: value } }];
  if (state.family === "deck") return deckTextOperations(item.section_id, item.id, { span, text: item.text }, value, state.revision).map((op) => ({ family: "deck", operation: op }));
  const match = /^([A-Z]{1,3})([1-9]\d*)$/.exec(item.address ?? "");
  if (!match) throw new Error("office_edit.invalid");
  const row = Number(match[2]) - 1;
  const column = Array.from(match[1]).reduce((n, letter) => n * 26 + letter.charCodeAt(0) - 64, 0) - 1;
  let input: CellInput;
  if (kind === "number") {
    const number = Number(value);
    if (!value.trim() || !Number.isFinite(number)) throw new Error("office_edit.invalid");
    input = { kind: "number", value: number };
  } else if (kind === "boolean") {
    if (value !== "true" && value !== "false") throw new Error("office_edit.invalid");
    input = { kind: "boolean", value: value === "true" };
  } else input = kind === "blank" ? { kind: "blank" } : { kind: "text", text: value };
  return [{ family: "sheet", operation: { kind: "set_cells", range: { sheet_id: item.section_id, first_row: row, last_row: row, first_column: column, last_column: column }, values: [[input]], mode: "values" } }];
}

/** Limited UI over the same canonical controller and safe-copy publication. */
export default function OfficeBasicEditor({ document, controller, state, active, previewOnly = false }: Props) {
  const { t } = useTranslation();
  const [section, setSection] = useState(0);
  const [page, setPage] = useState<BasicOfficePage | null>(null);
  const [items, setItems] = useState<BasicOfficeItem[]>([]);
  const [draft, setDraft] = useState<{ item: BasicOfficeItem; value: string; kind: ValueKind; revision: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [font, setFont] = useState(16);
  const generation = useRef(0);
  const loading = useRef(false);
  const loadedKey = useRef("");
  const editable = active && !previewOnly && !document.info.read_only && state.mode === "editing";

  useEffect(() => {
    const current = ++generation.current;
    if (!active) return () => { generation.current++; loading.current = false; };
    const key = `${controller.session_id}:${state.revision}:${section}`;
    if (loadedKey.current === key) return () => { generation.current++; loading.current = false; };
    setItems([]); setPage(null); setDraft(null); setError(null);
    loading.current = true;
    void officeBasicPage(controller.session_id, state.revision, section, 0).then((next) => {
      if (generation.current !== current || next.revision !== controller.getState().revision) return;
      loadedKey.current = key;
      setPage(next); setItems(next.items);
    }).catch((caught) => { if (generation.current === current) setError(caught); })
      .finally(() => { if (generation.current === current) loading.current = false; });
    return () => { generation.current++; loading.current = false; };
  }, [active, controller, state.revision, section]);

  const run = async (action: () => Promise<unknown>) => {
    if (busy || !active) return;
    setBusy(true); setError(null);
    try { await action(); } catch (caught) { setError(caught); } finally { setBusy(false); }
  };
  const apply = async () => {
    if (!draft || !editable || draft.revision !== controller.getState().revision) throw new Error("office_edit.changed");
    const operations = operation(draft.item, draft.value, draft.kind, controller.getState());
    if (operations.length) await controller.transact({ transaction_id: crypto.randomUUID(), expected_revision: draft.revision, operations, selection_after: null, label_key: "office.transaction" });
    setDraft(null);
  };
  const save = () => {
    if (previewOnly || document.info.read_only) return Promise.resolve();
    return run(async () => {
    if (draft) await apply();
    await saveOfficeCopy(document, t("office.saveCopy"), t("office.basicFile"));
    });
  };
  const more = async () => {
    if (!page || page.next_start === null || loading.current || items.length >= 256) return;
    const current = generation.current;
    loading.current = true;
    try {
      const next = await officeBasicPage(controller.session_id, state.revision, section, page.next_start);
      if (generation.current !== current || next.revision !== controller.getState().revision) return;
      setItems((existing) => [...existing, ...next.items]); setPage(next);
    } catch (caught) { if (generation.current === current) setError(caught); }
    finally { if (generation.current === current) loading.current = false; }
  };

  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault(); event.stopImmediatePropagation(); void save();
      } else if (["z", "y"].includes(key)) {
        if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
        event.preventDefault(); event.stopImmediatePropagation();
        if (!editable || draft) return;
        const redo = key === "y" || event.shiftKey;
        if (redo ? state.can_redo : state.can_undo) void run(() => redo ? controller.redo() : controller.undo());
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [active, busy, controller, document, draft, editable, previewOnly, state.can_redo, state.can_undo, t]);

  return <section className="adp-office-basic" tabIndex={0} onKeyDown={(event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); event.stopPropagation(); void save(); }
    else if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) {
      event.stopPropagation();
      if (draft) return;
      event.preventDefault();
      if (!editable) return;
      const redo = event.key.toLowerCase() === "y" || event.shiftKey;
      if (redo ? state.can_redo : state.can_undo) void run(() => redo ? controller.redo() : controller.undo());
    } else if (!draft && !event.ctrlKey && !event.metaKey && state.family !== "document") {
      if (event.key === "ArrowRight" && page?.has_next_section) { event.preventDefault(); event.stopPropagation(); setSection((n) => n + 1); }
      if (event.key === "ArrowLeft" && section > 0) { event.preventDefault(); event.stopPropagation(); setSection((n) => n - 1); }
    }
  }}>
    <header className="adp-office-basic-header">
      <p>{t("office.basicEditing")}</p>
      <div className="adp-office-basic-toolbar" role="toolbar" aria-label={t("office.basicToolbar")}>
        <button className="adp-btn" disabled={!active || previewOnly || document.info.read_only || busy} onClick={() => void run(() => controller.setEditingEnabled(state.mode !== "editing"))}>{t(state.mode === "editing" ? "office.basicView" : "office.enableEditing")}</button>
        <button className="adp-btn" disabled={!editable || busy || !state.can_undo || !!draft} onClick={() => void run(() => controller.undo())}>{t("common.undo")}</button>
        <button className="adp-btn" disabled={!editable || busy || !state.can_redo || !!draft} onClick={() => void run(() => controller.redo())}>{t("common.redo")}</button>
        <button className="adp-btn" disabled={!active || previewOnly || busy || !state.capabilities.includes("save_copy")} onClick={() => void save()}>{t("office.saveCopy")}</button>
        <button className="adp-btn" disabled={font <= 12} aria-label={t("office.basicZoomOut")} onClick={() => setFont((n) => Math.max(12, n - 2))}>−</button>
        <output aria-label={t("office.basicZoom")}>{Math.round(font / 16 * 100)}%</output>
        <button className="adp-btn" disabled={font >= 32} aria-label={t("office.basicZoomIn")} onClick={() => setFont((n) => Math.min(32, n + 2))}>+</button>
        {state.family !== "document" && <>
          <button className="adp-btn" disabled={section === 0 || busy || !!draft} onClick={() => setSection((n) => n - 1)}>{t("office.basicPrevious")}</button>
          <span>{t("office.basicSection", { index: section + 1 })}</span>
          <button className="adp-btn" disabled={!page?.has_next_section || busy || !!draft} onClick={() => setSection((n) => n + 1)}>{t("office.basicNext")}</button>
        </>}
      </div>
    </header>
    {error ? <p role="alert">{errorText(t, error, "office_edit")}</p> : null}
    <div className="adp-office-basic-content" style={{ fontSize: font }} onScroll={(event) => {
      const el = event.currentTarget;
      if (el.scrollTop + el.clientHeight > el.scrollHeight - 180) void more();
    }}>
      {!page && !error ? <p role="status">{t("office.basicLoading")}</p> : null}
      {page && items.length === 0 ? <p>{t("office.basicNoTargets")}</p> : null}
      {items.map((item) => <article className="adp-office-basic-item" key={item.id}>
        {item.address ? <strong>{item.address}</strong> : null}
        <p>{item.text || t("office.basicEmpty")}</p>
        <button className="adp-btn" disabled={!editable || busy || !!draft} onClick={() => setDraft({ item, value: item.text, kind: "text", revision: state.revision })}>{t("office.basicEdit")}</button>
        {draft?.item.id === item.id ? <form onSubmit={(event) => { event.preventDefault(); void run(apply); }}>
          {state.family === "sheet" ? <select aria-label={t("office.basicValueType")} value={draft.kind} disabled={busy} onChange={(event) => setDraft({ ...draft, kind: event.target.value as ValueKind })}>
            {(["text", "number", "boolean", "blank"] as const).map((kind) => <option key={kind} value={kind}>{t(`office.basicType_${kind}`)}</option>)}
          </select> : null}
          <textarea autoFocus aria-label={t("office.basicText")} maxLength={4096} value={draft.value} disabled={busy || !editable || draft.kind === "blank"} onChange={(event) => setDraft({ ...draft, value: event.target.value })} />
          <div className="adp-office-basic-toolbar">
            <button type="submit" className="adp-btn" disabled={busy || !editable}>{t("common.apply")}</button>
            <button type="button" className="adp-btn" disabled={busy} onClick={() => setDraft(null)}>{t("common.cancel")}</button>
          </div>
        </form> : null}
      </article>)}
      {page?.next_start !== null && page ? <button className="adp-btn" onClick={() => void more()} disabled={busy}>{t("office.basicMore")}</button> : null}
    </div>
  </section>;
}
