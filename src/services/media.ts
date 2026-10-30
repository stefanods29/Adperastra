import { invoke } from "@tauri-apps/api/core";

/** Subtitle files (.srt, .vtt) next to a video, as full paths (Step 04c). */
export async function mediaSidecars(path: string): Promise<string[]> {
  return (await invoke("media_sidecars", { path })) as string[];
}
