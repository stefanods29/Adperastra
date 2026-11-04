import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { DocumentHandle } from "../../documents/types";
import "../../office/paper/officePaper.css";
import { useOfficeEditorMode, type OfficeEditorProbe } from "./useOfficeEditorMode";

interface Props {
  document: DocumentHandle;
  readOnly: boolean;
  open: OfficeEditorProbe;
  original: (visible: boolean) => ReactNode;
  editor: (visible: boolean) => ReactNode;
}

/** The file tab owns protected-view consent. This gate only opens an editor
 * after the user explicitly enables editing on an eligible file. */
export default function OfficePreviewGate(props: Props) {
  return <OfficePreviewGateSession key={props.document.id} {...props} />;
}

function OfficePreviewGateSession({ document, readOnly, open, original, editor }: Props) {
  const { t } = useTranslation();
  const [requested, setRequested] = useState(false);
  const protectedBefore = useRef(readOnly && document.info.from_internet);
  useEffect(() => {
    if (protectedBefore.current && !readOnly) setRequested(true);
    protectedBefore.current = readOnly && document.info.from_internet;
  }, [readOnly, document.info.from_internet]);
  const mode = useOfficeEditorMode(document, readOnly || !requested, open, true);
  if (!readOnly && mode === "editor") {
    return editor(true);
  }
  if (readOnly) return original(true);
  return <section className="adp-office-preview-gate">
    <div className="adp-office-basic-toolbar adp-office-preview-gate-toolbar">
      <button type="button" className="adp-btn" disabled={requested && mode === "probing"}
        onClick={() => setRequested(true)}>
        {t(requested && mode === "probing" ? "officeEdit.loading" : "office.enableEditing")}
      </button>
      {requested && mode === "viewer" ? <span role="status">{t("office.engineNeeded")}</span> : null}
    </div>
    {original(true)}
  </section>;
}
