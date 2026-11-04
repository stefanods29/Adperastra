import { useCallback, useEffect, useRef, useState } from "react";
import {
  collectReportPages,
  startConversion,
} from "../services/convert";
import { errorCode } from "../services/errors";
import type { OpProgress } from "../services/fileops";
import type { JobHandle } from "../services/jobs";
import type { JobReasonArea } from "../views/explorer/JobsPanel";
import type { ConversionEnvironment } from "./ConversionContext";
import { inputLabel, retryInputs } from "./convertOptions";
import type {
  ConversionInput,
  ConversionReport,
  ConversionRequest,
  WorkItemStatus,
} from "./types";

/** One batch conversion at a time in the dialog (Step 08a T6). The shared
 * jobs panel still owns progress, Cancel and skipped-item reporting. */

export type QueueStatus = "idle" | "running" | "done" | "cancelled" | "failed";

export interface QueueItemState {
  index: number;
  status: WorkItemStatus | "pending" | "running";
  reason?: string;
  outputs: number;
}

export interface QueueState {
  status: QueueStatus;
  items: QueueItemState[];
  report: ConversionReport | null;
  error: string;
  progress: OpProgress | null;
}

export interface ConversionQueue {
  state: QueueState;
  start: (request: ConversionRequest) => Promise<void>;
  cancel: () => Promise<void>;
  retry: () => Promise<void>;
  canRetry: boolean;
}

// Conversion failures share the central job panel and translated reason area.
const CONVERT_AREA = "convert" satisfies JobReasonArea;

function mergePages(pages: ConversionReport[]): ConversionReport {
  const first = pages[0];
  return {
    ...first,
    items: pages.flatMap((page) => page.items),
    outputs: pages.flatMap((page) => page.outputs),
    created_paths: pages.flatMap((page) => page.created_paths),
    next_cursor: undefined,
    complete: true,
  };
}

function pendingItems(inputs: readonly ConversionInput[]): QueueItemState[] {
  return inputs.map((input, index) => ({
    index,
    status: "pending" as const,
    outputs: 0,
    reason: undefined,
  }));
}

export function useConversionQueue(
  environment: ConversionEnvironment,
  onCompleted?: (report: ConversionReport) => void,
): ConversionQueue {
  const [state, setState] = useState<QueueState>({
    status: "idle",
    items: [],
    report: null,
    error: "",
    progress: null,
  });
  const job = useRef<JobHandle<ConversionReport> | null>(null);
  const lastRequest = useRef<ConversionRequest | null>(null);
  const merged = useRef<ConversionReport | null>(null);

  const run = useCallback(
    async (request: ConversionRequest) => {
      lastRequest.current = request;
      merged.current = null;
      setState({
        status: "running",
        items: pendingItems(request.inputs),
        report: null,
        error: "",
        progress: null,
      });
      try {
        const report = await environment.trackJob<ConversionReport>({
          verbKey: "converting",
          count: request.inputs.length,
          reasonArea: CONVERT_AREA,
          start: async (onProgress) => {
            const handle = await startConversion(request, onProgress);
            job.current = handle;
            return handle;
          },
          outcome: (result) => ({
            cancelled: result.cancelled,
            skipped: result.items
              .filter((item) => item.status === "failed" || item.status === "skipped")
              .map((item) => {
                const input =
                  request.inputs[item.input_index] ?? request.inputs[0];
                return {
                  path: item.source_path ?? (input ? inputLabel(input) : ""),
                  reason: item.reason ?? "other",
                };
              }),
          }),
        });
        const pages = report.next_cursor ? await collectReportPages(report) : [report];
        const all = mergePages(pages);
        merged.current = all;
        setState({
          status: all.cancelled ? "cancelled" : "done",
          items: all.items.map((item) => ({
            index: item.input_index,
            status: item.status,
            reason: item.reason,
            outputs: item.output_count,
          })),
          report: all,
          error: "",
          progress: null,
        });
        onCompleted?.(report);
      } catch (error) {
        setState((current) => ({
          ...current,
          status: "failed",
          error: errorCode(error) || "convert.io",
        }));
        environment.notifyError(error, "convert");
      } finally {
        job.current = null;
      }
    },
    [environment, onCompleted],
  );

  const start = useCallback(
    async (request: ConversionRequest) => {
      if (job.current) return;
      await run(request);
    },
    [run],
  );

  const cancel = useCallback(async () => {
    await job.current?.cancel();
  }, []);

  const retry = useCallback(async () => {
    const request = lastRequest.current;
    const report = merged.current;
    if (!request || !report || state.status === "running") return;
    const inputs = retryInputs(report, request.inputs);
    if (inputs.length === 0) return;
    await run({
      ...request,
      inputs,
      request_revision: request.request_revision + 1,
    });
  }, [run, state.status]);

  useEffect(() => {
    return () => {
      void job.current?.cancel();
    };
  }, []);

  const canRetry =
    state.status !== "running" &&
    !!merged.current &&
    retryInputs(merged.current, lastRequest.current?.inputs ?? []).length > 0;

  return { state, start, cancel, retry, canRetry };
}
