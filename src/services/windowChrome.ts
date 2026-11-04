import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./settings";

export type CaptionRect = [number, number, number, number];

export async function setTitlebarDragRect(rect: CaptionRect | null): Promise<void> {
  if (isTauriRuntime()) await invoke("set_titlebar_drag_rect", { rect });
}
