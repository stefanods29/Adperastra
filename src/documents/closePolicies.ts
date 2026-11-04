import type { DocumentHandle, DocumentProviderId } from "./types";

/** Atomic close preparation (Step 09a E11). Every multi-document close
 * (tab, group, split, app, lock) goes through `prepareDocumentClose`: the
 * full proposed close set is decided first, and nothing is removed,
 * released or discarded until the whole plan succeeds. */

export type DocumentCloseReason = "tab" | "group" | "split" | "app" | "lock";

export interface DocumentClosePolicy {
  prepareClose(documents: readonly DocumentHandle[], reason: DocumentCloseReason): Promise<boolean>;
}

const policies = new Map<DocumentProviderId, DocumentClosePolicy>();

export function registerDocumentClosePolicy(providerId: DocumentProviderId, policy: DocumentClosePolicy): void {
  if (policies.has(providerId)) throw new Error("documents.provider_missing");
  policies.set(providerId, policy);
}

export function documentClosePolicy(providerId: DocumentProviderId): DocumentClosePolicy | null {
  return policies.get(providerId) ?? null;
}

/** Test helper: forget every registered policy and decider. */
export function clearDocumentClosePolicies(): void {
  policies.clear();
  genericDecider = null;
}

/** The generic dirty decision for disk documents without a provider
 * policy. The coordinator bridges this to the unsaved-changes dialog; the
 * decider records Save/Discard intent only and must not discard or reset
 * any model before the whole plan is approved. */
export type GenericDirtyDecider = (documents: readonly DocumentHandle[], reason: DocumentCloseReason) => Promise<boolean>;

let genericDecider: GenericDirtyDecider | null = null;

export function registerGenericDocumentCloseDecider(decider: GenericDirtyDecider): void {
  genericDecider = decider;
}

interface CapturedDocument {
  handle: DocumentHandle;
  revision: number;
  content_id: string;
}

/** Decide a whole close plan. Only documents whose last live view would
 * close may be passed in. Returns false, changing nothing, when any
 * policy or dialog cancels, throws, persistence fails, or any prepared
 * document's content changed while deciding. */
export async function prepareDocumentClose(
  documents: readonly DocumentHandle[],
  reason: DocumentCloseReason,
): Promise<boolean> {
  const seen = new Set<string>();
  const unique: DocumentHandle[] = [];
  for (const handle of documents) {
    if (seen.has(handle.id)) continue;
    seen.add(handle.id);
    unique.push(handle);
  }
  if (unique.length === 0) return true;

  const captured: CapturedDocument[] = unique.map((handle) => {
    const state = handle.getState();
    return { handle, revision: state.revision, content_id: state.content_id };
  });
  const unchanged = (): boolean =>
    captured.every((entry) => {
      const state = entry.handle.getState();
      return state.revision === entry.revision && state.content_id === entry.content_id;
    });

  const byProvider = new Map<DocumentProviderId, DocumentHandle[]>();
  for (const handle of unique) {
    const providerId = handle.source.kind === "disk" ? "disk" : handle.source.kind === "virtual" ? "locked" : "draft";
    const group = byProvider.get(providerId) ?? [];
    group.push(handle);
    byProvider.set(providerId, group);
  }

  try {
    const generic: DocumentHandle[] = [];
    for (const [providerId, group] of byProvider) {
      const policy = policies.get(providerId);
      if (policy) {
        if (!(await policy.prepareClose(group, reason))) return false;
      } else if (providerId === "disk") {
        generic.push(...group);
      } else {
        // A locked or draft document without its policy cannot be decided
        // safely: cancel the whole plan instead of guessing.
        return false;
      }
    }
    if (generic.length > 0) {
      const dirty = generic.filter((handle) => handle.getState().dirty);
      if (dirty.length > 0) {
        if (!genericDecider) return false;
        if (!(await genericDecider(dirty, reason))) return false;
      }
    }
  } catch {
    return false;
  }
  return unchanged();
}
