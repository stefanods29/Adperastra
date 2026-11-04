import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { FileIdentityKey } from "../services/fileIdentity";
import { getFolderDecorations, type FolderDecoration } from "../services/folderCustomization";
import { folderViewKey } from "../services/folderViews";
import { isTauriRuntime } from "../services/settings";
import { FolderDecorationResolver } from "./FolderDecorationResolver";

const MAX_PATHS = 256;
const EMPTY: ReadonlyMap<string, FolderDecoration> = new Map();

function createResolver(): FolderDecorationResolver {
  return new FolderDecorationResolver(getFolderDecorations);
}

/** One resolver per process. A profile switch must call
 * `disposeFolderDecorations` before the next catalog is readable. */
let resolver = createResolver();
let revision = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  revision += 1;
  for (const listener of [...listeners]) listener();
}

/** Catalog mutations and identity overflow clear every entry. The wire
 * decoration carries no identity, so inherited descendants and aliases cannot
 * be invalidated selectively from JavaScript. */
export function invalidateFolderDecorations(_keys: readonly FileIdentityKey[] = []): void {
  resolver.invalidateAll();
  notify();
}

export function disposeFolderDecorations(): void {
  resolver.dispose();
  resolver = createResolver();
  notify();
}

export function folderDecorationFor(
  decorations: ReadonlyMap<string, FolderDecoration>,
  path: string,
): FolderDecoration | undefined {
  return decorations.get(folderViewKey(path));
}

/** Resolves at most 256 folder paths per call through the shared cache. A
 * missing native adapter leaves the map empty; it never invents a look or
 * reads an image source path. */
export function useFolderDecorations(paths: readonly string[]): ReadonlyMap<string, FolderDecoration> {
  const pathsKey = useMemo(() => paths.join("\u0000"), [paths]);
  const current = useSyncExternalStore(subscribe, () => revision, () => revision);
  const [state, setState] = useState<{ key: string; map: ReadonlyMap<string, FolderDecoration> }>({
    key: "",
    map: EMPTY,
  });

  useEffect(() => {
    const unique = [...new Set(pathsKey.split("\u0000"))].filter((path) => path.length > 0).slice(0, MAX_PATHS);
    if (!unique.length || !isTauriRuntime()) {
      setState({ key: pathsKey, map: EMPTY });
      return;
    }
    let active = true;
    resolver
      .resolve(unique)
      .then((values) => {
        if (!active) return;
        const map = new Map<string, FolderDecoration>();
        values.forEach((value, index) => map.set(folderViewKey(unique[index]), value));
        setState({ key: pathsKey, map });
      })
      .catch(() => {
        // A stale generation is retried by the next notification; an
        // unavailable catalog stays empty instead of keeping a stale look.
        if (active) setState({ key: pathsKey, map: EMPTY });
      });
    return () => {
      active = false;
    };
  }, [pathsKey, current]);

  return state.key === pathsKey ? state.map : EMPTY;
}

function readSurfaceColors(): { paneColor: string; textColor: string } {
  if (typeof window === "undefined") return { paneColor: "#FFFFFF", textColor: "#000000" };
  const styles = getComputedStyle(document.documentElement);
  return {
    paneColor: styles.getPropertyValue("--adp-color-surface-pane").trim() || "#FFFFFF",
    textColor: styles.getPropertyValue("--adp-color-text-primary").trim() || "#000000",
  };
}

/** The opaque tokens the background compositor needs. Re-read when the theme
 * attributes change; no timer or polling loop. */
export function useFolderSurfaceColors(): { paneColor: string; textColor: string } {
  const [colors, setColors] = useState(readSurfaceColors);
  useEffect(() => {
    const update = () => setColors(readSurfaceColors());
    update();
    if (typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-scheme"] });
    return () => observer.disconnect();
  }, []);
  return colors;
}

export function useFolderDecoration(path: string | null | undefined): FolderDecoration | undefined {
  const paths = useMemo(() => (path ? [path] : []), [path]);
  const decorations = useFolderDecorations(paths);
  return path ? folderDecorationFor(decorations, path) : undefined;
}
