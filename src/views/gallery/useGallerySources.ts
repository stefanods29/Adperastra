/** Add, remove and edit Gallery folders (Step 07c, decisions D2/D8/D9).
 *
 * A change is only reflected after the parent persisted it: a failed save
 * keeps the previous source list and shows the error. Removing a source only
 * changes the Gallery references; it never touches the folder or its files.
 * `useGallery` notices the new settings and closes the old scan, which
 * cancels its work and cursors. */

import { useCallback, useRef, useState } from "react";
import type { TFunction } from "i18next";
import {
  MAX_GALLERY_SOURCE_PATH_UTF16,
  galleryPathKey,
  isAbsoluteGalleryPath,
  newGallerySourceId,
  pickGallerySource,
  validateGallerySettings,
  type GalleryDateSource,
  type GallerySettings,
  type GallerySource,
} from "../../services/gallery";

export interface UseGallerySourcesOptions {
  settings: GallerySettings;
  /** Persists the whole section and rejects when saving failed. */
  onSettingsChange: (next: GallerySettings) => Promise<void>;
  /** Test seam; production opens the Windows folder picker. */
  pickSource?: () => Promise<string | null>;
  t: TFunction;
}

export interface GallerySourceActions {
  addSource: () => Promise<void>;
  removeSource: (id: string) => Promise<void>;
  setRecursive: (id: string, recursive: boolean) => Promise<void>;
  setDateSource: (dateSource: GalleryDateSource) => Promise<void>;
  busy: boolean;
  /** `gallery.*` code or a rejected promise. */
  error: unknown | null;
  clearError: () => void;
}

export function useGallerySources({
  settings,
  onSettingsChange,
  pickSource,
  t,
}: UseGallerySourcesOptions): GallerySourceActions {
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<unknown | null>(null);

  const persist = useCallback(
    async (next: GallerySettings): Promise<boolean> => {
      const code = validateGallerySettings(next);
      if (code) {
        setError(code);
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        await onSettingsChange(next);
        return true;
      } catch (failure) {
        setError(failure);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onSettingsChange],
  );

  const addSource = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
    const choose = pickSource ?? pickGallerySource;
    let chosen: string | null;
    try {
      chosen = await choose();
    } catch (failure) {
      setError(failure);
      return;
    }
    if (chosen === null) return;
    const path = chosen.trim();
    if (
      !isAbsoluteGalleryPath(path) ||
      path.length > MAX_GALLERY_SOURCE_PATH_UTF16
    ) {
      setError("gallery.bad_request");
      return;
    }
    const key = galleryPathKey(path);
    if (settings.sources.some((source) => galleryPathKey(source.path) === key)) {
      setError("gallery.bad_request");
      return;
    }
    const source: GallerySource = {
      id: newGallerySourceId(),
      path,
      recursive: true,
    };
    await persist({ ...settings, sources: [...settings.sources, source] });
    } finally { inFlight.current = false; setBusy(false); }
  }, [busy, persist, pickSource, settings, t]);

  const removeSource = useCallback(
    async (id: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
      const sources = settings.sources.filter((source) => source.id !== id);
      if (sources.length === settings.sources.length) return;
      await persist({ ...settings, sources });
      } finally { inFlight.current = false; }
    },
    [busy, persist, settings],
  );

  const setRecursive = useCallback(
    async (id: string, recursive: boolean) => {
      if (inFlight.current) return;
      inFlight.current = true;
      try {
      const sources = settings.sources.map((source) =>
        source.id === id ? { ...source, recursive } : source,
      );
      await persist({ ...settings, sources });
      } finally { inFlight.current = false; }
    },
    [busy, persist, settings],
  );

  const setDateSource = useCallback(
    async (dateSource: GalleryDateSource) => {
      if (inFlight.current || settings.date_source === dateSource) return;
      inFlight.current = true;
      try { await persist({ ...settings, date_source: dateSource }); }
      finally { inFlight.current = false; }
    },
    [busy, persist, settings],
  );

  return {
    addSource,
    removeSource,
    setRecursive,
    setDateSource,
    busy,
    error,
    clearError: () => setError(null),
  };
}
