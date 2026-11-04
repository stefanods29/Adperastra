import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatSize } from "../../services/format";
import {
  createFolderSizeBatcher,
  onFolderSize,
  releaseFolderSize,
  requestFolderSize,
  type FolderSizeDisplayState,
  type FolderSizeValue,
} from "../../services/folderSizes";

/** Optional background folder sizes for the visible Details rows and the
 * Details pane (Step 11c T6/U2/U3/E4/E5). One consumer per path; a hidden
 * view or a disabled setting releases them, and the final release lets the
 * native scheduler cancel queued work. Values arrive in 100 ms batches and
 * never touch selection, focus anchor or scroll position. */

export interface FolderSizesOptions {
  /** Views hidden behind another tab release their consumers. */
  active: boolean;
  enabled: boolean;
  /** Network opt-in: changing it asks every folder again. */
  network: boolean;
  /** Show the Details pane's folder even when nothing is selected. */
  details: boolean;
  /** Folder rows in the current listing. */
  folders: readonly string[];
  /** The one folder the Details pane shows, when the setting asks for it. */
  detailsFolders: readonly string[];
}

export interface FolderSizesView {
  values: ReadonlyMap<string, FolderSizeValue>;
  valueFor: (path: string) => FolderSizeValue | null;
  textFor: (path: string) => string | null;
  enabled: boolean;
}

type DisplayState = FolderSizeDisplayState<null, null>;

function keyOf(path: string): string {
  return path.toLowerCase();
}

export function useFolderSizes(options: FolderSizesOptions): FolderSizesView {
  const { t, i18n } = useTranslation();
  const valuesRef = useRef<ReadonlyMap<string, FolderSizeValue>>(new Map());
  const consumersRef = useRef(new Map<string, string>());
  const lastPolicyRef = useRef("");
  const mountedRef = useRef(true);
  const [values, setValues] = useState<ReadonlyMap<string, FolderSizeValue>>(
    valuesRef.current,
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const batcher = useMemo(
    () =>
      createFolderSizeBatcher<null, null>(
        () => ({
          values: valuesRef.current,
          selection: null,
          anchor: null,
          scrollTop: 0,
        }),
        (next: DisplayState) => {
          valuesRef.current = next.values;
          if (mountedRef.current) setValues(next.values);
        },
      ),
    [],
  );
  useEffect(() => () => batcher.dispose(), [batcher]);

  const wanted = useMemo(() => {
    if (!options.enabled) return [];
    const paths = new Set<string>();
    for (const path of options.folders) paths.add(path);
    if (options.details) {
      for (const path of options.detailsFolders) paths.add(path);
    }
    return [...paths];
  }, [options.details, options.detailsFolders, options.enabled, options.folders]);
  const wantedKey = useMemo(
    () => wanted.map(keyOf).sort().join("\n"),
    [wanted],
  );

  // Completed values arrive as one shared event stream.
  useEffect(() => {
    if (!options.enabled || !options.active) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void onFolderSize((value) => batcher.push(value))
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [batcher, options.active, options.enabled]);

  // One consumer per wanted folder; released when the folder, the setting
  // or the visibility changes.
  useEffect(() => {
    const consumers = consumersRef.current;
    // A changed opt-in (network) invalidates earlier refusals, so every
    // wanted folder gets a fresh consumer.
    const policy = `${options.enabled}:${options.active}:${options.network}`;
    if (lastPolicyRef.current !== policy) {
      lastPolicyRef.current = policy;
      for (const id of consumers.values()) {
        void releaseFolderSize(id).catch(() => undefined);
      }
      consumers.clear();
    }
    if (!options.enabled || !options.active) {
      for (const id of consumers.values()) {
        void releaseFolderSize(id).catch(() => undefined);
      }
      consumers.clear();
      return;
    }
    const wantedSet = new Set(wantedKey === "" ? [] : wantedKey.split("\n"));
    for (const [path, id] of [...consumers]) {
      if (!wantedSet.has(path)) {
        consumers.delete(path);
        void releaseFolderSize(id).catch(() => undefined);
      }
    }
    for (const path of wanted) {
      const key = keyOf(path);
      if (consumers.has(key)) continue;
      const consumerId = globalThis.crypto.randomUUID();
      consumers.set(key, consumerId);
      void requestFolderSize({
        consumer_id: consumerId,
        path,
        priority: "visible",
      })
        .then((value) => {
          if (consumers.get(key) !== consumerId) return;
          valuesRef.current = new Map(valuesRef.current).set(key, value);
          if (mountedRef.current) setValues(valuesRef.current);
        })
        .catch(() => {
          // A refused request leaves the row blank, never "calculating"
          // forever; the next listing or settings change asks again.
          if (consumers.get(key) === consumerId) consumers.delete(key);
        });
    }
  }, [options.active, options.enabled, options.network, wanted, wantedKey]);

  // Leaving the Explorer releases every consumer, including a queued walk.
  useEffect(
    () => () => {
      for (const id of consumersRef.current.values()) {
        void releaseFolderSize(id).catch(() => undefined);
      }
      consumersRef.current.clear();
    },
    [],
  );

  const valueFor = useCallback(
    (path: string) => values.get(keyOf(path)) ?? null,
    [values],
  );
  const textFor = useCallback(
    (path: string): string | null => {
      if (!options.enabled) return null;
      const value = values.get(keyOf(path));
      if (!value) {
        // A path nobody asked about (Home, another folder's details) stays
        // blank instead of pretending a walk is running.
        return consumersRef.current.has(keyOf(path))
          ? t("folderSizes.calculating")
          : null;
      }
      if (value.state === "ready" && typeof value.logical_bytes === "number") {
        return formatSize(value.logical_bytes, i18n.language);
      }
      if (value.state === "partial" && typeof value.logical_bytes === "number") {
        return t("folderSizes.atLeast", {
          size: formatSize(value.logical_bytes, i18n.language),
        });
      }
      if (value.state === "unavailable") {
        if (value.reason_code === "folder_size.network_disabled") {
          return t("folderSizes.networkOff");
        }
        if (value.reason_code === "folder_size.disabled") {
          return t("folderSizes.disabled");
        }
        return t("folderSizes.unavailable");
      }
      return t("folderSizes.calculating");
    },
    [i18n.language, options.enabled, t, values],
  );

  return useMemo(
    () => ({ values, valueFor, textFor, enabled: options.enabled }),
    [options.enabled, textFor, valueFor, values],
  );
}
