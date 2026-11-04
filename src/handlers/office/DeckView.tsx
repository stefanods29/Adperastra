import OfficePreviewGate from "./OfficePreviewGate";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import type { VirtualViewProps } from "../../documents/types";
import { openDeckController } from "../../office/deck/deckController";
import { VirtualOfficeView } from "./OfficeView";

/** Formats the deck editor may open once an approved engine exists (Step
 * 22a D1); legacy `.ppt` stays with the Step 13 read-only presenter. */
const EDITABLE_EXTENSIONS = new Set(["pptx", "odp"]);

// The editor bundle only loads when an engine actually opens the deck.
const DeckEditorView = lazy(() =>
  import("../../office/deck/DeckEditor").then((module) => ({ default: module.VirtualDeckEditor })),
);

/** The office-slide presenter (Step 22a). The editor needs an approved engine:
 * a read-only/protected deck, a legacy or unsupported format, a missing engine
 * or a failed probe keeps the Step 13 read-only presenter instead of an empty
 * editor. The mounted editor owns every change; save-existing, AI and export
 * stay fail-closed in its command set until their capabilities exist. */
export default function VirtualDeckView(props: VirtualViewProps) {
  const { t } = useTranslation();
  const { document } = props;
  const readOnly =
    document.info.read_only ||
    props.previewOnly ||
    !EDITABLE_EXTENSIONS.has(document.info.ext.replace(/^\./, "").toLowerCase());
  return <OfficePreviewGate document={document} readOnly={Boolean(readOnly)} open={openDeckController}
    original={(visible) => <VirtualOfficeView {...props} active={props.active && visible} />}
    editor={(visible) => <Suspense fallback={<div className="adp-office-preview" role="status"><p>{t("preview.loading")}</p></div>}>
      <DeckEditorView {...props} active={props.active && visible} />
    </Suspense>} />;
}
