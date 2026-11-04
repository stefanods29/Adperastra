import OfficePreviewGate from "./OfficePreviewGate";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import type { VirtualViewProps } from "../../documents/types";
import { acquireSheetController } from "../../office/sheet/sheetController";
import { VirtualOfficeView } from "./OfficeView";

// The editor bundle only loads when an approved engine opens the workbook.
const SheetEditorView = lazy(() =>
  import("../../office/sheet/SheetEditor").then((module) => ({ default: module.VirtualSheetEditor })),
);

// Formats the sheet editor may open once an approved engine exists
// (Step 21a D1); legacy `.xls` stays with the Step 13 read-only viewer.
const EDITABLE_EXTENSIONS = new Set(["xlsx", "ods"]);

/** The office-sheet presenter (Step 21a). The editor needs an approved engine:
 * a protected/read-only workbook, an unsupported format, a missing engine or a
 * failed probe keeps the Step 13 read-only presenter instead of an empty
 * editor. The mounted editor owns every document change (typed sheet
 * operations); save, export and AI stay fail-closed in its command set. */
export default function VirtualSheetView(props: VirtualViewProps) {
  const { t } = useTranslation();
  const { document } = props;
  const extension = document.info.ext.replace(/^\./, "").toLowerCase();
  const readOnly = document.info.read_only || props.previewOnly || !EDITABLE_EXTENSIONS.has(extension);
  return <OfficePreviewGate document={document} readOnly={Boolean(readOnly)} open={acquireSheetController}
    original={(visible) => <VirtualOfficeView {...props} active={props.active && visible} />}
    editor={(visible) => <Suspense fallback={<div className="adp-office-preview" role="status"><p>{t("preview.loading")}</p></div>}>
      <SheetEditorView {...props} active={props.active && visible} />
    </Suspense>} />;
}
