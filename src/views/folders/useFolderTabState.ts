import { useEffect, useRef, useState } from "react";
import type { ExplorerItem } from "../../services/explorer";
import { clampFolderTabState, HOME_FOLDER_PATH, type FolderTabState } from "../../services/folderState";
import {
  watchSetActive,
  watchSubscribe,
  watchUnsubscribe,
  type WatchSubscription,
} from "../../services/watcherMultiplexer";

/** One folder tab's own state (Step 09a D2): selection, focus and quick
 * preview live here, per tab, never in a shared Explorer instance. The
 * watcher runs while the tab is active and is released 30 s after the
 * tab becomes inactive; reactivation resubscribes and rescans. */
export interface FolderTabViewState {
  state: FolderTabState;
  setState: (state: FolderTabState) => void;
  selectedPaths: readonly string[];
  setSelectedPaths: (paths: readonly string[]) => void;
  previewItem: ExplorerItem | null;
  setPreviewItem: (item: ExplorerItem | null) => void;
  rescanNonce: number;
}

function sameRoot(left: string, right: string): boolean {
  const plain = (path: string) => path.replace(/^\\\\\?\\/, "").replace(/\//g, "\\").toLowerCase();
  return plain(left) === plain(right);
}

export function useFolderTabState(
  initial: FolderTabState,
  active: boolean,
  onViewChange: (state: FolderTabState) => void,
): FolderTabViewState {
  const [state, setStateInternal] = useState<FolderTabState>(() => clampFolderTabState(initial));
  const [selectedPaths, setSelectedPaths] = useState<readonly string[]>([]);
  const [previewItem, setPreviewItem] = useState<ExplorerItem | null>(null);
  const [rescanNonce, setRescanNonce] = useState(0);
  const subscriptionRef = useRef<WatchSubscription | null>(null);
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;

  const setState = (next: FolderTabState) => {
    const clamped = clampFolderTabState(next);
    setStateInternal(clamped);
    onViewChangeRef.current(clamped);
  };

  // Subscribe while active; pause after 30 s inactive (the multiplexer
  // releases); resubscribe and rescan on reactivation.
  useEffect(() => {
    if (state.path === HOME_FOLDER_PATH) {
      const previous = subscriptionRef.current;
      subscriptionRef.current = null;
      if (previous) void watchUnsubscribe(previous.subscription_id).catch(() => undefined);
      return;
    }
    if (!active) {
      const subscription = subscriptionRef.current;
      if (subscription) watchSetActive(subscription.subscription_id, false);
      return;
    }
    let cancelled = false;
    const existing = subscriptionRef.current;
    if (existing) {
      // The multiplexer releases an inactive consumer after 30 s. When
      // that happened (or the tab now shows another folder), the old
      // subscription is not routable anymore; subscribe again instead of
      // reporting events forever through a dead id.
      if (sameRoot(existing.root, state.path) && watchSetActive(existing.subscription_id, true)) {
        setRescanNonce((value) => value + 1);
        return;
      }
      subscriptionRef.current = null;
      void watchUnsubscribe(existing.subscription_id).catch(() => undefined);
    }
    void watchSubscribe(state.path, (event) => {
      if (event.kind === "overflow" || event.kind === "error") {
        setRescanNonce((value) => value + 1);
        return;
      }
      setRescanNonce((value) => value + 1);
    })
      .then((subscription) => {
        if (cancelled) {
          void watchUnsubscribe(subscription.subscription_id).catch(() => undefined);
          return;
        }
        subscriptionRef.current = subscription;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // The path is the tab's identity for watching; view-state fields do
    // not resubscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, state.path]);

  // Release the watcher for good when the tab unmounts.
  useEffect(() => {
    return () => {
      const subscription = subscriptionRef.current;
      subscriptionRef.current = null;
      if (subscription) void watchUnsubscribe(subscription.subscription_id).catch(() => undefined);
    };
  }, []);

  return { state, setState, selectedPaths, setSelectedPaths, previewItem, setPreviewItem, rescanNonce };
}
