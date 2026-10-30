import { FileText } from "lucide-react";
import { lazy } from "react";
import type { Handler } from "../types";

/** Plain text, logs, configuration and source code (Step 04b). Any size:
 * files over 10 MB open read-only in 1 MB parts. */
export const textHandler: Handler = {
  id: "text",
  version: 1,
  labelKey: "handlers.text",
  icon: FileText,
  accent: "explorer",
  extensions: [
    "txt", "text", "log", "out", "nfo", "diz", "me", "1st",
    "md", "markdown", "csv", "tsv", "srt", "vtt",
    "js", "mjs", "cjs", "ts", "mts", "cts", "jsx", "tsx",
    "json", "jsonc", "json5", "ipynb", "geojson", "webmanifest",
    "css", "scss", "less", "vue", "svelte",
    "xml", "xsd", "xsl", "xslt", "plist", "csproj", "vcxproj", "props", "targets", "resx", "manifest",
    "py", "pyw", "pyi", "rs", "sql", "java", "c", "h", "cpp", "cc", "cxx", "hpp", "hh", "hxx", "ino",
    "yml", "yaml", "sh", "bash", "zsh", "ps1", "psm1", "psd1", "bat", "cmd", "vbs",
    "toml", "ini", "cfg", "conf", "properties", "env", "editorconfig", "gitignore", "gitattributes", "gitconfig", "inf", "reg",
    "go", "rb", "lua", "swift", "cs", "kt", "kts", "dockerfile", "diff", "patch", "lock",
  ],
  mimeTypes: ["text/plain"],
  maxBytes: Number.MAX_SAFE_INTEGER,
  helpSlug: "viewing-text",
  speedTier: "fast",
  supportsFind: true,
  view: lazy(() => import("./TextView")),
};
