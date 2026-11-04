/** Read-only hover previews for inactive file tabs (Step 10c T2).
 *
 * A timer starts only for an inactive file tab when the option is on. It is
 * cancelled on leave, close, activation, disable or unmount. Cloud files are
 * skipped before any content is requested: the preview is `previewOnly` and
 * never autoplays media.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fileDetect } from "../services/files";
import { isTauriRuntime } from "../services/settings";
import type { TabOptions } from "../services/tabOptions";
import type { TabState } from "../services/tabs";

export interface TabHoverInspection {
  online_only: boolean;
}

export interface TabHoverPreviewOptions {
  tab: TabState;
  /** The preview is only for inactive tabs. */
  active: boolean;
  options: TabOptions;
  /** False when the strip is hidden or the window is not usable. */
  enabled?: boolean;
  /** Test seam; production uses file attributes only. */
  inspect?: (path: string) => Promise<TabHoverInspection>;
}

export interface TabHoverPreviewState {
  previewPath: string | null;
  /** 07b preview contract: read-only, no save/dirty/model changes. */
  previewOnly: true;
  /** Media is paused initially and on every navigation/close. */
  autoplay: false;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  cancel: () => void;
}

const defaultInspect = async (path: string): Promise<TabHoverInspection> => {
  if (!isTauriRuntime()) return { online_only: false };
  const info = await fileDetect(path);
  return { online_only: info.online_only };
};

export function useTabHoverPreview({
  tab,
  active,
  options,
  enabled = true,
  inspect = defaultInspect,
}: TabHoverPreviewOptions): TabHoverPreviewState {
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const generation = useRef(0);
  const hovering = useRef(false);
  const mounted = useRef(true);

  const cancel = useCallback(() => {
    hovering.current = false;
    generation.current += 1;
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setPreviewPath(null);
  }, []);

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearTimer();
    };
  }, []);

  const eligible =
    enabled &&
    options.hover_preview &&
    !active &&
    tab.kind === "file" &&
    typeof tab.path === "string" &&
    tab.path !== "";

  useEffect(() => {
    if (!eligible) {
      cancel();
    }
  }, [active, eligible, cancel, tab.id]);

  const onPointerEnter = useCallback(() => {
    if (!eligible || tab.path === undefined) return;
    clearTimer();
    hovering.current = true;
    const current = generation.current + 1;
    generation.current = current;
    const delay = Math.max(300, Math.min(2000, Math.trunc(options.hover_delay_ms)));
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void (async () => {
        if (!mounted.current || !hovering.current || generation.current !== current) return;
        let inspection: TabHoverInspection;
        try {
          inspection = await inspect(tab.path as string);
        } catch {
          return;
        }
        if (!mounted.current || !hovering.current || generation.current !== current) return;
        if (inspection.online_only) return;
        setPreviewPath(tab.path as string);
      })();
    }, delay);
  }, [eligible, inspect, options.hover_delay_ms, tab.id, tab.path]);

  const onPointerLeave = useCallback(() => {
    cancel();
  }, [cancel]);

  return {
    previewPath,
    previewOnly: true,
    autoplay: false,
    onPointerEnter,
    onPointerLeave,
    cancel,
  };
}
