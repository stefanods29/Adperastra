import OfficePreviewGate from "./OfficePreviewGate";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import type { VirtualViewProps } from "../../documents/types";
import { openDocumentController } from "../../office/document/documentController";
import { VirtualOfficeView } from "./OfficeView";

/** Formats the document editor may open once an approved engine exists
 * (Step 20b D1); legacy `.doc` stays with the Step 13 read-only viewer. */
const EDITABLE_EXTENSIONS = new Set(["docx", "odt", "rtf"]);
// The editor bundle only loads when an engine actually opens the document.
const DocumentEditorView = lazy(() =>
  import("../../office/document/DocumentEditor").then((module) => ({ default: module.VirtualDocumentEditor })),
);

/** The office-word presenter (Step 20b). The editor needs an approved engine:
 * a read-only document, an unsupported format or a missing engine keeps the
 * Step 13 read-only viewer instead of an empty editor. */
export default function VirtualDocumentView(props: VirtualViewProps) {
  const { t } = useTranslation();
  const { document } = props;
  const readOnly = document.info.read_only || Boolean(props.previewOnly) ||
    !EDITABLE_EXTENSIONS.has(document.info.ext.replace(/^\./, "").toLowerCase());
  return <OfficePreviewGate document={document} readOnly={Boolean(readOnly)} open={openDocumentController}
    original={(visible) => <VirtualOfficeView {...props} active={props.active && visible} />}
    editor={(visible) => <Suspense fallback={<div className="adp-office-preview" role="status"><p>{t("officeEdit.loading")}</p></div>}>
      <DocumentEditorView {...props} active={props.active && visible} />
    </Suspense>} />;
}
