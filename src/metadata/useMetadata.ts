import { useEffect, useState } from "react";
import { errorCode } from "../services/errors";
import { newRequestId, type JobHandle } from "../services/jobs";
import { readMetadata, releaseMetadata, type MetadataInfo } from "../services/metadata";
import { isTauriRuntime } from "../services/settings";
export const METADATA_DEBOUNCE_MS = 150;
export type MetadataStatus = "idle" | "loading" | "ready" | "failed";
export interface MetadataState { path: string | null; info: MetadataInfo | null; status: MetadataStatus; error: string | null }
export function metadataConsumerId(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto?.getRandomValues !== "function") throw new Error("metadata.failed");
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
/** Each effect owns one consumer and observes even a late rejected job. */
export function useMetadata(path: string | null, enabled = true, sourceRevision?: unknown): MetadataState {
  const [state, setState] = useState<MetadataState>({ path: null, info: null, status: "idle", error: null });
  useEffect(() => {
    let alive = true;
    let job: JobHandle<MetadataInfo> | null = null;
    if (path === null || !enabled || !isTauriRuntime()) { setState({ path: null, info: null, status: "idle", error: null }); return; }
    let id: string;
    try { id = metadataConsumerId(); } catch { setState({ path, info: null, status: "failed", error: "metadata.failed" }); return; }
    setState({ path, info: null, status: "loading", error: null });
    const release = () => { void releaseMetadata(id).catch(() => undefined); };
    const timer = window.setTimeout(() => {
      void readMetadata(newRequestId("metadata"), { path, consumer_id: id }).then(async handle => {
        // Attach the rejection observer before any cancellation/late cleanup.
        const completion = handle.completion.then(info => ({ info }), error => ({ error }));
        if (!alive) { void handle.cancel().catch(() => undefined); release(); }
        else job = handle;
        const result = await completion;
        if (alive) {
          if ("info" in result) setState({ path, info: result.info, status: "ready", error: null });
          else setState({ path, info: null, status: "failed", error: errorCode(result.error) });
        }
        if (job === handle) job = null;
        // Result metadata has no browser lease. Finishing frees the consumer.
        release();
      }).catch(error => { release(); if (alive) setState({ path, info: null, status: "failed", error: errorCode(error) }); });
    }, METADATA_DEBOUNCE_MS);
    return () => { alive = false; window.clearTimeout(timer); void job?.cancel().catch(() => undefined); release(); };
  }, [path, enabled, sourceRevision]);
  return state;
}
