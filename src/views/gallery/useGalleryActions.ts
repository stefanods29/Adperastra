/** Opening, quick preview and one-picture details for the Gallery
 * (Step 07c, decisions D2/D7; uses U2/U3/U7).
 *
 * The Gallery never invents its own open path: `onOpenFile` is the Explorer's
 * normal pipeline (detection, grants, protected view, Windows fallback), and
 * the quick preview is the read-only 07b dialog. Details ask the 07b metadata
 * service for one picture and never block the grid. */

import { useCallback, useEffect, useRef, useState } from "react";
import { newRequestId } from "../../services/jobs";
import type { ExplorerItem } from "../../services/explorer";
import { newGallerySourceId, type GalleryItem } from "../../services/gallery";
import { readMetadata, releaseMetadata, type MetadataInfo } from "../../services/metadata";

/** What the read-only quick preview needs; `origin` is never serialized. */
export interface GalleryPreviewSelection {
  items: readonly ExplorerItem[];
  path: string;
  origin: HTMLElement | null;
  originList?: HTMLElement | null;
}

export interface GalleryActions {
  open: (item: GalleryItem, background?: boolean) => Promise<void>;
  preview: (item: GalleryItem, origin: HTMLElement | null) => void;
  closePreview: () => void;
  openFromPreview: (path: string) => Promise<void>;
  previewSelection: GalleryPreviewSelection | null;
  openError: unknown | null;
  clearOpenError: () => void;
}

export interface UseGalleryActionsOptions {
  /** Current display order, so Left/Right in the preview follows the grid. */
  order: readonly GalleryItem[];
  onOpenFile: (path: string, background: boolean) => Promise<void>;
}

export function useGalleryActions({
  order,
  onOpenFile,
}: UseGalleryActionsOptions): GalleryActions {
  const [previewSelection, setPreviewSelection] =
    useState<GalleryPreviewSelection | null>(null);
  const [openError, setOpenError] = useState<unknown | null>(null);

  const open = useCallback(
    async (item: GalleryItem, background = false) => {
      setOpenError(null);
      try {
        await onOpenFile(item.item.path, background);
      } catch (error) {
        setOpenError(error);
      }
    },
    [onOpenFile],
  );

  const preview = useCallback(
    (item: GalleryItem, origin: HTMLElement | null) => {
      setPreviewSelection({
        items: order.map((entry) => entry.item),
        path: item.item.path,
        origin,
        originList: origin?.closest("[role=listbox]") as HTMLElement | null,
      });
    },
    [order],
  );

  const closePreview = useCallback(() => setPreviewSelection(null), []);

  const openFromPreview = useCallback(
    async (path: string) => {
      setPreviewSelection(null);
      setOpenError(null);
      try {
        await onOpenFile(path, false);
      } catch (error) {
        setOpenError(error);
      }
    },
    [onOpenFile],
  );

  return {
    open,
    preview,
    closePreview,
    openFromPreview,
    previewSelection,
    openError,
    clearOpenError: () => setOpenError(null),
  };
}

/** The few details shown under one selected picture. Listing facts already
 * exist; a metadata failure simply leaves these fields empty. */
export interface GalleryPictureFacts {
  width: number | null;
  height: number | null;
  dateTaken: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
}

/** Debounce from selection to a metadata request (07b decision D6). */
export const GALLERY_DETAILS_DEBOUNCE_MS = 150;

function factsFrom(info: MetadataInfo): GalleryPictureFacts {
  const value = (id: string) => info.fields.find((field) => field.id === id)?.value ?? null;
  const integer = (id: string): number | null => {
    const entry = value(id);
    return entry && entry.kind === "integer" ? entry.value : null;
  };
  const text = (id: string): string | null => {
    const entry = value(id);
    return entry && entry.kind === "text" ? entry.value : null;
  };
  const date = (id: string): string | null => {
    const entry = value(id);
    return entry && entry.kind === "date" ? entry.value : null;
  };
  return {
    width: integer("width"),
    height: integer("height"),
    dateTaken: date("date_taken"),
    cameraMake: text("camera_make"),
    cameraModel: text("camera_model"),
  };
}

/** Reads the fixed metadata allowlist for one local picture. Online-only
 * items are never read; the cloud state is shown instead. */
export function usePictureDetails(item: GalleryItem | null, active = true): GalleryPictureFacts | null {
  const [facts, setFacts] = useState<GalleryPictureFacts | null>(null);
  const request = useRef(0);
  const latest = useRef(item);
  latest.current = item;
  const itemKey = item
    ? `${item.identity}\u0000${item.item.path}\u0000${item.item.online_only}`
    : "";

  useEffect(() => {
    const currentItem = latest.current;
    request.current += 1;
    const id = request.current;
    setFacts(null);
    if (!active || !currentItem || currentItem.item.online_only) return;
    const consumerId = newGallerySourceId();
    let cancelled = false;
    let cancelJob: (() => Promise<void>) | null = null;
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const job = await readMetadata(newRequestId("gallerymeta"), {
            path: currentItem.item.path,
            consumer_id: consumerId,
          });
          const completion = job.completion.catch(() => null);
          if (cancelled || id !== request.current) await job.cancel().catch(() => undefined);
          cancelJob = job.cancel;
          const info = await completion;
          if (info && !cancelled && id === request.current) setFacts(factsFrom(info));
        } catch {
          // No rich details; the listing facts stay usable.
        } finally {
          try {
            await releaseMetadata(consumerId);
          } catch {
            // Already released.
          }
        }
      })();
    }, GALLERY_DETAILS_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (cancelJob) void cancelJob().catch(() => undefined);
      void releaseMetadata(consumerId).catch(() => undefined);
    };
  }, [itemKey, item?.item, active]);

  return facts;
}
