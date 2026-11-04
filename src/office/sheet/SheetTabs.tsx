import { useRef } from "react";
import { useTranslation } from "react-i18next";

export default function SheetTabs({ sheets, activeId, onActivate, onRename }: {
  sheets: readonly { id: string; name: string; hidden: boolean }[]; activeId: string | null;
  onActivate: (id: string) => void; onRename?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const visible = sheets.filter((sheet) => !sheet.hidden);
  return <div className="adp-sheet-tabs" role="tablist" aria-label={t("office.sheets")}>
    {visible.map((sheet, index) => <button type="button" key={sheet.id} ref={(element) => { if (element) buttons.current.set(sheet.id, element); else buttons.current.delete(sheet.id); }}
      role="tab" tabIndex={sheet.id === activeId ? 0 : -1} aria-selected={sheet.id === activeId}
      onClick={() => onActivate(sheet.id)} onDoubleClick={() => onRename?.(sheet.id)} onKeyDown={(event) => {
        let next = index;
        if (event.key === "ArrowRight") next = (index + 1) % visible.length;
        else if (event.key === "ArrowLeft") next = (index - 1 + visible.length) % visible.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = visible.length - 1;
        else return;
        event.preventDefault(); onActivate(visible[next].id); buttons.current.get(visible[next].id)?.focus();
      }}>{sheet.name}</button>)}
  </div>;
}
