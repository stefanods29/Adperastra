import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Multiplexed directory watchers (Step 09a E8). The native side keeps at
 * most 128 subscriptions and deduplicates the same root with reference
 * counts; this side routes `fs-watch` events by subscription id, ignores
 * stale generations, and releases a subscription 30 s after its view
 * becomes inactive. The legacy `watchStart`/`watchStop` pair keeps its
 * own single subscription and is never stopped by a folder tab. */

export interface WatchOptions {
  recursive: boolean;
}

export interface WatchSubscription {
  subscription_id: string;
  root: string;
  generation: number;
}

export type FsWatchEventKind = "create" | "change" | "remove" | "rename" | "overflow" | "error";

export interface FsWatchEvent {
  subscription_id: string;
  root: string;
  generation: number;
  kind: FsWatchEventKind;
  path?: string;
  old_path?: string;
  error_code?: string;
}

export const INACTIVE_WATCH_RELEASE_MS = 30000;

interface Consumer {
  subscription: WatchSubscription;
  listener: (event: FsWatchEvent) => void;
  active: boolean;
  releaseTimer: ReturnType<typeof setTimeout> | null;
}

const consumers = new Map<string, Consumer>();
let unlistenEvents: UnlistenFn | null = null;
let listening: Promise<void> | null = null;

async function ensureListener(): Promise<void> {
  if (unlistenEvents) return;
  if (!listening) {
    listening = listen<FsWatchEvent>("fs-watch", (event) => {
      const payload = event.payload;
      const consumer = consumers.get(payload.subscription_id);
      if (!consumer) return;
      if (payload.generation !== consumer.subscription.generation) return;
      consumer.listener(payload);
    })
      .then((unlisten) => {
        unlistenEvents = unlisten;
      })
      .catch((error: unknown) => {
        // A failed listener registration must be retryable: the next
        // subscribe starts a fresh attempt instead of awaiting this one.
        listening = null;
        throw error;
      });
  }
  await listening;
}

export async function watchSubscribe(
  path: string,
  listenerFn: (event: FsWatchEvent) => void,
  options: WatchOptions = { recursive: false },
): Promise<WatchSubscription> {
  await ensureListener();
  const subscription = (await invoke("watch_subscribe", {
    path,
    options: { recursive: options.recursive },
  })) as WatchSubscription;
  consumers.set(subscription.subscription_id, {
    subscription,
    listener: listenerFn,
    active: true,
    releaseTimer: null,
  });
  return subscription;
}

export async function watchUnsubscribe(subscriptionId: string): Promise<void> {
  const consumer = consumers.get(subscriptionId);
  if (consumer?.releaseTimer) clearTimeout(consumer.releaseTimer);
  consumers.delete(subscriptionId);
  await invoke("watch_unsubscribe", { subscriptionId });
}

/** A folder view became inactive: keep its state, release its watcher
 * after 30 s unless it is reactivated first. Returns false when the
 * subscription is already gone (the release timer fired), so the caller
 * can subscribe again instead of showing a permanently stale view. */
export function watchSetActive(subscriptionId: string, active: boolean): boolean {
  const consumer = consumers.get(subscriptionId);
  if (!consumer) return false;
  consumer.active = active;
  if (consumer.releaseTimer) {
    clearTimeout(consumer.releaseTimer);
    consumer.releaseTimer = null;
  }
  if (!active) {
    consumer.releaseTimer = setTimeout(() => {
      void watchUnsubscribe(subscriptionId).catch(() => undefined);
    }, INACTIVE_WATCH_RELEASE_MS);
  }
  return true;
}

/** True while this consumer is still routed (tests and folder-tab
 * reactivation). */
export function watchHasConsumer(subscriptionId: string): boolean {
  return consumers.has(subscriptionId);
}

/** Live consumer count (tests and diagnostics). */
export function watchConsumerCount(): number {
  return consumers.size;
}
