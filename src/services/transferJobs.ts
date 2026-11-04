import { invoke } from "@tauri-apps/api/core";
import type { SourceStamp } from "./cache";
import type { OpProgress, OpReport } from "./fileops";
import { runJob, type JobHandle } from "./jobs";

/** Mirrors Rust `transfer_job_types.rs` (snake_case fields, same names).
 *
 * One queue for every copy and move: start a transfer, watch its state,
 * pause/resume/skip/cancel it, answer its conflicts and page its report.
 *
 * Replace is not part of this interface (`replace-capability-0`). The union
 * below deliberately has no `replace` member, and a request that names one is
 * refused with `ops.replace_unavailable` before Rust is called.
 */

export type TransferKind = "copy" | "move";
export type TransferPhase =
  | "queued"
  | "running"
  | "paused"
  | "awaiting_conflict"
  | "awaiting_error"
  | "cancelling"
  | "done";
export type TransferConflictChoice = "skip" | "keepBoth" | "merge";
export type TransferPriority = "normal" | "foreground";
export type TransferItemStatus = "done" | "skipped" | "failed" | "cancelled";
export type TransferItemKind = "file" | "folder";
export type TransferDecisionKind = "conflict" | "error";
export type TransferAction = "skip" | "keepBoth" | "merge" | "retry" | "cancel";

/** Replace is unavailable in this build, in every place that asks. */
export const REPLACE_AVAILABLE = false;
/** The only conflict choices the window may offer. */
export const CONFLICT_CHOICES: readonly TransferConflictChoice[] = ["skip", "keepBoth", "merge"];
/** Top-level items one transfer may name (mirrors the native limit). */
export const MAX_TRANSFER_SOURCES = 10_000;

export interface TransferRequest {
  kind: TransferKind;
  sources: string[];
  /** Reviewed source identities, one per entry of `sources`, same order. */
  expected_sources?: SourceStamp[] | null;
  dest_dir: string;
  conflict?: TransferConflictChoice;
  /** `null`/omitted means "use the Verify copied files setting". */
  verify?: boolean | null;
  allow_system?: boolean;
  priority?: TransferPriority;
}

export interface TransferControl {
  action: "pause" | "resume" | "skip_current" | "cancel";
  expected_generation: number;
}

export interface TransferDecisionRequest {
  decision_id: string;
  item_id: string;
  kind: TransferDecisionKind;
  source_path: string;
  target_path?: string | null;
  source?: SourceStamp | null;
  target?: SourceStamp | null;
  source_kind?: TransferItemKind | null;
  target_kind?: TransferItemKind | null;
  error_code?: string | null;
  attempt: number;
  allowed: TransferAction[];
  /** Always false: the window shows a disabled Replace with this reason. */
  replace_available: boolean;
}

export interface TransferDecision {
  decision_id: string;
  generation: number;
  action: TransferAction;
  apply_to_all?: boolean;
}

export interface TransferItemResult {
  item_id: string;
  from: string;
  to?: string | null;
  status: TransferItemStatus;
  reason?: string | null;
  bytes_written: number;
  verified: boolean;
  source_removed: boolean;
  destination_created: boolean;
}

export interface TransferReport {
  report_id: string;
  transfer_id?: string | null;
  items: TransferItemResult[];
  next_cursor?: string | null;
  done: number;
  skipped: number;
  failed: number;
  cancelled: boolean;
  job_finished: boolean;
  complete: boolean;
  replace_available: boolean;
}

export interface TransferState {
  job_id: string;
  state: TransferPhase;
  progress: OpProgress;
  bytes_per_second?: number | null;
  eta_seconds?: number | null;
  current_item_id?: string | null;
  decision?: TransferDecisionRequest | null;
  generation: number;
}

/** A request that cannot be sent: the same codes Rust would return. */
export class TransferRequestError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "TransferRequestError";
  }
}

/**
 * Validate what the window built before it reaches Rust. This is convenience,
 * not authority: Rust validates everything again.
 */
