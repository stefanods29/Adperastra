import { useCallback, useEffect, useRef, useState } from "react";
import {
  controlTransfer,
  decideTransfer,
  getTransferState,
  type TransferControl,
  type TransferDecision,
  type TransferState,
} from "../services/transferJobs";

/** The window polls a visible transfer this often. */
export const VISIBLE_POLL_MS = 100;
/** ...and this often when it is in the background. */
export const BACKGROUND_POLL_MS = 1000;

export interface UseTransferStateOptions {
  /** False while the window is behind another one. */
  visible?: boolean;
  /** Overrides the interval (tests use a short one). */
  intervalMs?: number;
}

export interface UseTransferStateResult {
  state: TransferState | null;
  /** The last refusal, as a stable code (`ops.changed`, ...). */
  error: string | null;
  /** Pause / Resume / Skip file / Cancel. */
  control: (action: TransferControl["action"]) => Promise<void>;
  /** Answer the question that is open right now. */
  decide: (decision: Omit<TransferDecision, "generation">) => Promise<void>;
}

/**
 * Follow one job.
 *
 * Closing the window only stops the polling: the job keeps running in Rust,
 * and opening the window again shows it where it is. Nothing here cancels.
 */
export function useTransferState(
  jobId: string,
  options: UseTransferStateOptions = {},
): UseTransferStateResult {
  const [state, setState] = useState<TransferState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(-1);
  const interval = options.intervalMs
    ? options.intervalMs
    : options.visible === false
      ? BACKGROUND_POLL_MS
      : VISIBLE_POLL_MS;

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    generation.current = -1;
    const tick = async () => {
      try {
        const next = await getTransferState(jobId);
        if (stopped) return;
        // A reply that overtook a newer one never wins.
        if (next.generation < generation.current) return;
        generation.current = next.generation;
        setState(next);
        setError(null);
        if (next.state === "done") return;
      } catch (reason) {
        if (stopped) return;
        setError(typeof reason === "string" ? reason : "ops.io");
      }
      timer = window.setTimeout(tick, interval);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [jobId, interval]);

  const control = useCallback(
    async (action: TransferControl["action"]) => {
      const current = state?.generation ?? 0;
      try {
        const next = await controlTransfer(jobId, {
          action,
          expected_generation: current,
        });
        if (next.generation >= generation.current) {
          generation.current = next.generation;
          setState(next);
          setError(null);
        }
      } catch (reason) {
        setError(typeof reason === "string" ? reason : "ops.io");
      }
    },
    [jobId, state?.generation],
  );

  const decide = useCallback(
    async (decision: Omit<TransferDecision, "generation">) => {
      const current = state?.generation ?? 0;
      try {
        const next = await decideTransfer(jobId, { ...decision, generation: current });
        if (next.generation >= generation.current) {
          generation.current = next.generation;
          setState(next);
          setError(null);
        }
      } catch (reason) {
        // A stale answer is not a failure of the transfer: refetch and let
        // the window show the current question. The rejection still reaches
        // the dialog so it can show the reason and re-enable its buttons.
        setError(typeof reason === "string" ? reason : "ops.io");
        const fresh = await getTransferState(jobId);
        if (fresh.generation >= generation.current) {
          generation.current = fresh.generation;
          setState(fresh);
        }
        throw reason;
      }
    },
    [jobId, state?.generation],
  );

  return { state, error, control, decide };
}
