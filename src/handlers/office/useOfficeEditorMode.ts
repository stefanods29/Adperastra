import { useEffect, useState } from "react";
import type { DocumentHandle } from "../../documents/types";
import type { OfficeController } from "../../office/OfficeController";

type ProbeResult = { kind: "editing"; controller: OfficeController } | { kind: "viewing" };
export type OfficeEditorProbe = (document: DocumentHandle) => Promise<ProbeResult>;
type Mode = "probing" | "editor" | "viewer";

export function useOfficeEditorMode(document: DocumentHandle, readOnly: boolean, open: OfficeEditorProbe, enableOnOpen = false): Mode {
  const [result, setResult] = useState<{ document: DocumentHandle; mode: Mode } | null>(null);

  useEffect(() => {
    setResult(null);
    if (readOnly) return;
    let disposed = false;
    let lease: OfficeController | undefined;
    const release = (controller: OfficeController) => {
      void controller.close().catch(() => undefined);
    };
    void open(document).then(async (outcome) => {
      if (outcome.kind === "editing") {
        if (disposed) {
          release(outcome.controller);
          return;
        }
        // Keep the shared session alive while the lazy editor mounts and
        // acquires its own reference to that same session.
        lease = outcome.controller;
        if (enableOnOpen && lease.getState().mode !== "editing") {
          await lease.setEditingEnabled(true);
        }
      }
      if (!disposed) setResult({ document, mode: outcome.kind === "editing" ? "editor" : "viewer" });
    }).catch(() => {
      if (!disposed) setResult({ document, mode: "viewer" });
    });
    return () => {
      disposed = true;
      if (lease) release(lease);
    };
  }, [document, open, readOnly, enableOnOpen]);

  if (readOnly) return "viewer";
  return result?.document === document ? result.mode : "probing";
}
