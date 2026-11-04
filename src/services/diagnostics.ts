import { invoke } from "@tauri-apps/api/core";
import { runJob, type JobHandle } from "./jobs";
import { isTauriRuntime } from "./settings";

/**
 * Local diagnostic sessions (Step 09h, `diagnostics-1`). Nothing in this
 * module uploads anything: the issue page is one explicit native open call,
 * and it never carries diagnostic content.
 */

export type DiagnosticsFileKind = "text" | "dump";

export interface DiagnosticsFile {
  id: string;
  relative_name: string;
  kind: DiagnosticsFileKind;
  bytes: number;
  included: boolean;
  redacted: boolean;
  preview?: string | null;
}

export interface DiagnosticsSession {
  id: string;
  files: DiagnosticsFile[];
  expires_unix: number;
  include_paths: boolean;
  include_dumps: boolean;
}

export interface DiagnosticEdit {
  file_id: string;
  included: boolean;
  /** Never supplied for a dump. */
  text?: string;
}

export interface DiagnosticsSaveResult {
  path: string;
  bytes: number;
}

export interface DiagnosticsOptions {
  include_dumps: boolean;
  /** Additive to the guide table: the mask checkbox, off only explicitly. */
  include_paths?: boolean;
}

/** E4: gather app-owned reports as a reviewed session. */
export async function createDiagnostics(
  options: DiagnosticsOptions,
): Promise<JobHandle<DiagnosticsSession>> {
  if (!isTauriRuntime()) throw new Error("diagnostics.unsupported");
  return runJob<DiagnosticsSession>("diag", async (requestId) => {
    await invoke("diagnostics_create_start", {
      requestId,
      options: { include_dumps: options.include_dumps, include_paths: options.include_paths ?? false },
    });
  });
}

/** E4: edit or exclude files in an existing session. */
export async function editDiagnostics(
  sessionId: string,
  edits: readonly DiagnosticEdit[],
): Promise<DiagnosticsSession> {
  if (!isTauriRuntime()) throw new Error("diagnostics.unsupported");
  return (await invoke("diagnostics_edit", {
    sessionId,
    edits: edits.map((edit) => ({ ...edit })),
  })) as DiagnosticsSession;
}

/** E4: save the reviewed ZIP as a new file. */
export async function saveDiagnostics(
  sessionId: string,
  destPath: string,
): Promise<JobHandle<DiagnosticsSaveResult>> {
  if (!isTauriRuntime()) throw new Error("diagnostics.unsupported");
  return runJob<DiagnosticsSaveResult>("diagsave", async (requestId) => {
    await invoke("diagnostics_save_start", { requestId, sessionId, destPath });
  });
}

/** E4: forget a session without writing anything. */
export async function closeDiagnostics(sessionId: string): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("diagnostics_close", { sessionId });
}

/** E5: open the prefilled page. This is the only network action and it only
 * happens from the explicit button; no diagnostics content is included. */
export async function openProblemPage(
  title: string,
  issueCodes: readonly string[],
): Promise<void> {
  if (!isTauriRuntime()) throw new Error("diagnostics.unsupported");
  await invoke("diagnostics_open_issue", { title, issueCodes: [...issueCodes] });
}
