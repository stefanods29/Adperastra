import { StreamLanguage } from "@codemirror/language";
import type { Extension } from "@codemirror/state";

/** Syntax highlighting per file type (Step 04b). Each language loads only
 * when a file of that type opens (its own code chunk), so opening a plain
 * text file never waits for it. */

export type LanguageId =
  | "javascript"
  | "typescript"
  | "jsx"
  | "tsx"
  | "json"
  | "html"
  | "css"
  | "xml"
  | "markdown"
  | "python"
  | "rust"
  | "sql"
  | "java"
  | "cpp"
  | "yaml"
  | "shell"
  | "powershell"
  | "toml"
  | "ini"
  | "go"
  | "ruby"
  | "lua"
  | "swift"
  | "csharp"
  | "kotlin"
  | "dockerfile"
  | "diff";

const BY_EXTENSION: Record<string, LanguageId> = {
  js: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", mts: "typescript", cts: "typescript",
  jsx: "jsx", tsx: "tsx",
  json: "json", jsonc: "json", json5: "json", ipynb: "json", geojson: "json", webmanifest: "json",
  html: "html", htm: "html", xhtml: "html", vue: "html", svelte: "html",
  css: "css", scss: "css", less: "css",
  xml: "xml", xsd: "xml", xsl: "xml", xslt: "xml", plist: "xml", csproj: "xml", vcxproj: "xml", props: "xml", targets: "xml", resx: "xml", svg: "xml",
  md: "markdown", markdown: "markdown", mdown: "markdown", mkd: "markdown",
  py: "python", pyw: "python", pyi: "python",
  rs: "rust",
  sql: "sql",
  java: "java",
  c: "cpp", h: "cpp", cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp", hxx: "cpp", ino: "cpp",
  yml: "yaml", yaml: "yaml",
  sh: "shell", bash: "shell", zsh: "shell",
  ps1: "powershell", psm1: "powershell", psd1: "powershell",
  toml: "toml",
  ini: "ini", cfg: "ini", conf: "ini", properties: "ini", env: "ini", editorconfig: "ini", gitconfig: "ini", inf: "ini", reg: "ini",
  go: "go",
  rb: "ruby",
  lua: "lua",
  swift: "swift",
  cs: "csharp",
  kt: "kotlin", kts: "kotlin",
  dockerfile: "dockerfile",
  diff: "diff", patch: "diff",
};

/** The language for a file name, or null for plain text. */
export function languageIdFor(name: string): LanguageId | null {
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  const dot = lower.lastIndexOf(".");
  const ext = dot >= 0 ? lower.slice(dot + 1) : "";
  return BY_EXTENSION[ext] ?? null;
}

/** Load the CodeMirror extension for a language. */
export async function loadLanguage(id: LanguageId): Promise<Extension> {
  // @codemirror/language is already loaded with the editor; only the
  // modes themselves load on demand.
  const legacy = async (load: () => Promise<Parameters<typeof StreamLanguage.define>[0]>) => StreamLanguage.define(await load());
  switch (id) {
    case "javascript":
      return (await import("@codemirror/lang-javascript")).javascript();
    case "typescript":
      return (await import("@codemirror/lang-javascript")).javascript({ typescript: true });
    case "jsx":
      return (await import("@codemirror/lang-javascript")).javascript({ jsx: true });
    case "tsx":
      return (await import("@codemirror/lang-javascript")).javascript({ jsx: true, typescript: true });
    case "json":
      return (await import("@codemirror/lang-json")).json();
    case "html":
      return (await import("@codemirror/lang-html")).html();
    case "css":
      return (await import("@codemirror/lang-css")).css();
    case "xml":
      return (await import("@codemirror/lang-xml")).xml();
    case "markdown":
      return (await import("@codemirror/lang-markdown")).markdown();
    case "python":
      return (await import("@codemirror/lang-python")).python();
    case "rust":
      return (await import("@codemirror/lang-rust")).rust();
    case "sql":
      return (await import("@codemirror/lang-sql")).sql();
    case "java":
      return (await import("@codemirror/lang-java")).java();
    case "cpp":
      return (await import("@codemirror/lang-cpp")).cpp();
    case "yaml":
      return (await import("@codemirror/lang-yaml")).yaml();
    case "shell":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/shell")).shell);
    case "powershell":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/powershell")).powerShell);
    case "toml":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/toml")).toml);
    case "ini":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/properties")).properties);
    case "go":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/go")).go);
    case "ruby":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/ruby")).ruby);
    case "lua":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/lua")).lua);
    case "swift":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/swift")).swift);
    case "csharp":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/clike")).csharp);
    case "kotlin":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/clike")).kotlin);
    case "dockerfile":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/dockerfile")).dockerFile);
    case "diff":
      return legacy(async () => (await import("@codemirror/legacy-modes/mode/diff")).diff);
  }
}
