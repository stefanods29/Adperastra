import { invoke } from "@tauri-apps/api/core";
import type { OpProgress } from "./fileops";
import { runJob, type JobHandle } from "./jobs";
import type { TextEncodingId } from "./tableView";

/** JSON trees (Step 06f): open a file, read pages of children, search and
 * copy. Mirrors src-tauri/src/data_views.rs and crates/data-views/json.rs. */

export type JsonKind = "object" | "array" | "string" | "number" | "bool" | "null";

/** Mirrors Rust `JsonNodeInfo`. */
export interface JsonNodeInfo {
  id: number;
  key: string | null;
  index: number | null;
  kind: JsonKind;
  preview: string;
  preview_cut: boolean;
  child_count: number;
}

/** Mirrors Rust `JsonMatch`. */
export interface JsonMatch {
  id: number;
  /** The containers around the match, root first. */
  ancestors: number[];
}

/** Mirrors Rust `JsonSummary`. */
export interface JsonSummary {
  session: string;
  nodes: number;
  encoding: TextEncodingId;
  root: JsonNodeInfo;
}

/** A JSON file with an error, with the place it was found. */
export interface JsonInvalidError extends Error {
  line: number;
  column: number;
}

/** Rust reports `data.invalid:<line>:<column>`; the view needs the numbers. */
export function splitInvalidError(error: unknown): unknown {
  const code = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  if (!code.startsWith("data.invalid:")) return error;
  const [, line, column] = code.split(":");
  const next = new Error("data.invalid") as JsonInvalidError;
  next.line = Number(line);
  next.column = Number(column);
  return next;
}

export async function jsonOpen(
  path: string,
  onProgress?: (progress: OpProgress) => void,
): Promise<JobHandle<JsonSummary>> {
  const handle = await runJob<JsonSummary>(
    "jsonopen",
    (requestId) => invoke("json_open_start", { requestId, path }),
    onProgress,
  );
  return {
    ...handle,
    completion: handle.completion.catch((error: unknown) => {
      throw splitInvalidError(error);
    }),
  };
}

export async function jsonChildren(
  session: string,
  node: number,
  start: number,
  count: number,
): Promise<JsonNodeInfo[]> {
  return (await invoke("json_children", { session, node, start, count })) as JsonNodeInfo[];
}

export async function jsonFind(
  session: string,
  text: string,
  caseSensitive: boolean,
  after: number | null,
  backwards: boolean,
): Promise<JsonMatch | null> {
  return (await invoke("json_find", {
    session,
    text,
    caseSensitive,
    after,
    backwards,
  })) as JsonMatch | null;
}

export async function jsonCopy(session: string, node: number): Promise<string> {
  return (await invoke("json_copy", { session, node })) as string;
}

/** Closing a tab never fails the user: an unknown session is already closed. */
export async function jsonClose(session: string): Promise<void> {
  try {
    await invoke("json_close", { session });
  } catch {
    // The session was evicted already.
  }
}
