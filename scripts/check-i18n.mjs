// check-i18n.mjs - translation checks (plan/rules.md R-LANG).  Run: npm run lint:i18n
//
// Fails (exit 1) when any of these is wrong, printing every problem:
//   1. en.json and es.json do not have exactly the same keys.
//   2. A string is not valid ICU (unclosed braces, plural without "other", ...).
//   3. A key uses different {arguments} in en and es.
//   4. pseudo.json is not exactly what scripts/make-pseudo.mjs generates.
//      Fix: npm run i18n:pseudo
//   5. help/en and help/es do not contain the same page files.
//   6. A .tsx file under src/ contains hardcoded UI text: JSX text between
//      ">" and "<" with a letter, or a literal title="..." / placeholder="..." /
//      aria-label="..." attribute. Allowlist: the app name "Adperastra".
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { argumentNames, flatten, parse } from "./icu-lite.mjs";
import { renderPseudoJson } from "./make-pseudo.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST = new Set(["Adperastra"]);
const problems = [];

function readText(relPath) {
  return readFileSync(join(root, relPath), "utf8").replace(/^﻿/, "");
}

const en = JSON.parse(readText("src/i18n/locales/en.json"));
const es = JSON.parse(readText("src/i18n/locales/es.json"));
const enPairs = new Map(flatten(en));
const esPairs = new Map(flatten(es));

// 1. parity
for (const key of enPairs.keys()) {
  if (!esPairs.has(key)) problems.push(`key "${key}" is in en.json but missing from es.json`);
}
for (const key of esPairs.keys()) {
  if (!enPairs.has(key)) problems.push(`key "${key}" is in es.json but missing from en.json`);
}

// 2 + 3. ICU validity and argument parity
const argsOf = (lang, key, value) => {
  if (typeof value !== "string") {
    problems.push(`${lang}.json "${key}" is not a string`);
    return null;
  }
  try {
    return argumentNames(parse(value)).join(",");
  } catch (error) {
    problems.push(`${lang}.json "${key}" is not valid ICU: ${error.message}`);
    return null;
  }
};
for (const [key, enValue] of enPairs) {
  const enArgs = argsOf("en", key, enValue);
  if (!esPairs.has(key)) continue;
  const esArgs = argsOf("es", key, esPairs.get(key));
  if (enArgs !== null && esArgs !== null && enArgs !== esArgs) {
    problems.push(`"${key}" uses {${enArgs}} in en.json but {${esArgs}} in es.json`);
  }
}

// 4. pseudo.json up to date
const pseudoPath = "src/i18n/locales/pseudo.json";
try {
  const expected = renderPseudoJson(en);
  const actual = existsSync(join(root, pseudoPath)) ? readText(pseudoPath).replace(/\r\n/g, "\n") : "";
  if (actual !== expected) problems.push("pseudo.json is out of date. Fix: npm run i18n:pseudo");
} catch (error) {
  problems.push(`could not build pseudo.json: ${error.message}`);
}

// 5. help page parity
const helpPages = (lang) => {
  const dir = join(root, "help", lang);
  return existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith(".md")).sort() : [];
};
const helpEn = helpPages("en");
const helpEs = helpPages("es");
for (const page of helpEn) if (!helpEs.includes(page)) problems.push(`help/es/${page} is missing (help/en/${page} exists)`);
for (const page of helpEs) if (!helpEn.includes(page)) problems.push(`help/en/${page} is missing (help/es/${page} exists)`);

// 6. hardcoded UI text in .tsx files
function collectTsx(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectTsx(full, out);
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}
const lineOf = (text, index) => text.slice(0, index).split("\n").length;
const letterRe = /[A-Za-zÀ-ɏ]/;
const jsxTextRe = />([^<>{}]*[^\s<>{}][^<>{}]*)</g;
const attrRe = /\b(title|placeholder|aria-label)="([^"]*)"/g;
const tsxFiles = existsSync(join(root, "src")) ? collectTsx(join(root, "src"), []) : [];
for (const file of tsxFiles) {
  const text = readFileSync(file, "utf8");
  const rel = relative(root, file);
  for (const match of text.matchAll(jsxTextRe)) {
    const candidate = match[1].trim();
    if (!letterRe.test(candidate)) continue;
    // A ">" from a TypeScript generic (useRef<X>) can make the pattern span
    // ordinary code; real JSX text has no statements or keywords.
    if (candidate.includes(";")) continue;
    if (/\b(const|let|var|function|return|import|export|if|for|while|void)\b/.test(candidate)) continue;
    // A ">" that belongs to "=>" starts an arrow-function body, not JSX text.
    if (text[match.index - 1] === "=") continue;
    // TypeScript signatures between generics ("Readonly<X>, b: string): Record<")
    // start with "," or ")" or contain "):"; JSX text does not.
    if (/^[,)\]]/.test(candidate) || /\)\s*:/.test(candidate)) continue;
    if (!letterRe.test(candidate.replace(/\b(null|undefined|true|false)\b/g, ""))) continue;
    if (ALLOWLIST.has(candidate)) continue;
    problems.push(`${rel}:${lineOf(text, match.index)}: hardcoded JSX text "${candidate}" (use t("..."))`);
  }
  for (const match of text.matchAll(attrRe)) {
    const candidate = match[2].trim();
    if (!letterRe.test(candidate) || ALLOWLIST.has(candidate)) continue;
    problems.push(`${rel}:${lineOf(text, match.index)}: hardcoded ${match[1]}="${candidate}" (use t("..."))`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) console.error(`i18n: ${problem}`);
  console.error(`i18n check FAILED (${problems.length} problem(s)).`);
  process.exit(1);
}
console.log(`i18n check passed (${enPairs.size} keys, ${helpEn.length} help pages, ${tsxFiles.length} tsx files).`);
