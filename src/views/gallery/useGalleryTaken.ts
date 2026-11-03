/** Optional taken dates for actual visible local rows, with owned cancellation. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { GalleryItem } from "../../services/gallery";
import { newGallerySourceId } from "../../services/gallery";
import { newRequestId } from "../../services/jobs";
import { readMetadata, releaseMetadata } from "../../services/metadata";

interface Options {
  items: readonly GalleryItem[];
  active: boolean;
  generation: string | null;
  metadata?: (path: string) => Promise<string | null>;
}
export function useGalleryTaken({ items, active, generation, metadata }: Options) {
  const [values, setValues] = useState<ReadonlyMap<string, string>>(new Map());
  const requested = useRef(new WeakSet<object>());
  const previousGeneration = useRef(generation);
  useEffect(() => {
    if (previousGeneration.current === generation) return;
    previousGeneration.current = generation;
    requested.current = new WeakSet();
    setValues(new Map());
  }, [generation]);
  useEffect(() => {
    if (!active || !generation) return;
    const pending = items.filter(item => !item.item.online_only && !requested.current.has(item.item)).slice(0, 24);
    if (pending.length === 0) return;
    let cancelled = false;
    let currentConsumer: string | null = null;
    let cancelJob: (() => Promise<void>) | null = null;
    void (async () => {
      for (const item of pending) {
        if (cancelled) break;
        requested.current.add(item.item);
        let date: string | null = null;
        try {
          if (metadata) date = await metadata(item.item.path);
          else {
            currentConsumer = newGallerySourceId();
            const handle = await readMetadata(newRequestId("gallerymeta"), {
              path: item.item.path, consumer_id: currentConsumer,
            });
            cancelJob = handle.cancel;
            // Attach rejection handling before cancellation can settle the job.
            const completion = handle.completion.catch(() => null);
            if (cancelled) await handle.cancel().catch(() => undefined);
            const info = await completion;
            const field = info?.fields.find(field => field.id === "date_taken");
            if (field?.value.kind === "date") date = field.value.value;
          }
          if (!cancelled && date && Number.isFinite(Date.parse(date))) {
            setValues(previous => new Map(previous).set(item.identity, date!));
          }
        } catch {
          // Missing metadata keeps the listing's modification date.
        } finally {
          if (currentConsumer) await releaseMetadata(currentConsumer).catch(() => undefined);
          currentConsumer = null; cancelJob = null;
        }
      }
    })();
    return () => {
      cancelled = true;
      if (cancelJob) void cancelJob().catch(() => undefined);
      if (currentConsumer) void releaseMetadata(currentConsumer).catch(() => undefined);
    };
  }, [active, generation, items, metadata]);
  const lookup = useCallback((item: GalleryItem) => values.get(item.identity) ?? null, [values]);
  return { values, lookup };
}
