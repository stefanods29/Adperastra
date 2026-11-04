import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { OpProgress } from "../services/fileops";
import type { JobHandle } from "../services/jobs";
import {
  startTransfer,
  type TransferReport,
  type TransferRequest,
} from "../services/transferJobs";
import TransferWindow from "./TransferWindow";

/** How many first report pages stay available for reopening a job. */
const MAX_REMEMBERED_REPORTS = 16;

interface TransferHostState {
  jobId: string | null;
  report: TransferReport | undefined;
}

const reports = new Map<string, TransferReport>();
const listeners = new Set<() => void>();
let snapshot: TransferHostState = { jobId: null, report: undefined };

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/** Keep at most the newest first pages, oldest evicted first. */
export function rememberTransferReport(jobId: string, report: TransferReport): void {
  reports.delete(jobId);
  reports.set(jobId, report);
  while (reports.size > MAX_REMEMBERED_REPORTS) {
    const oldest = reports.keys().next().value;
    if (oldest === undefined) break;
    reports.delete(oldest);
  }
  if (snapshot.jobId === jobId) {
    snapshot = { jobId, report };
    emit();
  }
}

/** Show one job's window, with its remembered first page when there is one. */
export function openTransfer(jobId: string): void {
  snapshot = { jobId, report: reports.get(jobId) };
  emit();
}

/**
 * Start a transfer through the one queue and show its window. Every caller
 * (the Explorer and the app shelf) enters here, so the first report page is
 * always remembered for the Jobs panel's Open.
 */
export async function startHostedTransfer(
  request: TransferRequest,
  onProgress?: (progress: OpProgress) => void,
): Promise<JobHandle<TransferReport>> {
  const job = await startTransfer(request, onProgress);
  void job.completion
    .then((report) => rememberTransferReport(job.id, report))
    .catch(() => undefined);
  openTransfer(job.id);
  return job;
}

/** Hide the window; the job itself keeps running. */
export function closeTransfer(): void {
  if (snapshot.jobId === null) return;
  snapshot = { jobId: null, report: undefined };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): TransferHostState {
  return snapshot;
}

/**
 * The one transfer window host (Step 09f). The Explorer and the app shelf
 * both open jobs through the module above, so there is a single window and
 * the Jobs panel's Open still reopens a finished job with its first page.
 */
export default function TransferHost({
  onOpenHelp,
}: {
  onOpenHelp: (slug: string) => void;
}) {
  const current = useSyncExternalStore(subscribe, getSnapshot);
  if (current.jobId === null) return null;
  return createPortal(
    <TransferWindow
      jobId={current.jobId}
      initialReport={current.report}
      onClose={closeTransfer}
      onOpenHelp={onOpenHelp}
    />,
    document.body,
  );
}
