import { Check, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OfficeController } from "../OfficeController";
import type { CellRange } from "../types";
import { createFormulaEditing } from "./formulaEditing";

interface FormulaBarProps {
  controller: OfficeController;
  range: CellRange;
  fillRange?: CellRange;
  /** Already localized by displayFormula, or original typed scalar text. */
  value: string;
  locale: "en-US" | "es-419";
  disabled: boolean;
  /** F2 or a double-click raises this value; the host owns the trigger. */
  editRequest?: { initialText?: string };
  onCommitted: (direction: "down" | "right" | null) => void;
  onEditing: (editing: boolean) => void;
  onError: (error: unknown) => void;
}

export default function FormulaBar(props: FormulaBarProps) {
  const { t } = useTranslation();
  const [buffer, setBuffer] = useState(props.value);
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState<number | null>(null);
  const edit = useRef<ReturnType<typeof createFormulaEditing> | null>(null);
  const mounted = useRef(true);
  const input = useRef<HTMLInputElement>(null);
  const lastFocus = useRef<FormulaBarProps["editRequest"]>(undefined);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // Focusing the input starts the local edit buffer; a host F2 only asks for
  // one new focus, so a later enabled change never starts an edit by itself.
  useEffect(() => {
    const request = props.editRequest;
    if (!request || request === lastFocus.current) return;
    lastFocus.current = request;
    if (props.disabled) return;
    input.current?.focus();
    if (request.initialText !== undefined && edit.current) {
      edit.current.setBuffer(request.initialText);
      setBuffer(request.initialText);
      setOffset(null);
    }
  }, [props.editRequest, props.disabled]);
  useEffect(() => {
    // A controller update must not silently discard a user's unconfirmed text.
    // Host blocks navigation while onEditing(true), and remounts after Cancel.
    if (edit.current?.getState().editing) return;
    edit.current = null; setBuffer(props.value); setOffset(null); props.onEditing(false);
  }, [props.controller, props.range.sheet_id, props.range.first_row, props.range.last_row, props.range.first_column, props.range.last_column, props.value, props.locale]);
  const begin = () => {
    if (props.disabled || edit.current) return;
    edit.current = createFormulaEditing(props.controller, props.range, props.value, props.locale);
    props.onEditing(true);
  };
  const cancel = () => {
    if (edit.current && !edit.current.cancel()) return;
    edit.current = null;
    setBuffer(props.value); setOffset(null); setBusy(false); props.onEditing(false); input.current?.focus();
  };
  const confirm = async (direction: "down" | "right" | null, fill = false) => {
    if (!edit.current || busy || props.disabled) return;
    const session = edit.current; setBusy(true);
    try {
      const success = await session.confirm(fill ? props.fillRange : undefined);
      if (!mounted.current || edit.current !== session) return;
      if (success) { edit.current = null; props.onEditing(false); props.onCommitted(direction); }
      else { setOffset(session.getState().error_offset_utf16); input.current?.focus(); }
    } catch (error) { if (mounted.current && edit.current === session) props.onError(error); }
    finally { if (mounted.current && (edit.current === session || edit.current === null)) setBusy(false); }
  };
  return <div className="adp-sheet-formula" aria-busy={busy}>
    <button type="button" disabled={props.disabled || edit.current?.getState().committing || !edit.current} aria-label={t("officeSheet.formulaCancel")} onClick={cancel}><X size={14} aria-hidden="true" /></button>
    <button type="button" disabled={props.disabled || busy || !edit.current} aria-label={t("officeSheet.formulaConfirm")} onClick={() => void confirm(null)}><Check size={16} aria-hidden="true" /></button>
    <input ref={input} aria-label={t("officeSheet.formulaBar")} aria-invalid={offset !== null} disabled={props.disabled} readOnly={busy}
      value={buffer} onFocus={begin} onChange={(event) => { begin(); edit.current?.setBuffer(event.target.value); setBuffer(event.target.value); setOffset(null); }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") { event.preventDefault(); cancel(); }
        if (event.key === "Enter" || event.key === "Tab") {
          event.preventDefault(); void confirm(event.ctrlKey ? null : event.key === "Tab" ? "right" : "down", event.ctrlKey && event.key === "Enter");
        }
      }} />
    {offset !== null && <span role="alert">{t("officeSheet.formulaInvalid", { position: offset })}</span>}
  </div>;
}
