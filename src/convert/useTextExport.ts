import { useEffect, useRef, type RefObject } from "react";
import type { EditorView } from "@codemirror/view";
import type { ExportHandle } from "../handlers/types";
import { createFileExportCapture } from "./exportCapture";

/** Capture the current complete editor model without reading the saved file. */
export function useTextExport(url: string, view: RefObject<EditorView | null>, enabled: boolean,
  register?: (handle: ExportHandle | null) => void) {
  const registrar = useRef(register);
  registrar.current = register;
  useEffect(() => {
    if (!enabled || !registrar.current) return;
    const token = new URL(url).pathname.split("/")[1];
    let revision = 0;
    let previous: unknown;
    let contentId = "";
    const capture = createFileExportCapture(token, () => {
      const model = view.current?.state.doc;
      if (!model) throw new Error("snapshot.changed");
      if (model !== previous) {
        previous = model;
        revision++;
        contentId = crypto.randomUUID();
      }
      return { revision, contentId, mime: "text/plain", bytes: new TextEncoder().encode(model.toString()) };
    });
    registrar.current(capture);
    return () => {
      registrar.current?.(null);
      void capture.close();
    };
  }, [url, view, enabled]);
}
