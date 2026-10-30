import { useEffect, useState } from "react";
import {
  FOLDER_VIEWS_CLEARED_EVENT,
  folderViewKey,
  folderViewMap,
  getFolderViews,
  setFolderView,
} from "../../../services/folderViews";
import type { ExplorerViewSettings, ViewModeId } from "../../../services/settings";
import { effectiveViewMode, visibleViewModes, zoomTarget } from "./viewModes";

/** The view a folder shows and the ways to change it (Step 05a D7). */
export interface ViewModeState {
  mode: ViewModeId;
  visibleModes: ViewModeId[];
  setMode: (mode: ViewModeId) => void;
  zoomStep: (direction: 1 | -1) => void;
}

interface UseViewModeOptions {
  view: ExplorerViewSettings;
  onViewChange?: (patch: Partial<ExplorerViewSettings>) => void;
  folderPath: string | null;
}

/** The folder's own view when it has one, else the default view; choosing
 * a view remembers it for the folder unless remembering is off. */
export function useViewMode({ view, onViewChange, folderPath }: UseViewModeOptions): ViewModeState {
  const [folderModes, setFolderModes] = useState<Map<string, ViewModeId>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    getFolderViews()
      .then((entries) => {
        if (!cancelled) setFolderModes(folderViewMap(entries));
      })
      .catch(() => undefined);
    const onCleared = () => setFolderModes(new Map());
    window.addEventListener(FOLDER_VIEWS_CLEARED_EVENT, onCleared);
    return () => {
      cancelled = true;
      window.removeEventListener(FOLDER_VIEWS_CLEARED_EVENT, onCleared);
    };
  }, []);

  const visibleModes = visibleViewModes(view);
  const folderMode = folderPath !== null ? folderModes.get(folderViewKey(folderPath)) : undefined;
  const mode = effectiveViewMode(view, folderMode);

  const setMode = (next: ViewModeId) => {
    if (!visibleModes.includes(next)) return;
    if (folderPath !== null && view.remember_view_per_folder) {
      const key = folderViewKey(folderPath);
      setFolderModes((current) => {
        const map = new Map(current);
        map.set(key, next);
        return map;
      });
      // Failing to remember never shows an error: the view still changes.
      void setFolderView(folderPath, next).catch(() => undefined);
      return;
    }
    onViewChange?.({ view_mode: next });
  };

  const zoomStep = (direction: 1 | -1) => {
    const target = zoomTarget(mode, direction, visibleModes);
    if (target !== null) setMode(target);
  };

  return { mode, visibleModes, setMode, zoomStep };
}
