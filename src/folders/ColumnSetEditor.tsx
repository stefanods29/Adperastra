import { useId } from "react";
import { useTranslation } from "react-i18next";
import { COLUMN_IDS, COLUMN_LABEL_KEYS, defaultColumnWidth, columnBounds, validColumns } from "../services/folderPresentation";
import type { ColumnSet } from "../services/folderCustomization";

export interface ColumnSetEditorProps {
  value: ColumnSet;
  onChange: (value: ColumnSet) => void;
}

/** Edits a draft only. Saving/assignment and Suggest preview belong to the host. */
export function ColumnSetEditor({ value, onChange }: ColumnSetEditorProps) {
  const { t } = useTranslation();
  const prefix = useId();
  const updateColumns = (columns: ColumnSet["columns"]) => {
    if (validColumns(columns)) onChange({ ...value, columns });
  };
  const move = (index: number, delta: number) => {
    const next = [...value.columns];
    const destination = index + delta;
    if (index < 1 || destination < 1 || destination >= next.length) return;
    [next[index], next[destination]] = [next[destination], next[index]];
    updateColumns(next);
  };
  const order = [...value.columns.map((column) => column.id), ...COLUMN_IDS.filter((id) => !value.columns.some((column) => column.id === id))];
  return <fieldset className="adp-folder-column-sets">
    <legend>{t("folderCustom.columns")}</legend>
    <label htmlFor={`${prefix}-name`}>{t("explorer.columnName")}</label>
    <input id={`${prefix}-name`} value={value.name} onChange={(event) => {
      if ([...event.target.value].length <= 60) onChange({ ...value, name: event.target.value });
    }} />
    {order.map((id) => {
      const index = value.columns.findIndex((column) => column.id === id);
      const column = value.columns[index];
      const [min, max] = columnBounds(id);
      return <div className="adp-folder-column-sets-row" key={id}>
        <label><input type="checkbox" disabled={id === "name"} checked={index >= 0} onChange={(event) => {
          if (id === "name") return;
          updateColumns(event.target.checked
            ? [...value.columns, { id, width: defaultColumnWidth(id) }]
            : value.columns.filter((entry) => entry.id !== id));
        }} />{t(COLUMN_LABEL_KEYS[id])}</label>
        {column && <input type="number" min={min} max={max} step={1} value={column.width}
          aria-label={t("columns.width", { name: t(COLUMN_LABEL_KEYS[id]) })}
          onChange={(event) => {
            const width = event.target.valueAsNumber;
            if (Number.isInteger(width) && width >= min && width <= max) {
              updateColumns(value.columns.map((entry) => entry.id === id ? { ...entry, width } : entry));
            }
          }} />}
        <button type="button" disabled={index <= 1} onClick={() => move(index, -1)}>{t("columns.moveUp")}</button>
        <button type="button" disabled={index < 1 || index === value.columns.length - 1} onClick={() => move(index, 1)}>{t("columns.moveDown")}</button>
      </div>;
    })}
  </fieldset>;
}
