import { invoke } from "@tauri-apps/api/core";

/** File access for file tabs (Step 04a). Rust gives a token per open file;
 * the bytes are served by the `adpfile` protocol (plan/pitfalls.md P-27). */

/** Mirrors Rust `files::FileTypeInfo` (snake_case fields). */
export interface FileTypeInfo {
  path: string;
  name: string;
  /** Lower-case extension without the dot; "" when there is none. */
  ext: string;
  mime: string;
  size: number;
  modified_unix: number;
  online_only: boolean;
  read_only: boolean;
  /** Windows marked the file as downloaded from the internet (Step 04c). */
  from_internet: boolean;
}

export async function fileDetect(path: string): Promise<FileTypeInfo> {
  return (await invoke("file_detect", { path })) as FileTypeInfo;
}

export async function fileGrant(path: string): Promise<string> {
  const grant = (await invoke("file_grant", { path })) as { token: string };
  return grant.token;
}

export async function fileRevoke(token: string): Promise<void> {
  await invoke("file_revoke", { token });
}

/** Remove the "downloaded from the internet" mark (Step 04c). Rejects with
 * `files.unblock_denied` or `files.unblock_failed`. */
export async function fileUnblock(path: string): Promise<void> {
  await invoke("file_unblock", { path });
}

/** URL of a granted file. On Windows, Tauri serves custom schemes at
 * http://<scheme>.localhost/. The name is only there for readability. */
export function fileUrl(token: string, name: string): string {
  return `http://adpfile.localhost/${token}/${encodeURIComponent(name)}`;
}

/** Lower-case extension of a file name, without the dot. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}
