import type { OpProgress, SkippedItem } from "../../services/fileops";

/** The shapes a tracked job has (Step 06d T10), kept in their own file so
 * the panel's `.tsx` stays free of generic signatures. The panel re-exports
 * them. */

/** Which area's error texts a skipped item's reason comes from. */
export type JobReasonArea = "ops" | "archive" | "convert";

/** One job the panel shows, as the caller describes it. */
export interface TrackJobOptions<T> {
  /** i18n verb key under `jobs`. */
  verbKey: string;
  count: number;
  reasonArea?: JobReasonArea;
  start: (
    onProgress: (progress: OpProgress) => void,
  ) => Promise<{
    cancel: () => Promise<void>;
    completion: Promise<T>;
    /** Present when the job has a window of its own (transfers). */
    open?: () => void;
  }>;
  outcome: (result: T) => { cancelled: boolean; skipped: SkippedItem[] };
}

/** Runs one job in the panel and resolves with its result. */
export type TrackJob = <T>(options: TrackJobOptions<T>) => Promise<T>;
