import { releaseExportSnapshot, type ExportSnapshot } from "../services/exportSnapshots";
import { saveRecoverySnapshot, type RecoveryMetadata } from "../services/recovery";
import type { DocumentHandle, DocumentState } from "./types";

/**
 * One capture owner per document (Step 09h E3/T2). Duplicate views share the
 * same entry; edits debounce for two seconds and one document never captures
 * more than once every ten seconds (or its configured interval). A capture
 * keeps the immutable snapshot it received: later edits never change R.
 */

export const DEBOUNCE_MS = 2_000;
export const MIN_INTERVAL_MS = 10_000;
export const MAX_DOCUMENTS = 32;
export const MAX_TOTAL_BYTES = 1_073_741_824;
export const MAX_RECORD_BYTES = 67_108_864;

export interface RecoveryCaptureOptions {
  enabled: boolean;
  interval_seconds: number;
}

export type RecoveryWarning = (code: string) => void;

interface CaptureDeps {
  upload: (snapshot: ExportSnapshot, metadata: RecoveryMetadata) => Promise<unknown>;
  release: (snapshotId: string) => Promise<unknown>;
  now: () => number;
  setTimer: (callback: () => void, delay: number) => number;
  clearTimer: (id: number) => void;
  handlerIdFor: (documentId: string) => string | undefined;
}

const handlerIds = new Map<string, string>();

/** The controller owner registers the real handler once per document. */
export function registerRecoveryHandlerId(documentId: string, handlerId: string): void {
  if (handlerId.length > 0 && handlerId.length <= 64) handlerIds.set(documentId, handlerId);
}

export function unregisterRecoveryHandlerId(documentId: string): void {
  handlerIds.delete(documentId);
}

interface CaptureEntry {
  document: DocumentHandle;
  options: RecoveryCaptureOptions;
  warnings: Set<RecoveryWarning>;
  unsubscribe: () => void;
  refs: number;
  timer: number | null;
  lastCapturedContentId: string | null;
  lastCaptureAt: number;
  reservedBytes: number;
  warned: Set<string>;
  disposed: boolean;
}

export class RecoveryCaptureRegistry {
  private entries = new Map<string, CaptureEntry>();
  private deps: CaptureDeps;
  private active = 0;
  private waiting: Array<() => void> = [];
  private totalReserved = 0;

  constructor(deps?: Partial<CaptureDeps>) {
    this.deps = {
      upload:
        deps?.upload ??
        ((snapshot, metadata) =>
          saveRecoverySnapshot(snapshot, metadata).then((handle) => handle.completion)),
      release: deps?.release ?? ((snapshotId) => releaseExportSnapshot(snapshotId)),
      now: deps?.now ?? (() => Date.now()),
      setTimer: deps?.setTimer ?? ((callback, delay) => window.setTimeout(callback, delay)),
      clearTimer: deps?.clearTimer ?? ((id) => window.clearTimeout(id)),
      handlerIdFor: deps?.handlerIdFor ?? ((documentId) => handlerIds.get(documentId)),
    };
  }

  /** Acquire one reference for a view. Release cancels pending work and
   * removes the owner after the last view closes. */
  acquire(
    document: DocumentHandle,
    options: RecoveryCaptureOptions,
    onWarning: RecoveryWarning,
  ): () => void {
    if (!options.enabled) return () => undefined;
    const existing = this.entries.get(document.id);
    if (existing) {
      existing.refs += 1;
      existing.warnings.add(onWarning);
      return () => this.release(document.id, onWarning);
    }
    const entry: CaptureEntry = {
      document,
      options: { ...options },
      warnings: new Set([onWarning]),
      unsubscribe: () => undefined,
      refs: 1,
      timer: null,
      lastCapturedContentId: null,
      lastCaptureAt: 0,
      reservedBytes: 0,
      warned: new Set(),
      disposed: false,
    };
    this.entries.set(document.id, entry);
    entry.unsubscribe = document.subscribe((state) => this.onState(entry, state));
    this.onState(entry, document.getState());
    return () => this.release(document.id, onWarning);
  }

  private release(documentId: string, onWarning: RecoveryWarning): void {
    const entry = this.entries.get(documentId);
    if (!entry) return;
    entry.warnings.delete(onWarning);
    entry.refs -= 1;
    if (entry.refs > 0) return;
    entry.disposed = true;
    if (entry.timer !== null) this.deps.clearTimer(entry.timer);
    entry.timer = null;
    entry.unsubscribe();
    this.totalReserved -= entry.reservedBytes;
    entry.reservedBytes = 0;
    this.entries.delete(documentId);
  }

