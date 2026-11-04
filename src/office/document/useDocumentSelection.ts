import { useCallback, useRef, useState } from "react";
import type { OfficeSelection } from "../types";

/** Keep logical engine positions while focus visits ribbon buttons and inputs. */
export function useDocumentSelection(initial: OfficeSelection | null) {
  const [selection, setSelection] = useState(initial);
  const current = useRef(selection);
  const update = useCallback((next: OfficeSelection | null) => {
    current.current = next;
    setSelection(next);
  }, []);
  return { selection, setSelection: update, captureSelection: () => current.current };
}

/** Local entry validation only; native engine validates the live block again. */
export function isDocumentTextBoundary(text: string, offset: number): boolean {
  if (!Number.isInteger(offset) || offset < 0 || offset > text.length) return false;
  if (offset === 0 || offset === text.length) return true;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return !(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff);
}