export function normalizeRequest(request: TransferRequest): TransferRequest {
  const conflict = request.conflict ?? "skip";
  if (conflict === ("replace" as string) || conflict === ("replaceIfNewer" as string)) {
    throw new TransferRequestError("ops.replace_unavailable");
  }
  if (!CONFLICT_CHOICES.includes(conflict)) {
    throw new TransferRequestError("ops.invalid_request");
  }
  if (request.sources.length === 0 || request.sources.length > MAX_TRANSFER_SOURCES) {
    throw new TransferRequestError("ops.invalid_request");
  }
  const expected = request.expected_sources ?? null;
  if (expected && expected.length !== request.sources.length) {
    throw new TransferRequestError("ops.invalid_request");
  }
  return {
    kind: request.kind,
    sources: [...request.sources],
    expected_sources: expected,
    dest_dir: request.dest_dir,
    conflict,
    verify: request.verify ?? null,
    allow_system: request.allow_system ?? false,
    priority: request.priority ?? "normal",
  };
}

/**
 * Start a copy or move. The returned handle's `completion` resolves with the
 * first page of the report; later pages come from `transferReportPage` with
 * the cursor that page returned.
 */
export async function startTransfer(
  request: TransferRequest,
  onProgress?: (progress: OpProgress) => void,
): Promise<JobHandle<TransferReport>> {
  const normalized = normalizeRequest(request);
  return runJob<TransferReport>(
    "transfer",
    async (requestId) => {
      await invoke("transfer_start", { requestId, request: normalized });
    },
    onProgress,
  );
}

/** The current state of one job. */
export async function getTransferState(jobId: string): Promise<TransferState> {
  return (await invoke("transfer_state", { jobId })) as TransferState;
}

/** Pause, resume, skip the current item, or cancel. */
export async function controlTransfer(
  jobId: string,
  control: TransferControl,
): Promise<TransferState> {
  return (await invoke("transfer_control", { jobId, control })) as TransferState;
}

/** Answer the conflict or error question that is open right now. */
export async function decideTransfer(
  jobId: string,
  decision: TransferDecision,
): Promise<TransferState> {
  return (await invoke("transfer_decide", { jobId, decision })) as TransferState;
}

/** One page of a report (200 items, five minutes per cursor). */
export async function transferReportPage(cursor: string): Promise<TransferReport> {
  return (await invoke("transfer_report_page", { cursor })) as TransferReport;
}

/**
 * Prove the exact recorded objects before an Undo or Redo replays them.
 *
 * Resolves when the plan still describes the reviewed objects; rejects with
 * a stable code (`ops.source_changed`, `ops.undo_unavailable`, ...) before
 * anything is touched. Copy Undo and folder-move Undo are refused here.
 */
export async function checkTransferReplay(
  transferId: string,
  reverse: boolean,
): Promise<void> {
  await invoke("transfer_replay_check", { transferId, reverse });
}

/**
 * The legacy `OpReport` shape, built from the items the transfer actually
 * reported (never from a preview). `transfer_id` keeps the exact effects so
 * the Undo entry replays through the receipt check.
 */
export function toOpReport(report: TransferReport): OpReport {
  const completed = report.items
    .filter((item) => item.status === "done" && item.to)
    .map((item) => ({ from: item.from, to: item.to as string }));
  return {
    completed,
    created: report.items
      .filter((item) => item.status === "done" && item.destination_created && item.to)
      .map((item) => ({ from: item.from, to: item.to as string })),
    skipped: report.items
      .filter((item) => item.status === "skipped" || item.status === "failed" || item.status === "cancelled")
      .map((item) => ({
        path: item.from,
        reason: (item.reason ?? "other").replace(/^ops\./, ""),
      })),
    cancelled: report.cancelled,
    replaced: [],
    transfer_id: report.transfer_id ?? null,
  };
}

/** True when `allowed` offers this action; the window hides the rest. */
export function isActionAllowed(
  request: TransferDecisionRequest,
  action: TransferAction,
): boolean {
  return request.allowed.includes(action);
}

/** The action a freshly opened conflict window focuses (never Cancel). */
export function initialAction(request: TransferDecisionRequest): TransferAction | null {
  for (const candidate of request.allowed) {
    if (candidate !== "cancel") return candidate;
  }
  return null;
}
