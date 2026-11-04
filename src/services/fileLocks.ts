import { invoke } from "@tauri-apps/api/core";
import { isAbsolutePath } from "../documents/types";
import { runJob, type JobHandle } from "./jobs";

/** "What is using this?" (Step 09g, revision `file-locks-1`).
 * The native mirror is `src-tauri/src/file_lock_types.rs`. Inspection and
 * normal close run in the isolated `--file-locks-helper` process; the UI
 * validates the same bounds before asking Rust. */

export const MAX_LOCK_PATHS = 256;
export const MAX_LOCK_PROCESSES = 1024;
export const MAX_PROCESS_NAME = 256;
export const MAX_START_TICKS_DIGITS = 20;

/** Why a program cannot be asked to close from this app. */
export type LockReason = "system" | "critical" | "other_user" | "elevated" | "unknown" | "self";

export interface LockProcess {
  pid: number;
  /** Windows process creation time, decimal 100 ns ticks (never a Number). */
  start_ticks: string;
  name: string;
  application: string;
  can_close: boolean;
  reason?: LockReason;
  session_id: number;
}

export interface FileLockReport {
  paths: string[];
  processes: LockProcess[];
  complete: boolean;
  /** A folder was inspected as an item, not recursively. */
  folder_nonrecursive: boolean;
  error_code?: string;
}

export interface CloseLockProcessRequest {
  pid: number;
  start_ticks: string;
  /** Must be true: the UI showed the unsaved-work warning first. */
  confirmed: boolean;
}

export type CloseLockStatus = "requested" | "already_closed" | "refused";

export interface CloseLockProcessResult {
  status: CloseLockStatus;
  /** A stable `locks.*` code when refused. */
  reason?: string;
}

const START_TICKS_RE = /^[0-9]{1,20}$/;

function badRequest(): Error {
  return new Error("locks.failed");
}

/** Inspect up to 256 absolute paths. Folders are not expanded. */
export async function inspectFileLocks(paths: readonly string[]): Promise<JobHandle<FileLockReport>> {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > MAX_LOCK_PATHS) {
    throw badRequest();
  }
  for (const path of paths) {
    if (!isAbsolutePath(path)) throw badRequest();
  }
  return runJob<FileLockReport>("locks", (requestId) =>
    invoke("locks_inspect_start", { requestId, paths: [...paths] }),
  );
}

/** Ask one exact, freshly verified process to close normally. */
export async function requestProcessClose(
  request: CloseLockProcessRequest,
): Promise<JobHandle<CloseLockProcessResult>> {
  if (
    !Number.isInteger(request.pid) ||
    request.pid <= 4 ||
    request.pid > 0xffff_ffff ||
    typeof request.start_ticks !== "string" ||
    !START_TICKS_RE.test(request.start_ticks) ||
    request.start_ticks === "0"
  ) {
    throw badRequest();
  }
  if (request.confirmed !== true) throw new Error("locks.denied");
  return runJob<CloseLockProcessResult>("lockclose", (requestId) =>
    invoke("locks_close_start", {
      requestId,
      request: {
        pid: request.pid,
        start_ticks: request.start_ticks,
        confirmed: true,
      },
    }),
  );
}
