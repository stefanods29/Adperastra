import { invoke } from "@tauri-apps/api/core";

/** Saving a text file (Step 06a). Mirrors Rust `text_save::TextSaveRequest`
 * and `SavedFile` (snake_case fields). */

export interface TextSaveRequest {
  path: string;
  text: string;
  /** One of the eight save encodings (`SaveEncodingId` in src/editor). */
  encoding: string;
  /** 256 one-character entries for a single-byte encoding, else null. */
  table: string[] | null;
  mode: "save" | "saveAs";
  /** The size and modified time the tab last read or wrote (`save` only). */
  expected_modified_unix: number | null;
  expected_size: number | null;
  /** True skips the changed-on-disk check (the user chose Overwrite). */
  force: boolean;
}

export interface SavedFile {
  path: string;
  size: number;
  modified_unix: number;
}

export async function saveText(request: TextSaveRequest): Promise<SavedFile> {
  return (await invoke("text_save", { request })) as SavedFile;
}

/** Windows' save dialog for Save as; null when the user cancels. */
export async function pickSavePath(
  title: string,
  fileName: string,
  filterName: string,
): Promise<string | null> {
  return (await invoke("text_pick_save_path", { title, fileName, filterName })) as string | null;
}
