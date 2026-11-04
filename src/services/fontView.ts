import { invoke } from "@tauri-apps/api/core";
import type { OpProgress } from "./fileops";
import { runJob, type JobHandle } from "./jobs";

/** Fonts (Step 06f): details come from the font helper process, and Install
 * asks Windows to install the file. Mirrors src-tauri/src/font_view.rs and
 * font_helper.rs. */

export type FontFormatId = "ttf" | "otf" | "ttc" | "woff" | "woff2";

/** Mirrors Rust `FontInfo` (snake_case fields, same names). */
export interface FontInfo {
  format: FontFormatId;
  family: string | null;
  style: string | null;
  full_name: string | null;
  version: string | null;
  designer: string | null;
  copyright: string | null;
  license: string | null;
  glyphs: number;
  weight: number;
  italic: boolean;
  monospaced: boolean;
  /** How many fonts the file holds; a collection shows the first. */
  faces: number;
  /** Inclusive code point ranges, sorted. */
  ranges: [number, number][];
  ranges_cut: boolean;
  code_points: number;
}

export async function fontInfo(
  path: string,
  onProgress?: (progress: OpProgress) => void,
): Promise<JobHandle<FontInfo>> {
  return runJob<FontInfo>(
    "fontinfo",
    (requestId) => invoke("font_info_start", { requestId, path }),
    onProgress,
  );
}

/** True when Windows started installing; false when the user cancelled its
 * prompt. */
export async function fontInstall(path: string): Promise<boolean> {
  return (await invoke("font_install", { path })) as boolean;
}
