/** UI scale through the webview's page zoom (Step 05d). */
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./settings";

/** Sets the page zoom; `scale` is a percentage of `UI_SCALES`. */
export async function setUiZoom(scale: number): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("appearance_set_zoom", { scale });
}
