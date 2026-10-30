import { invoke } from "@tauri-apps/api/core";
import { displayPath, itemDetails, parentPathOf, renameItem } from "./explorer";
import { isTauriRuntime } from "./settings";
import type { FileAction, UndoEntryInput } from "./undo";

/** Typed wrapper over the Step 03b file-operation jobs. All disk changes
 * go through here; big operations run as Rust background jobs with
 * progress and Cancel, and the UI polls (the transport ruling of
 * ADR 0005: Tauri Channels do not arrive under the isolation pattern). */

export type FileOpKind = "copy" | "move" | "recycle" | "restore" | "permanent" | "transfer";
export type ConflictPolicy = "replace" | "skip" | "keepBoth";
/** Job priority (contract 10): "foreground" when the user waits on it,
 * "normal" for file operations (the default), "background" for later
 * background tasks (low CPU and disk priority in Rust). */
export type JobPriority = "foreground" | "normal" | "background";

export interface OpProgress {
  items_done: number;
  items_total: number;
  bytes_done: number;
  bytes_total: number;
  current: string;
}

export interface CompletedItem {
  from: string;
  to: string;
}

export interface SkippedItem {
  path: string;
  /** Stable reason code, translated under `errors.ops`. */
  reason: string;
}

/** An existing item a Replace sent to the Recycle Bin. */
export interface ReplacedItem {
  path: string;
  /** Its own Recycle Bin entry, when it was found. */
  bin_id: string | null;
}

export interface OpReport {
  completed: CompletedItem[];
  skipped: SkippedItem[];
  cancelled: boolean;
  /** Items Replace sent to the Recycle Bin (Undo brings them back). */
  replaced: ReplacedItem[];
  /** Top-most items the operation made at the destination (only the new
   * ones inside a merged folder); Undo removes or moves back just these. */
  created: CompletedItem[];
  /** Opaque identifier for exact effects kept in Rust. */
  transfer_id?: string | null;
}

interface FileOpPoll {
  progress: OpProgress;
  done: boolean;
  report: OpReport | null;
  error: string | null;
}

export interface RunningJob {
  id: string;
  cancel: () => Promise<void>;
  completion: Promise<OpReport>;
}

let requestCounter = 0;
let retainedTransfers = new Set<string>();

/** Keep plans used by history, including entries pending in a group. */
export function setRetainedTransfers(entries: readonly UndoEntryInput[]): void {
  const next = new Set<string>();
  const visit = (action: FileAction) => {
    if (action.type === "transfer") next.add(action.id);
    else if (action.type === "sequence") action.actions.forEach(visit);
  };
  for (const entry of entries) { visit(entry.undo); visit(entry.redo); }
  retainedTransfers = next;
}
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

export async function checkConflicts(sources: string[], destDir: string): Promise<string[]> {
  const found = (await invoke("check_conflicts", { sources, destDir })) as string[];
  return found.map(displayPath);
}

export async function createItem(parent: string, name: string, kind: "folder" | "file"): Promise<string> {
  return displayPath((await invoke("create_item", { parent, name, kind })) as string);
}

/** Start a job and poll it. `onProgress` fires about ten times a second
 * at most; the completion promise resolves with the final report (which
 * lists skipped items instead of failing the whole operation). */
