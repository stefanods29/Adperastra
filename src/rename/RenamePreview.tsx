import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, AlertTriangle, Minus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RenamePreviewRow } from "../services/bulkRename";
import { errorText } from "../services/errors";

export default function RenamePreview({ rows, excluded, disabled, stale, onExclude }: {
  rows: readonly RenamePreviewRow[]; excluded: readonly number[]; disabled: boolean; stale: boolean;
  onExclude: (index: number, exclude: boolean) => void;
}) {
  const { t } = useTranslation();
  const scroll = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const virtual = useVirtualizer({ count: rows.length, getScrollElement: () => scroll.current, estimateSize: () => 28, overscan: 8, getItemKey: index => rows[index].input_index });
  const visible = virtual.getVirtualItems();
  useEffect(() => {
    if (pendingFocus.current === null) return;
    const checkbox = scroll.current?.querySelector<HTMLInputElement>(`[data-rename-index="${pendingFocus.current}"]`);
    if (checkbox) { checkbox.focus(); pendingFocus.current = null; }
  }, [visible]);
  return <div className="adp-rename-preview" aria-busy={stale}>
    <div className="adp-rename-row"><span>{t("rename.old")}</span><span>{t("rename.new")}</span></div>
    <div className="adp-rename-scroll" ref={scroll} onKeyDown={event => {
      if (!(event.target instanceof HTMLInputElement) || disabled || rows.length === 0) return;
      const current = Number(event.target.dataset.renameIndex);
      if (!Number.isInteger(current)) return;
      const next = event.key === "ArrowDown" ? Math.min(rows.length - 1, current + 1) : event.key === "ArrowUp" ? Math.max(0, current - 1) : event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : null;
      if (next === null) return;
      event.preventDefault(); pendingFocus.current = next; virtual.scrollToIndex(next);
      const checkbox = scroll.current?.querySelector<HTMLInputElement>(`[data-rename-index="${next}"]`);
      if (checkbox) { checkbox.focus(); pendingFocus.current = null; }
    }}>
      <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
        {visible.map(item => {
          const row = rows[item.index];
          const checked = excluded.includes(row.input_index);
          const Icon = row.status === "invalid" || row.status === "conflict" ? AlertTriangle : row.status === "ready" ? Check : Minus;
          const status = row.reason ? errorText(t, row.reason, "rename") : t(`rename.${row.status}`);
          return <div key={row.input_index} className="adp-rename-row" style={{ position: "absolute", top: item.start, height: 28, width: "100%" }}>
            <label title={row.source_path}><input type="checkbox" data-rename-index={item.index} disabled={disabled} checked={checked} aria-label={t("rename.excludeNamed", { name: row.old_name })} onChange={e => onExclude(row.input_index, e.target.checked)} /><span>{row.old_name}</span></label>
            <span title={`${row.new_name} — ${status}`}><Icon size={16} aria-hidden="true" /><span>{row.new_name}</span><span className="adp-rename-status">{status}</span></span>
          </div>;
        })}
      </div>
    </div>
  </div>;
}
