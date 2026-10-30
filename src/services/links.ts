import { invoke } from "@tauri-apps/api/core";

/** Open an http(s) or mailto link in the default browser or mail app
 * (Step 04b). Rust refuses anything else with `links.invalid`. */
export async function openExternalUrl(url: string): Promise<void> {
  await invoke("open_external_url", { url });
}

/** True for links the app may open outside (the same rule Rust checks). */
export function isExternalUrl(url: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(url) && url.length <= 2048 && !/[\s\u0000-\u001f]/.test(url);
}
