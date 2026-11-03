import { invoke } from "@tauri-apps/api/core";
import { releaseCacheLease, type CacheLease } from "./cache";
import { runJob, type JobHandle } from "./jobs";

/** Local picture thumbnails (Step 07a, E6).
 *
 * Consumers of the same path and edge size share one backend request. The
 * first consumer owns the backend request; every consumer has its own ID and
 * the last release cancels the group and releases the one lease. */

export type ThumbnailEdge = 64 | 128 | 256;
export const THUMBNAIL_EDGES: readonly ThumbnailEdge[] = [64, 128, 256];

export type ThumbnailState = "ready" | "unsupported" | "online_only" | "paused";

/** Mirrors Rust `thumbnails::ThumbnailRequest`. */
export interface ThumbnailRequest {
  path: string;
  edge: ThumbnailEdge;
  consumer_id: string;
}

/** Mirrors Rust `thumbnails::ThumbnailReply`. */
export interface ThumbnailReply {
  state: ThumbnailState;
  lease?: CacheLease;
}

/** The picture types the WIC helper claims. */
export const THUMBNAIL_EXTENSIONS: readonly string[] = [
  "png",
  "jpg",
  "jpeg",
  "jfif",
  "gif",
  "webp",
  "bmp",
  "ico",
  "tif",
  "tiff",
];

export function isThumbnailFile(name: string): boolean {
  // Works for a bare name and for a full path: only the last component and
  // its extension matter.
  const base = name.slice(Math.max(name.lastIndexOf("\\"), name.lastIndexOf("/")) + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return false;
  return THUMBNAIL_EXTENSIONS.includes(base.slice(dot + 1).toLowerCase());
}

/** The smallest offered edge at least the visible size times the display
 * scale, clamped to 256 (plan D8). */
export function thumbnailEdgeFor(cssSize: number, devicePixelRatio: number): ThumbnailEdge {
  const scale = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const wanted = Math.max(1, Math.ceil(cssSize * scale));
  if (wanted <= 64) return 64;
  if (wanted <= 128) return 128;
  return 256;
}

/** A consumer ID the Rust side accepts (a UUID v4). */
export function newThumbnailConsumerId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

interface Group {
  key: string;
  ownerId: string;
  consumers: Set<string>;
  promise: Promise<JobHandle<ThumbnailReply>>;
  handle?: JobHandle<ThumbnailReply>;
  lease?: CacheLease;
  released: boolean;
}

const groups = new Map<string, Group>();
const consumerKeys = new Map<string, string>();
const revisions = new WeakMap<object, number>();
let nextRevision = 0;

function keyOf(request: ThumbnailRequest, revision?: object): string {
  if (revision && !revisions.has(revision)) revisions.set(revision, ++nextRevision);
  return `${request.path}\u0000${request.edge}\u0000${revision ? revisions.get(revision) : 0}`;
}

/** Rust's cache-hit check. Null means a miss. The caller owns a ready lease
 * and releases it with `releaseCacheLease`. */
export async function lookupThumbnail(request: ThumbnailRequest): Promise<ThumbnailReply | null> {
  return (await invoke("thumbnail_lookup", { request })) as ThumbnailReply | null;
}

function syntheticHandle(reply: ThumbnailReply): JobHandle<ThumbnailReply> {
  return {
    id: "lookup",
    cancel: async () => undefined,
    completion: Promise.resolve(reply),
  };
}

async function createGroup(request: ThumbnailRequest, group: Group): Promise<JobHandle<ThumbnailReply>> {
  const cached = await lookupThumbnail(request);
  if (group.released) {
    if (cached?.lease) await releaseCacheLease(cached.lease.lease_id).catch(() => undefined);
    throw new Error("background.cancelled");
  }
  if (cached !== null) {
    if (cached.lease) group.lease = cached.lease;
    return syntheticHandle(cached);
  }
  const handle = await runJob<ThumbnailReply>("thumb", async (requestId) => {
    await invoke("thumbnail_request_start", { requestId, request });
  });
  if (group.released) {
    // The request was released while runJob was still starting. Observe the
    // handle so a lease that arrives late is released too; cancel() may reject
    // its completion instead of resolving it.
    void handle.completion
      .then((reply) => {
        if (reply?.lease) return releaseCacheLease(reply.lease.lease_id).catch(() => undefined);
        return undefined;
      })
      .catch(() => undefined);
    await handle.cancel().catch(() => undefined);
    await invoke("thumbnail_release", { consumerId: group.ownerId }).catch(() => undefined);
    throw new Error("background.cancelled");
  }
  group.handle = handle;
  void handle.completion
    .then((reply) => {
      if (reply?.lease) {
        if (group.released) {
          void releaseCacheLease(reply.lease.lease_id).catch(() => undefined);
        } else {
          group.lease = reply.lease;
        }
      }
    })
    .catch(() => undefined);
  return handle;
}

/** Start (or join) one thumbnail request. Every caller gets a handle for the
 * same result; release it with `releaseThumbnail`. */
export function requestThumbnail(request: ThumbnailRequest, sourceRevision?: object): Promise<JobHandle<ThumbnailReply>> {
  const key = keyOf(request, sourceRevision);
  let group = groups.get(key);
  if (!group) {
    const created: Group = {
      key,
      ownerId: request.consumer_id,
      consumers: new Set(),
      promise: Promise.resolve(syntheticHandle({ state: "unsupported" })),
      released: false,
    };
    created.promise = createGroup(request, created);
    groups.set(key, created);
    group = created;
  }
  group.consumers.add(request.consumer_id);
  consumerKeys.set(request.consumer_id, key);
  return group.promise;
}

/** Release one consumer. The last one cancels the backend group and its
 * lease exactly once; unknown IDs are ignored. */
export async function releaseThumbnail(consumerId: string): Promise<void> {
  const key = consumerKeys.get(consumerId);
  if (key === undefined) return;
  consumerKeys.delete(consumerId);
  const group = groups.get(key);
  if (!group) return;
  group.consumers.delete(consumerId);
  if (group.consumers.size > 0) return;
  groups.delete(key);
  group.released = true;
  try {
    if (group.handle) await group.handle.cancel();
  } catch {
    // The job may have finished a moment ago.
  }
  try {
    await invoke("thumbnail_release", { consumerId: group.ownerId });
  } catch {
    // Idempotent on the Rust side.
  }
  if (group.lease) {
    try {
      await releaseCacheLease(group.lease.lease_id);
    } catch {
      // The lease may already be gone.
    }
  }
}

/** Test-only: forget every group between tests. */
export function resetThumbnailServiceForTests(): void {
  groups.clear();
  consumerKeys.clear();
}