export async function startFileJob(
  kind: FileOpKind,
  sources: string[],
  options: {
    destDir?: string;
    conflict?: ConflictPolicy;
    /** For "restore": the exact bin entries, one per source. */
    binIds?: string[];
    priority?: JobPriority;
    allowSystem?: boolean;
    transferId?: string;
    reverse?: boolean;
    onProgress?: (progress: OpProgress) => void;
  } = {},
): Promise<RunningJob> {
  if (!isTauriRuntime()) throw new Error("ops.other");
  requestCounter += 1;
  const requestId = `op-${Date.now().toString(36)}-${requestCounter}`;
  await invoke("file_op_start", {
    request: {
      kind,
      sources,
      dest_dir: options.destDir ?? null,
      conflict: options.conflict ?? "skip",
      bin_ids: options.binIds ?? null,
      priority: options.priority ?? "normal",
      allow_system: options.allowSystem ?? false,
      transfer_id: options.transferId ?? null,
      reverse: options.reverse ?? false,
      retained_transfers: [...retainedTransfers],
    },
    requestId,
  });
  let cancelled = false;
  const cancel = async () => {
    cancelled = true;
    try {
      await invoke("file_op_cancel", { requestId });
    } catch {
      // The job may already have finished.
    }
  };
  const completion = (async (): Promise<OpReport> => {
    for (;;) {
      const poll = (await invoke("file_op_poll", { requestId })) as FileOpPoll;
      options.onProgress?.(poll.progress);
      if (poll.error) throw new Error(poll.error);
      if (poll.done && poll.report) {
        if (poll.report.transfer_id) retainedTransfers.add(poll.report.transfer_id);
        return {
          transfer_id: poll.report.transfer_id ?? null,
          completed: poll.report.completed.map((item) => ({
            from: displayPath(item.from),
            to: displayPath(item.to),
          })),
          skipped: poll.report.skipped.map((item) => ({
            path: displayPath(item.path),
            reason: item.reason,
          })),
          cancelled: poll.report.cancelled || cancelled,
          replaced: (poll.report.replaced ?? []).map((item) => ({
            path: displayPath(item.path),
            bin_id: item.bin_id,
          })),
          created: (poll.report.created ?? []).map((item) => ({
            from: displayPath(item.from),
            to: displayPath(item.to),
          })),
        };
      }
      await sleep(100);
    }
  })();
  return { id: requestId, cancel, completion };
}

export async function runFileJob(
  kind: FileOpKind,
  sources: string[],
  options: {
    destDir?: string;
    conflict?: ConflictPolicy;
    binIds?: string[];
    priority?: JobPriority;
    allowSystem?: boolean;
    transferId?: string;
    reverse?: boolean;
    onProgress?: (progress: OpProgress) => void;
  } = {},
): Promise<OpReport> {
  const job = await startFileJob(kind, sources, options);
  return job.completion;
}

/** Move one item to an exact target path, renaming afterwards when the
 * move kept a different name (Keep both). Never overwrites: when the
 * exact target is taken, the item lands next to it numbered instead. */
async function moveToExact(from: string, to: string, confirmSystem?: () => Promise<boolean>): Promise<string> {
  if (displayPath(from).toLowerCase() === displayPath(to).toLowerCase()) return to;
  const parent = parentPathOf(to);
  if (!parent) throw new Error("ops.other");
  const fromParent = parentPathOf(from);
  const name = to.split("\\").filter(Boolean).pop() ?? to;
  if (fromParent && displayPath(fromParent).toLowerCase() === displayPath(parent).toLowerCase()) {
    if ((await itemDetails(from)).attributes.includes("system")) {
      if (!confirmSystem || !(await confirmSystem())) throw new Error("ops.cancelled");
    }
    return renameItem(from, name);
  }
  const report = await runHistoryJob("move", [from], { destDir: parent, conflict: "keepBoth" }, confirmSystem);
  const landed = report.completed[0]?.to;
  if (!landed) throw new Error("ops.other");
  if (displayPath(landed).toLowerCase() === displayPath(to).toLowerCase()) return landed;
  return renameItem(landed, name);
}

/** Execute one undo/redo action and return the report(s) behind it. */
export async function executeFileAction(action: FileAction, confirmSystem?: () => Promise<boolean>): Promise<void> {
  switch (action.type) {
    case "transfer":
      await runHistoryJob("transfer", [], { transferId: action.id, reverse: action.reverse }, confirmSystem);
      return;
    case "rename":
      await moveToExact(action.from, action.to, confirmSystem);
      return;
    case "movePairs":
      for (const pair of action.pairs) {
        await moveToExact(pair.from, pair.to, confirmSystem);
      }
      return;
    case "copy":
      await runHistoryJob("copy", action.sources, { destDir: action.destDir, conflict: action.conflict }, confirmSystem);
      return;
    case "recycle":
      await runHistoryJob("recycle", action.paths, {}, confirmSystem);
      return;
    case "restore":
      await runHistoryJob("restore", action.originals, { binIds: action.binIds }, confirmSystem);
      return;
    case "sequence":
      for (const step of action.actions) {
        await executeFileAction(step, confirmSystem);
      }
      return;
  }
}

