import { invoke } from "@tauri-apps/api/core";

/** Mirrors Rust `UpdateInfo` (E2); snake_case fields, no installer action. */
export interface UpdateInfo {
  current_version: string;
  latest_version: string | null;
  available: boolean;
  release_url: string | null;
  checked_unix: number;
}

/** Same 24-hour window as Rust `RATE_LIMIT_SECS`. */
export const UPDATE_RATE_LIMIT_SECONDS = 24 * 60 * 60;

/** E3. `manual` is an explicit user request; it never turns checks on. */
export async function checkForUpdates(manual: boolean): Promise<UpdateInfo> {
  return (await invoke("update_check", { manual })) as UpdateInfo;
}

/** E4. Native opens only the last validated release page. */
export async function openUpdatePage(): Promise<void> {
  await invoke("update_open_page");
}

/** D8. Records that the What's new page for this version was shown. */
export async function markWhatsNewSeen(version: string): Promise<void> {
  await invoke("update_mark_seen", { version });
}

/** True when an opt-in automatic check is due; off means no network. */
export function shouldCheckAutomatically(
  enabled: boolean,
  lastCheckUnix: number,
  nowUnix: number,
): boolean {
  if (!enabled) return false;
  if (!Number.isFinite(lastCheckUnix) || lastCheckUnix <= 0) return true;
  return nowUnix - lastCheckUnix >= UPDATE_RATE_LIMIT_SECONDS;
}

/** D8: show What's new once when the app version changed. */
export function whatsNewDue(currentVersion: string, lastSeenVersion: string): boolean {
  const current = currentVersion.trim().replace(/^v/i, "");
  const last = lastSeenVersion.trim().replace(/^v/i, "");
  if (current === "") return false;
  return last !== current;
}

/** D8: the local help page for the current app version, when one exists. */
export function whatsNewSlug(currentVersion: string): string | null {
  const current = currentVersion.trim().replace(/^v/i, "");
  if (/^0\.1\.\d+$/.test(current)) return "whats-new-0-1";
  return null;
}
