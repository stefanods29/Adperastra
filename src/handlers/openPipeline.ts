import { fileDetect, type FileTypeInfo } from "../services/files";
import type { HandlerRegistry } from "./registry";
import type { Handler } from "./types";

/** The open pipeline (contract 13): detect the file, then either show it in
 * a file tab with a built-in handler, or open it in the Windows default app
 * (plan/rules.md R-OPEN). */
export type OpenDecision =
  | { kind: "tab"; handler: Handler; info: FileTypeInfo }
  | { kind: "windows"; info: FileTypeInfo };

/** Types that always open in Windows: programs, shortcuts, links, and web
 * pages (shown with "Open as text" if the user wants their source). */
export const ALWAYS_WINDOWS: readonly string[] = [
  "exe", "msi", "msix", "msixbundle", "appx", "appxbundle", "appinstaller", "com", "scr", "cpl", "msc",
  "lnk", "url", "website", "appref-ms", "library-ms", "search-ms",
  "html", "htm", "xhtml", "mht", "mhtml",
];

/** Pure: what to do with a detected file. `preference` is the user's
 * choice for this extension (Settings > Default apps, Step 04c). */
export function decideOpen(
  info: FileTypeInfo,
  registry: HandlerRegistry,
  preference: "builtin" | "windows" | undefined = undefined,
): OpenDecision {
  if (preference === "windows" || ALWAYS_WINDOWS.includes(info.ext)) return { kind: "windows", info };
  const handler = registry.pick(info);
  return handler ? { kind: "tab", handler, info } : { kind: "windows", info };
}

/** Detect a file and decide. Rejects with a `files.*` code when the file
 * cannot be read (for example `files.not_found`). */
export async function planOpen(path: string, registry: HandlerRegistry): Promise<OpenDecision> {
  const info = await fileDetect(path);
  return decideOpen(info, registry);
}