  private onState(entry: CaptureEntry, state: DocumentState): void {
    if (entry.disposed) return;
    if (!entry.options.enabled) return;
    if (entry.document.info.sensitive) {
      this.warn(entry, state, "recovery.sensitive");
      return;
    }
    if (!state.dirty) return;
    if (state.content_id === entry.lastCapturedContentId) return;
    if (!state.editing_enabled && state.ready) {
      this.warn(entry, state, "recovery.unsupported");
      return;
    }
    if (entry.timer !== null) this.deps.clearTimer(entry.timer);
    const configured = Math.max(MIN_INTERVAL_MS, Math.floor(entry.options.interval_seconds * 1000));
    const elapsed = this.deps.now() - entry.lastCaptureAt;
    const delay = Math.max(DEBOUNCE_MS, configured - elapsed);
    entry.timer = this.deps.setTimer(() => {
      entry.timer = null;
      void this.capture(entry);
    }, delay);
  }

  private warn(entry: CaptureEntry, state: DocumentState, code: string): void {
    const key = `${state.content_id}:${code}`;
    if (entry.warned.has(key)) return;
    entry.warned.add(key);
    for (const listener of entry.warnings) listener(code);
  }

  private async capture(entry: CaptureEntry): Promise<void> {
    if (entry.disposed) return;
    await this.exclusive(async () => {
      if (entry.disposed) return;
      const state = entry.document.getState();
      if (!state.dirty) return;
      if (state.content_id === entry.lastCapturedContentId) return;
      const configured = Math.max(MIN_INTERVAL_MS, Math.floor(entry.options.interval_seconds * 1000));
      const elapsed = this.deps.now() - entry.lastCaptureAt;
      if (elapsed < configured) {
        entry.timer = this.deps.setTimer(() => {
          entry.timer = null;
          void this.capture(entry);
        }, configured - elapsed);
        return;
      }
      const handlerId = this.deps.handlerIdFor(entry.document.id);
      if (!handlerId) {
        this.warn(entry, state, "recovery.unsupported");
        return;
      }
      if (this.entries.size > MAX_DOCUMENTS) {
        this.warn(entry, state, "recovery.too_large");
        return;
      }
      let snapshot: ExportSnapshot;
      try {
        // The snapshot is immutable: everything below uses this value even
        // when the document changes while the upload is queued.
        snapshot = await entry.document.captureSnapshot();
      } catch {
        this.warn(entry, state, "recovery.unsupported");
        return;
      }
      try {
        if (snapshot.byte_len > MAX_RECORD_BYTES) {
          this.warn(entry, state, "recovery.too_large");
          return;
        }
        if (this.totalReserved + snapshot.byte_len > MAX_TOTAL_BYTES) {
          this.warn(entry, state, "recovery.too_large");
          return;
        }
        const metadata: RecoveryMetadata = {
          version: 1,
          record_id: crypto.randomUUID(),
          document_id: snapshot.document_id,
          source: entry.document.source,
          source_stamp: snapshot.source,
          name: entry.document.info.name,
          mime: snapshot.mime,
          handler_id: handlerId,
          captured_revision: snapshot.revision,
          content_id: snapshot.content_id,
          captured_unix: Math.floor(this.deps.now() / 1000),
          byte_len: snapshot.byte_len,
          from_internet: entry.document.info.from_internet,
          sensitive: false,
        };
        entry.reservedBytes = snapshot.byte_len;
        this.totalReserved += snapshot.byte_len;
        try {
          await this.deps.upload(snapshot, metadata);
          entry.lastCapturedContentId = snapshot.content_id;
          entry.lastCaptureAt = this.deps.now();
        } catch (error) {
          this.warn(entry, state, warningCode(error));
        } finally {
          this.totalReserved -= entry.reservedBytes;
          entry.reservedBytes = 0;
        }
      } finally {
        // The recovery job has resolved its own lease (or failed). Do not
        // retain the source snapshot and its ordinary staging file here.
        await this.deps.release(snapshot.snapshot_id).catch(() => undefined);
      }
    });
  }

  /** Only one upload is in flight across the whole registry. */
  private async exclusive<T>(task: () => Promise<T>): Promise<T> {
    while (this.active > 0) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }

  /** Test/status helper: how many documents this registry owns. */
  get size(): number {
    return this.entries.size;
  }
}

function warningCode(error: unknown): string {
  if (typeof error === "string" && /^recovery\.[a-z_]+$/.test(error)) return error;
  if (error instanceof Error && /^recovery\.[a-z_]+$/.test(error.message)) return error.message;
  return "recovery.io";
}

export const recoveryCaptureRegistry = new RecoveryCaptureRegistry();
