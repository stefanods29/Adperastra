/** UI-side acceptance of 09a watch events (Step 11a T3). The index itself
 * applies events natively; the results view uses this to decide whether the
 * first page must be reloaded and whether an event is from a stale watcher
 * generation. Pure, no listener table duplication. */

export type SearchWatchKind =
  | "create"
  | "change"
  | "remove"
  | "rename"
  | "overflow"
  | "error";

export interface SearchWatchEvent {
  subscription_id: string;
  root: string;
  generation: number;
  kind: SearchWatchKind;
  path?: string | null;
  old_path?: string | null;
}

export interface SearchWatchState {
  subscriptions: Record<string, { root: string; generation: number }>;
}

export function registerSearchWatch(
  state: SearchWatchState,
  subscriptionId: string,
  root: string,
  generation: number,
): SearchWatchState {
  return {
    subscriptions: {
      ...state.subscriptions,
      [subscriptionId]: { root, generation },
    },
  };
}

export function unregisterSearchWatch(
  state: SearchWatchState,
  subscriptionId: string,
): SearchWatchState {
  const subscriptions = { ...state.subscriptions };
  delete subscriptions[subscriptionId];
  return { subscriptions };
}

/** An unknown or older generation must not refresh a newer query. */
export function acceptsSearchWatchEvent(
  state: SearchWatchState,
  event: SearchWatchEvent,
): boolean {
  const subscription = state.subscriptions[event.subscription_id];
  if (!subscription) return false;
  if (event.kind === "error") return false;
  return event.generation >= subscription.generation;
}

/** Overflow and unpaired renames force a fresh first page. */
export function searchWatchNeedsReload(event: SearchWatchEvent): boolean {
  if (event.kind === "overflow") return true;
  if (event.kind === "rename") return !event.old_path;
  return event.kind === "create" || event.kind === "remove" || event.kind === "change";
}
