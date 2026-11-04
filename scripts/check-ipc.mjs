// check-ipc.mjs - cross-checks the three places every Tauri command must
// appear, and the argument names the UI sends.  Run: npm run lint:ipc
//
// Fails (exit 1) when:
//   1. a command is in tauri::generate_handler![...] but not in the
//      isolation allowlist (src-tauri/isolation/index.html), or the reverse;
//   2. a #[tauri::command] function in src-tauri/src is not registered in
//      generate_handler![...] (it could never be called);
//   3. the UI calls invoke("name") for a command that is not registered;
//   4. an invoke("name", { ...keys }) call sends argument names that do not
//      match the Rust function's parameters. Tauri turns camelCase keys from
//      TypeScript into snake_case parameters: { newName } -> new_name.
//      Parameters of type Option<...> may be left out.
// Calls whose argument object is not a literal (invoke("x", args)) or that
// spread another object are reported as "not checked", never as failures.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];
const notes = [];

function walk(dir, extensions, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "target" || entry === "__tests__") continue;
      walk(full, extensions, out);
    } else if (extensions.some((ext) => entry.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/** Text between the bracket at `open` and its partner (exclusive). */
function enclosed(text, open, openCh, closeCh) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === openCh) depth += 1;
    else if (text[i] === closeCh) {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

/** Split on commas that are not inside (), [], {}, <> or quotes. Rust code
 * passes quotes = '"' only, because a Rust lifetime ('_) is not a quote. */
function splitTopLevel(text, quotes = "\"'`") {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === quote && text[i - 1] !== "\\") quote = null;
      continue;
    }
    if (quotes.includes(ch)) {
      quote = ch;
      current += ch;
      continue;
    }
    if ("([{<".includes(ch)) depth += 1;
    if (")]}>".includes(ch) && !(ch === ">" && text[i - 1] === "=")) depth -= 1;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const snake = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

// --- Rust side -------------------------------------------------------------
const rustFiles = walk(join(root, "src-tauri", "src"), [".rs"]);
const rustCommands = new Map(); // name -> { file, params: [{ name, optional }] }
let handlerNames = [];
const INJECTED = /^(tauri::)?(WebviewWindow|Window|AppHandle|State<|Webview|ipc::Channel|Channel<)/;

for (const file of rustFiles) {
  const text = readFileSync(file, "utf8");
  // Other outer attributes (for example #[allow(clippy::too_many_arguments)])
  // may sit between the command attribute and the fn; still requires the
  // #[tauri::command] anchor and a real `fn name(` signature.
  const attr = /#\[tauri::command(?:\([^)]*\))?\]\s*(?:#\[[^\]]*\]\s*)*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([a-z0-9_]+)\s*(?:<[^>]*>)?\s*\(/g;
  for (const match of text.matchAll(attr)) {
    const open = match.index + match[0].length - 1;
    const body = enclosed(text, open, "(", ")") ?? "";
    const params = [];
    for (const part of splitTopLevel(body, '"')) {
      const colon = part.indexOf(":");
      if (colon === -1) continue;
      const name = part.slice(0, colon).replace(/^mut\s+/, "").trim();
      const type = part.slice(colon + 1).trim();
      if (INJECTED.test(type)) continue;
      params.push({ name, optional: /^Option</.test(type) });
    }
    rustCommands.set(match[1], { file: relative(root, file), params });
  }
  // A process may build more than one handler list (the WebView helper child
  // has its own). Every command name from any list counts as registered.
  for (const match of text.matchAll(/generate_handler!\[/g)) {
    const list = enclosed(text, match.index + "generate_handler!".length, "[", "]") ?? "";
    handlerNames.push(
      ...list
        .split(",")
        .map((entry) => entry.trim().split("::").pop())
        .filter(Boolean),
    );
  }
}
if (handlerNames.length === 0) {
  problems.push("could not find tauri::generate_handler![...] in src-tauri/src");
}
const handlers = new Set(handlerNames);

// --- Isolation allowlist ---------------------------------------------------
// The allowlist is built in two shapes; both are parsed, because Step 08a
// appended the second one after the original Set literal:
//   var ALLOWED = new Set(['a', 'b', ...]);
//   ('a,b,' + 'c,d,...').split(',').forEach((name) => ALLOWED.add(name));
const isolationPath = join(root, "src-tauri", "isolation", "index.html");
const isolation = existsSync(isolationPath) ? readFileSync(isolationPath, "utf8") : "";
const allowed = new Set();
let foundAllowlist = false;
const commandLiterals = (text) => {
  // One quoted entry per name in the Set literal, but the split(',') list
  // packs many names into each string: split every quoted chunk on commas
  // and keep only command-shaped tokens (same strictness as before).
  const names = [];
  for (const match of text.matchAll(/'([^']*)'|"([^"]*)"/g)) {
    for (const part of (match[1] ?? match[2]).split(",")) {
      const name = part.trim();
      if (/^[a-z0-9_]+$/.test(name)) names.push(name);
    }
  }
  return names;
};

// 1. The Set([...]) literal.
const setMatch = /new Set\(\s*\[/.exec(isolation);
if (setMatch) {
  const body = enclosed(isolation, setMatch.index + setMatch[0].length - 1, "[", "]");
  if (body !== null) {
    foundAllowlist = true;
    for (const name of commandLiterals(body)) allowed.add(name);
  }
}

// 2. A comma-separated string added with .split(',').forEach(ALLOWED.add).
// Only the callback that adds to ALLOWED counts, and only the parenthesised
// expression directly before .split is read; other split() calls are ignored.
for (const match of isolation.matchAll(/\.split\(\s*(['"])\s*,\s*\1\s*\)\s*\.forEach\(/g)) {
  const callback = enclosed(isolation, match.index + match[0].length - 1, "(", ")");
  if (callback === null || !/\bALLOWED\s*\.\s*add\s*\(/.test(callback)) continue;
  let end = match.index - 1;
  while (end >= 0 && /\s/.test(isolation[end])) end -= 1;
  if (isolation[end] !== ")") continue;
  // Walk back to the "(" that opens that parenthesised expression.
  let depth = 0;
  let start = -1;
  for (let i = end; i >= 0; i -= 1) {
    if (isolation[i] === ")") depth += 1;
    else if (isolation[i] === "(") {
      depth -= 1;
      if (depth === 0) {
        start = i;
        break;
      }
    }
  }
  if (start === -1) continue;
  const names = commandLiterals(isolation.slice(start + 1, end));
  if (names.length > 0) {
    foundAllowlist = true;
    for (const name of names) allowed.add(name);
  }
}
if (!foundAllowlist) problems.push("could not find the ALLOWED set in src-tauri/isolation/index.html");

// 1. handler list vs allowlist
for (const name of handlers) {
  if (!allowed.has(name)) problems.push(`"${name}" is in generate_handler! but not in the isolation allowlist`);
}
for (const name of allowed) {
  if (!handlers.has(name)) problems.push(`"${name}" is in the isolation allowlist but not in generate_handler!`);
}
// 2. unregistered commands
for (const [name, info] of rustCommands) {
  if (!handlers.has(name)) problems.push(`#[tauri::command] ${name} (${info.file}) is not in generate_handler!`);
}
for (const name of handlers) {
  if (!rustCommands.has(name)) problems.push(`generate_handler! lists "${name}" but no #[tauri::command] fn ${name} was found`);
}

// --- UI side ---------------------------------------------------------------
const uiFiles = walk(join(root, "src"), [".ts", ".tsx"]);
let checkedCalls = 0;
for (const file of uiFiles) {
  const text = readFileSync(file, "utf8");
  const rel = relative(root, file);
  const call = /\binvoke\s*(?:<[^>]*>)?\s*\(\s*["']([a-z0-9_]+)["']\s*(,)?/g;
  for (const match of text.matchAll(call)) {
    const name = match[1];
    const line = text.slice(0, match.index).split("\n").length;
    const where = `${rel}:${line}`;
    // 3. registered?
    if (!handlers.has(name)) {
      problems.push(`${where}: invoke("${name}") but "${name}" is not in generate_handler!`);
      continue;
    }
    const rust = rustCommands.get(name);
    if (!rust) continue;
    const required = rust.params.filter((param) => !param.optional).map((param) => param.name);
    const allNames = new Set(rust.params.map((param) => param.name));
    if (!match[2]) {
      if (required.length > 0) problems.push(`${where}: invoke("${name}") sends no arguments but Rust needs: ${required.join(", ")}`);
      checkedCalls += 1;
      continue;
    }
    // 4. argument names
    let i = match.index + match[0].length;
    while (/\s/.test(text[i])) i += 1;
    if (text[i] !== "{") {
      notes.push(`${where}: invoke("${name}", <variable>) - arguments not checked`);
      continue;
    }
    const objectBody = enclosed(text, i, "{", "}") ?? "";
    const parts = splitTopLevel(objectBody);
    if (parts.some((part) => part.startsWith("..."))) {
      notes.push(`${where}: invoke("${name}", { ...spread }) - arguments not checked`);
      continue;
    }
    const sent = parts.map((part) => snake(part.split(":")[0].trim().replace(/^["']|["']$/g, "")));
    for (const key of sent) {
      if (!allNames.has(key)) {
        problems.push(`${where}: invoke("${name}") sends "${key}" but the Rust command has no parameter "${key}" (it has: ${[...allNames].join(", ") || "none"})`);
      }
    }
    for (const key of required) {
      if (!sent.includes(key)) problems.push(`${where}: invoke("${name}") does not send required parameter "${key}"`);
    }
    checkedCalls += 1;
  }
}

for (const note of notes) console.log(`ipc note: ${note}`);
if (problems.length > 0) {
  for (const problem of problems) console.error(`ipc: ${problem}`);
  console.error(`IPC check FAILED (${problems.length} problem(s)).`);
  process.exit(1);
}
console.log(`IPC check passed (${handlers.size} commands, ${checkedCalls} invoke calls checked).`);
