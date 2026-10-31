import { invoke } from "@tauri-apps/api/core";
import type { OpProgress } from "./fileops";
import { isTauriRuntime } from "./settings";

/** Shared jobs (Step 06d): start a Rust job, poll it every 100 ms, cancel it. */

/** How often a running job is asked how far it got. */
export const POLL_INTERVAL_MS = 100;

/** Mirrors Rust `jobs::JobPoll`. */
interface JobPoll {
  progress: OpProgress;
  done: boolean;
  result: unknown;
  error: string | null;
}

/** A running job: its id, a way to stop it, and its result. */
export interface JobHandle<T> {
  id: string;
  cancel: () => Promise<void>;
  completion: Promise<T>;
}

let requestCounter = 0;

/** A request id Rust accepts: 1 to 12 lower-case ASCII letters, a dash, the
 * time in base 36, a dash and a counter (always under 64 characters). */
export function newRequestId(prefix: string): string {
  if (!/^[a-z]{1,12}$/.test(prefix)) throw new Error("jobs.bad_prefix");
  requestCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${requestCounter}`;
}

/** Start a job through `start`, then poll it until it is done. Rejects with
 * the job's error code (`archive.corrupt`, ...) or `jobs.unavailable`. */
export async function runJob<T>(
  prefix: string,
  start: (requestId: string) => Promise<void>,
  onProgress?: (progress: OpProgress) => void,
): Promise<JobHandle<T>> {
  if (!isTauriRuntime()) throw new Error("jobs.unavailable");
  const id = newRequestId(prefix);
  await start(id);
  let cancelSent = false;
  const cancel = async () => {
    if (cancelSent) return;
    cancelSent = true;
    try {
      await invoke("job_cancel", { requestId: id });
    } catch {
      // The job may have finished a moment ago.
    }
  };
  const completion = (async (): Promise<T> => {
    for (;;) {
      const poll = (await invoke("job_poll", { requestId: id })) as JobPoll;
      onProgress?.(poll.progress);
      if (poll.error) throw new Error(poll.error);
      if (poll.done) return poll.result as T;
      await new Promise<void>((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
    }
  })();
  return { id, cancel, completion };
}
