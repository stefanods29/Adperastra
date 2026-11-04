import { useEffect, useState } from "react";
import { fileUrl } from "./files";
import { subscribeBackgroundEligible } from "./background";
import { errorCode } from "./errors";
import {
  isThumbnailFile,
  newThumbnailConsumerId,
  releaseThumbnail,
  requestThumbnail,
  type ThumbnailEdge,
  type ThumbnailState,
} from "./thumbnails";

/** What one thumbnail surface shows. `loading` keeps the file fallback
 * visible; no skeleton is drawn over the grid. */
export interface ThumbnailView {
  url: string | null;
  state: ThumbnailState | "loading";
}

/** Owns one consumer per mounted, active picture. A path or activity change
 * releases the previous consumer exactly once, and a late reply for an old
 * path can never replace the current one. */
export function useThumbnail(path: string, edge: ThumbnailEdge, active: boolean, sourceRevision?: object): ThumbnailView {
  const [view, setView] = useState<ThumbnailView>({ url: null, state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!active || !isThumbnailFile(path)) {
      setView({ url: null, state: "unsupported" });
      return;
    }
    let cancelled = false;
    let stopWaiting: (() => void) | undefined;
    const consumerId = newThumbnailConsumerId();
    setView({ url: null, state: "loading" });
    requestThumbnail({ path, edge, consumer_id: consumerId }, sourceRevision)
      .then((handle) => handle.completion)
      .then((reply) => {
        if (cancelled) return;
        if (reply.state === "ready" && reply.lease) {
          setView({
            url: fileUrl(reply.lease.token, reply.lease.name),
            state: "ready",
          });
        } else {
          setView({ url: null, state: reply.state });
          if (reply.state === "paused") {
            stopWaiting = subscribeBackgroundEligible(() => {
              if (!cancelled) setAttempt((value) => value + 1);
            });
          }
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setView({ url: null, state: "unsupported" });
          // Pausing an active helper cancels it before it can return a reply.
          if (["background.cancelled", "background.paused"].includes(errorCode(error))) {
            stopWaiting = subscribeBackgroundEligible(() => {
              if (!cancelled) setAttempt((value) => value + 1);
            });
          }
        }
      });
    return () => {
      cancelled = true;
      stopWaiting?.();
      void releaseThumbnail(consumerId);
    };
  }, [path, edge, active, sourceRevision, attempt]);

  return view;
}
