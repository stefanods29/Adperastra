/**
 * Trusted timeline transactions (Step 19a E4).
 *
 * A transaction checks the expected immutable content identity, runs one
 * transform on a frozen copy, validates the result and commits exactly once:
 * one history entry, one revision increment and one content-ID notification.
 * The host (the shared document controller) owns the actual model and the
 * revision; this module never writes files or talks to Rust.
 */

import type { TimelineOperation, TimelineProject } from "./types";
import { TimelineError } from "./types";
import { cloneProject, freezeProject, validateTimelineProject } from "./projectValidation";
import { applyTimelineOperation, sameProject } from "./operations";

/** The live document model a transaction commits against. */
export interface TimelineTransactionHost {
  readonly documentId: string;
  getProject(): Readonly<TimelineProject>;
  getRevision(): number;
  getContentId(): string;
  /** Validate, record one history entry, notify and publish once. */
  commitProject(next: TimelineProject, label: string): Promise<void>;
}

const hosts = new Map<string, TimelineTransactionHost>();

/** Register the one host for a document; returns an idempotent disposer. */
export function registerTimelineTransactionHost(
  host: TimelineTransactionHost,
): () => void {
  if (!host.documentId) throw new TimelineError("timeline.bad_request");
  if (hosts.has(host.documentId)) {
    throw new TimelineError("timeline.bad_request", "duplicate timeline host");
  }
  hosts.set(host.documentId, host);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    if (hosts.get(host.documentId) === host) hosts.delete(host.documentId);
  };
}

/** The host for a document ID, or null. */
export function findTimelineTransactionHost(
  documentId: string,
): TimelineTransactionHost | null {
  return hosts.get(documentId) ?? null;
}

/**
 * E4: commit one trusted transform for an exact expected content identity.
 * `timeline.changed` means the caller worked from a stale revision.
 */
export async function commitTimelineTransaction(
  documentId: string,
  expectedContentId: string,
  transform: (current: Readonly<TimelineProject>) => TimelineProject,
): Promise<void> {
  if (typeof documentId !== "string" || typeof expectedContentId !== "string") {
    throw new TimelineError("timeline.bad_request");
  }
  const host = hosts.get(documentId);
  if (!host) throw new TimelineError("timeline.bad_request", "unknown timeline document");
  if (host.getContentId() !== expectedContentId) {
    throw new TimelineError("timeline.changed");
  }
  const current = freezeProject(cloneProject(host.getProject()));
  let next: TimelineProject;
  try {
    next = transform(current);
  } catch (error) {
    if (error instanceof TimelineError) throw error;
    throw new TimelineError("timeline.bad_request", "transform failed");
  }
  if (typeof next !== "object" || next === null) {
    throw new TimelineError("timeline.bad_request", "transform result");
  }
  await host.commitProject(validateTimelineProject(next), "transaction");
}

/** Apply one operation through the host; a no-op records no history. */
export async function applyTimelineOperationToHost(
  host: TimelineTransactionHost,
  operation: TimelineOperation,
): Promise<void> {
  const current = host.getProject();
  const next = applyTimelineOperation(current, operation);
  if (sameProject(next, current)) return;
  await host.commitProject(next, operation.kind);
}
