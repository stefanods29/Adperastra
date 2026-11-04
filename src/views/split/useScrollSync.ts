import { useEffect, useRef, useState } from "react";
import { linkScrollPorts, resolveScrollSyncPort, type ScrollSyncPort } from "./scrollSync";

/** Keeps a split's synchronized scrolling honest (Step 09i T4).
 *
 * The split view asks for the two leaf ports by view id. A viewer registers
 * its port while it mounts (lazily, after its file is ready), so the hook
 * re-checks for a bounded number of frames instead of assuming a port that
 * has not arrived. When both ports exist and the user turned sync on, the
 * two ports are aligned once from the active side and linked; every
 * pending frame and subscription is released on unmount, on a view change
 * and when sync is turned off. */

/** About one second of frames: long enough for a lazy viewer to mount,
 * short enough to stop retrying and say "unavailable". */
const MAX_RESOLVE_ATTEMPTS = 60;

export interface ScrollSyncLink {
  /** Both leaves registered a compatible port. */
  available: boolean;
  /** Sync is on and the ports are actually linked right now. */
  linked: boolean;
  first: ScrollSyncPort | null;
  second: ScrollSyncPort | null;
}

export interface UseScrollSyncOptions {
  enabled: boolean;
  /** The active side's view id: the initial alignment comes from it. */
  activeViewId: string | null;
  /** Defaults to the shared registry; tests pass their own resolver. */
  resolve?: (viewId: string) => ScrollSyncPort | null;
}

function nextFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === "function" && typeof cancelAnimationFrame === "function") {
    const handle = requestAnimationFrame(() => callback());
    return () => cancelAnimationFrame(handle);
  }
  const timer = setTimeout(callback, 16);
  return () => clearTimeout(timer);
}

export function useScrollSync(
  firstViewId: string,
  secondViewId: string,
  options: UseScrollSyncOptions,
): ScrollSyncLink {
  // The resolver is read through a ref so an inline arrow from the host
  // cannot restart the effects on every render.
  const resolveRef = useRef(options.resolve ?? resolveScrollSyncPort);
  resolveRef.current = options.resolve ?? resolveScrollSyncPort;
  const activeRef = useRef(options.activeViewId);
  activeRef.current = options.activeViewId;
  const [ports, setPorts] = useState<readonly [ScrollSyncPort | null, ScrollSyncPort | null]>([null, null]);
  const [attempt, setAttempt] = useState(0);
  const [linked, setLinked] = useState(false);

  useEffect(() => {
    setPorts([resolveRef.current(firstViewId), resolveRef.current(secondViewId)]);
    setAttempt(0);
  }, [firstViewId, secondViewId]);

  const first = ports[0];
  const second = ports[1];
  const available = first !== null && second !== null;

  // Bounded retry while a viewer is still mounting, so the sync control
  // becomes available as soon as both sides can follow progress.
  useEffect(() => {
    if (available || attempt >= MAX_RESOLVE_ATTEMPTS) return;
    const cancel = nextFrame(() => {
      setPorts([resolveRef.current(firstViewId), resolveRef.current(secondViewId)]);
      setAttempt((value) => value + 1);
    });
    return cancel;
  }, [available, attempt, firstViewId, secondViewId]);

  // One link per pair of ports; the active side aligns the other exactly
  // once, before the link starts (Step 09i D6). Later active-side changes
  // do not re-align: they only decide where the next command goes.
  useEffect(() => {
    if (!options.enabled || !first || !second) {
      setLinked(false);
      return;
    }
    const active = activeRef.current === second.view_id ? second : first;
    const other = active === first ? second : first;
    other.setProgress(active.getProgress(), 0);
    const dispose = linkScrollPorts(first, second);
    setLinked(true);
    return dispose;
  }, [options.enabled, first, second]);

  return { available, linked, first, second };
}
