import { LockKeyhole } from "lucide-react";
import { lazy } from "react";
import type { VirtualViewProps } from "../documents/types";
import { LOCKED_TEXT_HANDLER_ID } from "../documents/LockedDocumentProvider";
import {
  VirtualHexView,
  VirtualImageView,
  VirtualTextView,
  virtualPresenterFor,
} from "../locked/VirtualTextView";
import type { Handler } from "./types";

/** The source-aware presenter for a virtual locked entry. It picks only the
 * bounded memory presenters; a type without one is refused before a tab is
 * opened instead of being sent to a path-based viewer. */
function LockedVirtualPresenter(props: VirtualViewProps) {
  const presenter = virtualPresenterFor({
    mime: props.document.info.mime,
    ext: props.document.info.ext,
  });
  if (presenter === "image") return <VirtualImageView {...props} />;
  if (presenter === "hex") return <VirtualHexView {...props} />;
  return <VirtualTextView {...props} />;
}

/** Never chosen by `pick()`: no extension or content type lists it. The
 * locked tab host selects it for a virtual source after the entry's real
 * metadata is known. */
const LockedPlaceholder = () => null;
const lazyPlaceholder = lazy(async () => ({ default: LockedPlaceholder }));

export const lockedTextHandler: Handler = {
  id: LOCKED_TEXT_HANDLER_ID,
  version: 1,
  labelKey: "locked.title",
  icon: LockKeyhole,
  accent: "explorer",
  extensions: [],
  mimeTypes: [],
  maxBytes: 0,
  helpSlug: "locked-folders",
  speedTier: "fast",
  supportsFind: true,
  editable: true,
  view: lazyPlaceholder as unknown as Handler["view"],
  virtualView: LockedVirtualPresenter,
};
