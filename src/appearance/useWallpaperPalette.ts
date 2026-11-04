/** Opt-in wallpaper colour loading (Step 10a).
 *
 * The palette is read once when the surface opens. Further reads happen only
 * while "Always follow wallpaper" is on and the app is eligible; they are
 * debounced to one second. Turning the option off stops every listener.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  wallpaperPalette,
  type WallpaperPalette,
} from "../services/customThemes";
import { shouldAutoReadWallpaper } from "./themeMath";

export const WALLPAPER_CHANGED_EVENT = "adp-wallpaper-changed";

export interface WallpaperPaletteState {
  palette: WallpaperPalette | null;
  loading: boolean;
  reload: () => Promise<void>;
}

export function useWallpaperPalette(
  followWallpaper: boolean,
  load: () => Promise<WallpaperPalette> = wallpaperPalette,
  debounceMs = 1000,
): WallpaperPaletteState {
  const [palette, setPalette] = useState<WallpaperPalette | null>(null);
  const [loading, setLoading] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    try {
      const next = await loadRef.current();
      if (current === generation.current) setPalette(next);
    } catch {
      if (current === generation.current) {
        setPalette({ colors: [], available: false, reason: "theme.wallpaper_unavailable" });
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    return () => {
      generation.current += 1;
    };
  }, [reload]);

  useEffect(() => {
    if (!shouldAutoReadWallpaper(followWallpaper, true)) return;
    let timer: number | null = null;
    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        void reload();
      }, debounceMs);
    };
    const onFocus = () => schedule();
    window.addEventListener(WALLPAPER_CHANGED_EVENT, schedule);
    window.addEventListener("focus", onFocus);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener(WALLPAPER_CHANGED_EVENT, schedule);
      window.removeEventListener("focus", onFocus);
    };
  }, [followWallpaper, debounceMs, reload]);

  return { palette, loading, reload };
}
