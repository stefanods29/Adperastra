import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CellAddress, CellRange } from "../types";
import { parseSheetAddress, sheetAddressName } from "./useSheetSelection";

interface NameBoxProps {
  address: CellAddress;
  rows: number;
  columns: number;
  disabled: boolean;
  onAddress: (address: CellAddress) => void;
  onNamedRange: (name: string) => Promise<CellRange | null>;
  onRange: (range: CellRange) => void;
  onError: (error: unknown) => void;
}

export default function NameBox(props: NameBoxProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState(sheetAddressName(props.address));
  const generation = useRef(0);
  useEffect(() => {
    generation.current += 1; setValue(sheetAddressName(props.address));
    return () => { generation.current += 1; };
  }, [props.address.sheet_id, props.address.row, props.address.column, props.disabled]);
  return <input className="adp-sheet-name" aria-label={t("officeSheet.cellAddress", { address: sheetAddressName(props.address) })}
    disabled={props.disabled} value={value} onChange={(event) => { generation.current += 1; setValue(event.target.value); }}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); generation.current += 1; setValue(sheetAddressName(props.address)); }
      if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
      event.preventDefault();
      const parsed = parseSheetAddress(value, props.address.sheet_id, props.rows, props.columns);
      if (!parsed) { props.onError(new Error("office_edit.invalid")); return; }
      if (parsed.kind === "address") { props.onAddress(parsed.address); return; }
      // Host must resolve against a public native name catalogue, never a path.
      const request = ++generation.current;
      void props.onNamedRange(parsed.name).then((range) => {
        if (request !== generation.current) return;
        if (!range || range.sheet_id !== props.address.sheet_id ||
          ![range.first_row, range.last_row, range.first_column, range.last_column].every(Number.isInteger) ||
          range.first_row < 0 || range.first_column < 0 || range.last_row < range.first_row || range.last_column < range.first_column ||
          range.last_row >= props.rows || range.last_column >= props.columns) throw new Error("office_edit.invalid");
        props.onRange(range);
      }).catch((error) => { if (request === generation.current) props.onError(error); });
    }} />;
}
