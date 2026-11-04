import { useEffect, useState } from "react";
import { shelfDropPaths } from "./shelfValidation";

/** External file drops on the shelf (Step 09g T4).
 *
 * The Tauri window enables native drag/drop for files from other apps
 * (`dragDropEnabled: true`), so HTML5 drop events are not used
 * (plan/pitfalls.md P-18). The hook listens to the webview's drag/drop
 * events, checks that the pointer is over an element with
 * `data-shelf-drop`, and adds only the validated absolute paths. */

export interface ShelfDropState {
  dropActive: boolean;
}

export function useShelfDrop(
  active: boolean,
  onAdd: (paths: readonly string[]) => Promise<void>,
): ShelfDropState {
  const [dropActive, setDropActive] = useState(false);

  useEffect(() => {
    if (!active) {
      setDropActive(false);
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const overShelf = (position: { x: number; y: number }): boolean => {
      const scale = window.devicePixelRatio || 1;
      const element = document.elementFromPoint(position.x / scale, position.y / scale);
      return !!element?.closest?.("[data-shelf-drop]");
    };
    void import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((event) => {
          if (disposed) return;
          const payload = event.payload;
          if (payload.type === "leave") {
            setDropActive(false);
            return;
          }
          if (payload.type === "enter" || payload.type === "over") {
            setDropActive(overShelf(payload.position));
            return;
          }
          if (payload.type === "drop") {
            const over = overShelf(payload.position);
            setDropActive(false);
            if (!over) return;
            try {
              const paths = shelfDropPaths(payload.paths);
              if (paths.length > 0) void onAdd(paths);
            } catch {
              // Invalid drop data is ignored; the shelf does not change.
            }
          }
        }),
      )
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => {
        // The browser preview has no native drag/drop listener.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [active, onAdd]);

  return { dropActive };
}
