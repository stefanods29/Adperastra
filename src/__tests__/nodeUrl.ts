import { URL as NodeURL } from "node:url";

// Vite rewrites `new URL("literal", import.meta.url)` into an asset URL and
// resolves it against the dev server, not the repository. Tests that read
// repository files use this helper instead; its arguments are variables, so
// Vite leaves it alone and Node's URL resolves the real file path.
export function repoUrl(relative: string, metaUrl: string): URL {
  return new NodeURL(relative, metaUrl);
}
