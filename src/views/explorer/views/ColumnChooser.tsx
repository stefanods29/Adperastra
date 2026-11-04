import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "../../../components/Dialog";
import { COLUMN_IDS, COLUMN_LABEL_KEYS, defaultColumns, defaultColumnWidth, type ColumnSpec } from "../../../services/folderPresentation";

export interface ColumnChooserProps {
  value: readonly ColumnSpec[];
  onChange: (columns: ColumnSpec[]) => void;
  onClose: () => void;
}
export function ColumnChooser({ value, onChange, onClose }: ColumnChooserProps) {
  const { t } = useTranslation();
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const dialog = body.current?.closest('[role="dialog"]');
    const focusInput = () => body.current?.querySelector<HTMLElement>("input:not(:disabled)")?.focus();
    const onFocus = (event: FocusEvent) => { if (event.target instanceof Node && !dialog?.contains(event.target)) focusInput(); };
    focusInput(); document.addEventListener("focusin", onFocus);
    return () => { document.removeEventListener("focusin", onFocus); if (opener?.isConnected) opener.focus(); };
  }, []);
  const order = [...value.map((column) => column.id), ...COLUMN_IDS.filter((id) => !value.some((column) => column.id === id))];
  const move = (index: number, delta: number) => {
    const next = [...value];
    const target = index + delta;
    if (index < 1 || target < 1 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  return <Dialog title={t("columns.choose")} onClose={onClose} className="adp-column-chooser">
    <div ref={body} onKeyDown={(event) => {
      if (event.key !== "Tab") return;
      const dialog = body.current?.closest('[role="dialog"]');
      const nodes = Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? []);
      const index = nodes.indexOf(document.activeElement as HTMLElement);
      if (nodes.length && ((event.shiftKey && index <= 0) || (!event.shiftKey && index === nodes.length - 1))) {
        event.preventDefault(); nodes[event.shiftKey ? nodes.length - 1 : 0].focus();
      }
    }}>
      {order.map((id) => {
        const index = value.findIndex((column) => column.id === id);
        return <div className="adp-column-chooser-row" key={id}>
          <label><input type="checkbox" disabled={id === "name"} checked={index >= 0} onChange={(event) => {
            onChange(event.target.checked ? [...value, { id, width: defaultColumnWidth(id) }] : value.filter((column) => column.id !== id));
          }} />{t(COLUMN_LABEL_KEYS[id])}</label>
          <button type="button" aria-label={t("columns.moveUp")} disabled={index <= 1} onClick={() => move(index, -1)}>{t("columns.moveUp")}</button>
          <button type="button" aria-label={t("columns.moveDown")} disabled={index < 1 || index === value.length - 1} onClick={() => move(index, 1)}>{t("columns.moveDown")}</button>
        </div>;
      })}
      <button type="button" onClick={() => onChange(defaultColumns())}>{t("columns.reset")}</button>
    </div>
  </Dialog>;
}
export default ColumnChooser;
