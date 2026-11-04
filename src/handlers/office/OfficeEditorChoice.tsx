import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** Keep the source preview available alongside limited text/cell editing. */
export default function OfficeEditorChoice({ editor, original, initialEditor = false }: { editor: (visible: boolean) => ReactNode; original: (visible: boolean) => ReactNode; initialEditor?: boolean }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(initialEditor);
  return <section style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0, width: "100%" }}>
    <div className="adp-office-basic-toolbar" role="toolbar" aria-label={t("office.basicDisplay")} style={{ padding: 8 }}>
      <button type="button" className="adp-btn" aria-pressed={!editing} onClick={() => setEditing(false)}>{t("office.basicOriginal")}</button>
      <button type="button" className="adp-btn" aria-pressed={editing} onClick={() => setEditing(true)}>{t("office.basicOpenEditor")}</button>
      {!editing ? <span>{t("office.basicOriginalHint")}</span> : null}
    </div>
    <div style={{ display: editing ? "none" : "flex", flex: 1, minHeight: 0, minWidth: 0 }}>{original(!editing)}</div>
    <div style={{ display: editing ? "flex" : "none", flex: 1, minHeight: 0, minWidth: 0 }}>{editor(editing)}</div>
  </section>;
}