/** An incomplete Undo/Redo must not advance the shared history cursor. */
async function runHistoryJob(
  kind: FileOpKind, sources: string[], options: Parameters<typeof runFileJob>[2] = {},
  confirmSystem?: () => Promise<boolean>,
): Promise<OpReport> {
  let report: OpReport;
  try {
    report = await runFileJob(kind, sources, options);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "ops.system_confirmation_required") throw error;
    if (!confirmSystem || !(await confirmSystem())) throw new Error("ops.cancelled");
    report = await runFileJob(kind, sources, { ...options, allowSystem: true });
  }
  if (report.cancelled) throw new Error("ops.cancelled");
  if (report.skipped.length > 0) throw new Error(`ops.${report.skipped[0].reason}`);
  return report;
}

export interface ClipboardData {
  files: string[];
  cut: boolean;
  has_text: boolean;
  has_image: boolean;
}

export async function clipboardSetFiles(paths: string[], cut: boolean): Promise<void> {
  await invoke("clipboard_set_files", { paths, cut });
}

export async function clipboardRead(): Promise<ClipboardData> {
  const data = (await invoke("clipboard_read")) as ClipboardData;
  return { ...data, files: data.files.map(displayPath) };
}

export async function clipboardClear(): Promise<void> {
  await invoke("clipboard_clear");
}

export async function clipboardText(): Promise<string | null> {
  return (await invoke("clipboard_text")) as string | null;
}

/** Write clipboard text as a new file; returns the created path. */
export async function createTextFile(parent: string, name: string, contents: string): Promise<string> {
  return displayPath((await invoke("create_text_file", { parent, name, contents })) as string);
}

/** Save the clipboard image in `parent`; returns the created path. */
export async function clipboardImageFile(parent: string, baseName: string, format: "png" | "jpg"): Promise<string> {
  return displayPath(
    (await invoke("clipboard_image_file", { parent, baseName, format })) as string,
  );
}

/** Start a native drag to other apps; resolves with the chosen effect. */
export async function startExternalDrag(paths: string[]): Promise<"copy" | "move" | "link" | "none"> {
  return (await invoke("start_external_drag", { paths })) as "copy" | "move" | "link" | "none";
}

/** Create a .lnk shortcut to `target` inside `folder`; returns its path. */
export async function createShortcut(target: string, folder: string, name: string): Promise<string> {
  return displayPath((await invoke("create_shortcut", { target, folder, name })) as string);
}

/** Undo/redo entries for a finished job, or null when nothing changed. */
export function entryForJob(
  kind: "copy" | "move" | "recycle",
  report: OpReport,
  destDir: string | null,
): UndoEntryInput | null {
  if (report.completed.length === 0 && report.created.length === 0
    && report.replaced.length === 0 && !report.transfer_id) return null;
  const count = report.completed.length || report.created.length || report.replaced.length;
  // Items a Replace sent to the Recycle Bin come back after the new ones
  // are out of the way (exact bin entries, so never the new copy itself).
  const replaced = report.replaced.filter((item): item is ReplacedItem & { bin_id: string } => !!item.bin_id);
  const withReplaced = (first: FileAction): FileAction =>
    replaced.length === 0
      ? first
      : {
          type: "sequence",
          actions: [
            first,
            {
              type: "restore",
              originals: replaced.map((item) => item.path),
              binIds: replaced.map((item) => item.bin_id),
            },
          ],
        };
  if (report.transfer_id && kind !== "recycle") {
    return {
      labelKey: kind === "copy" ? "toast.copied" : "toast.moved",
      labelArgs: { count },
      undo: withReplaced({ type: "transfer", id: report.transfer_id, reverse: true }),
      redo: { type: "transfer", id: report.transfer_id, reverse: false },
    };
  }
  if (kind === "copy" && destDir) {
    return {
      labelKey: "toast.copied",
      labelArgs: { count },
      undo: withReplaced({ type: "recycle", paths: report.created.map((item) => item.to) }),
      redo: {
        type: "copy",
        sources: report.completed.map((item) => item.from),
        destDir,
        conflict: "keepBoth",
      },
    };
  }
  if (kind === "move") {
    return {
      labelKey: "toast.moved",
      labelArgs: { count },
      undo: withReplaced({
        type: "movePairs",
        pairs: report.created.map((item) => ({ from: item.to, to: item.from })),
      }),
      redo: {
        type: "movePairs",
        pairs: report.completed.map((item) => ({ from: item.from, to: item.to })),
      },
    };
  }
  return {
    labelKey: "toast.recycled",
    labelArgs: { count },
    undo: { type: "restore", originals: report.completed.map((item) => item.from) },
    redo: { type: "recycle", paths: report.completed.map((item) => item.from) },
  };
}
