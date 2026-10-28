// check-i18n.mjs — hardcoded-text lint + locale key parity (plan/rules.md section 2).
//
// (a) Fails if the flattened key sets of en.json and es.json differ.
// (b) Scans src/**/*.tsx for likely hardcoded UI text:
//       - JSX text between ">" and "<" containing a letter
//       - literal title="..." / placeholder="..." / aria-label="..." attributes
//     Allowlist: the app name "Adperastra" itself; pure numbers/punctuation have no
//     letter and therefore never match. Prints file:line for every finding, exit 1.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST = new Set(["Adperastra"]);
let failed = false;

function readJson(relPath) {
  return JSON.parse(readFileSync(join(root, relPath), "utf8").replace(/^\uFEFF/, ""));
}

function flattenKeys(value, prefix, out) {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flattenKeys(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out.add(prefix);
  }
  return out;
}

// (a) en/es parity
const enKeys = flattenKeys(readJson("src/i18n/locales/en.json"), "", new Set());
const esKeys = flattenKeys(readJson("src/i18n/locales/es.json"), "", new Set());
for (const key of enKeys) {
  if (!esKeys.has(key)) {
    console.error(`i18n parity: key "${key}" is in en.json but missing from es.json`);
    failed = true;
  }
}
for (const key of esKeys) {
  if (!enKeys.has(key)) {
    console.error(`i18n parity: key "${key}" is in es.json but missing from en.json`);
    failed = true;
  }
}

// (b) hardcoded UI text in .tsx files
function collectTsx(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectTsx(full, out);
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

const letterRe = /[A-Za-z\u00C0-\u024F]/;
const jsxTextRe = />([^<>{}]*[^\s<>{}][^<>{}]*)</g;
const attrRe = /\b(title|placeholder|aria-label)="([^"]*)"/g;

const srcDir = join(root, "src");
let tsxFiles = [];
try {
  tsxFiles = collectTsx(srcDir, []);
} catch {
  tsxFiles = [];
}

for (const file of tsxFiles) {
  const text = readFileSync(file, "utf8");
  const rel = relative(root, file);
  for (const match of text.matchAll(jsxTextRe)) {
    const candidate = match[1].trim();
    if (!letterRe.test(candidate)) continue;
    if (ALLOWLIST.has(candidate)) continue;
    console.error(`${rel}:${lineOf(text, match.index)}: hardcoded JSX text: "${candidate}"`);
    failed = true;
  }
  for (const match of text.matchAll(attrRe)) {
    const candidate = match[2].trim();
    if (!letterRe.test(candidate)) continue;
    if (ALLOWLIST.has(candidate)) continue;
    console.error(`${rel}:${lineOf(text, match.index)}: hardcoded ${match[1]} attribute: "${candidate}"`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}
console.log(`i18n check passed (${enKeys.size} keys, ${tsxFiles.length} tsx file(s) scanned).`);