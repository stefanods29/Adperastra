/**
 * Bounded assistant action log (Step 17a T5/D12).
 *
 * 200 entries / 2 MiB, stable operation/status codes and actual outcomes.
 * A cancelled or partial batch is recorded as such; nothing is labelled done
 * without the producer's actual result. No source content, raw path or
 * credential is retained.
 */

import type { AssistantActionResult } from "./types";

export const MAX_ACTION_ENTRIES = 200;
export const MAX_ACTION_LOG_BYTES = 2 * 1024 * 1024;

export type AssistantActionStatus = "completed" | "partial" | "cancelled" | "failed" | "unavailable";

export interface AssistantActionLogEntry {
  draft_id: string;
  operation_key: string;
  status: AssistantActionStatus;
  actual_count: number;
  output_labels: string[];
  undo_entry_id: string | null;
  error_code: string | null;
  at_unix: number;
}

function byteLength(entry: AssistantActionLogEntry): number {
  return new TextEncoder().encode(JSON.stringify(entry)).length;
}

export class AssistantActionHistory {
  private entries: AssistantActionLogEntry[] = [];

  record(result: AssistantActionResult, operationKey: string, nowUnix: number): AssistantActionLogEntry {
    const entry: AssistantActionLogEntry = {
      draft_id: result.draft_id,
      operation_key: operationKey,
      status: result.state,
      actual_count: result.actual_input_ids.length,
      output_labels: result.output_labels.slice(0, 100),
      undo_entry_id: result.undo_entry_id,
      error_code: result.error_code,
      at_unix: nowUnix,
    };
    this.entries.push(entry);
    while (
      this.entries.length > MAX_ACTION_ENTRIES ||
      this.entries.reduce((sum, item) => sum + byteLength(item), 0) > MAX_ACTION_LOG_BYTES
    ) {
      this.entries.shift();
    }
    return entry;
  }

  list(): readonly AssistantActionLogEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}

/** A toast must not claim success when the producer reported partial work. */
export function actionToastKey(status: AssistantActionStatus): string {
  if (status === "completed") return "assistant.actionDone";
  if (status === "partial") return "assistant.partial";
  if (status === "unavailable") return "assistant.unavailable";
  if (status === "cancelled") return "assistant.cancelled";
  return "errors.assistant.failed";
}
